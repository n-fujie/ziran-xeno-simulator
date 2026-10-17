import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger } from './fixtures/ledger-mode.ts';
import { ScientificRuntime } from '../src/science/runtime.ts';
import { externalHead, sameHead } from '../src/science/checkpoint.ts';
import type { ExternalHead, ExternalCheckpointStore } from '../src/science/checkpoint.ts';

// Fault-injection model only. Neither a remote deployment nor proof of immutable storage.
class ModelStore implements ExternalCheckpointStore {
  head!: ExternalHead;
  failure: 'none' | 'read' | 'before' | 'after' | 'noop' = 'none';
  writes = 0;
  read() { if (this.failure === 'read') throw Error('external transport unavailable'); return { ...this.head }; }
  compareAndSet(expected: ExternalHead, next: ExternalHead) {
    if (this.failure === 'before') throw Error('external transport unavailable');
    if (!sameHead(this.head, expected)) throw Error('external stale writer');
    if (this.failure === 'noop') return;
    this.head = { ...next }; this.writes++;
    if (this.failure === 'after') throw Error('external acknowledgement lost');
  }
}
function setup(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), 'external-checkpoint-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new ModelStore(), binding = { historyId: 'experiment-01', seriesId: 'series-01', store };
  store.head = externalHead(binding); // Explicit operator provisioning of trusted genesis.
  const restart = () => new ScientificRuntime(new Ledger(join(root, 'ledger'), undefined, binding));
  return { store, binding, restart, runtime: restart() };
}

test('external checkpoint verifies full cycles and idempotent replay across restart', (t) => {
  const { runtime, restart, store } = setup(t);
  const input = { seed: 1, operationId: 'external-replay-01' };
  const result = runtime.run(input), count = store.writes;
  assert.equal(result.intervention?.consistent, true);
  assert.deepEqual(restart().run(input), result);
  assert.equal(store.writes, count);
  assert.equal(store.head.count, runtime.ledger.read().length);
});

test('external head rejects rollback of both local files and a replacement history', (t) => {
  for (const mode of ['rollback', 'replace']) {
    const { runtime, restart } = setup(t);
    runtime.run({ seed: 1 });
    const file = join(runtime.ledger.directory, 'ledger.json');
    const old = readFileSync(file, 'utf8'), witness = readFileSync(runtime.ledger.checkpointPath, 'utf8');
    runtime.run({ seed: 2 });
    if (mode === 'rollback') {
      writeFileSync(file, old); writeFileSync(runtime.ledger.checkpointPath, witness);
    } else {
      // Another self-consistent, locally witnessed history cannot replace the externally retained one.
      const other = new ScientificRuntime(new Ledger(join(runtime.ledger.directory, 'other')));
      other.run({ seed: 99 });
      writeFileSync(file, readFileSync(join(other.ledger.directory, 'ledger.json')));
      writeFileSync(runtime.ledger.checkpointPath, readFileSync(other.ledger.checkpointPath));
    }
    const next = restart();
    assert.throws(() => next.ledger.read(), /external checkpoint mismatch/);
    assert.throws(() => next.run({}), /external checkpoint mismatch/);
    assert.throws(() => next.recover(), /external checkpoint mismatch/);
  }
});

test('unreachable external checkpoint prevents acquisition and intervention before prepare', (t) => {
  const { runtime, store } = setup(t); store.failure = 'read'; let reached = false;
  assert.throws(() => runtime.run({}, () => { reached = true; }), /transport unavailable/);
  assert.equal(reached, false); assert.equal(store.writes, 0);
});

for (const failure of ['before', 'after'] as const) {
  test(`external ${failure}-commit failure recovers exact pending intent without replay`, (t) => {
    const { runtime, restart, store } = setup(t); store.failure = failure;
    const input = { operationId: 'external-uncertain-01' };
    assert.throws(() => runtime.run(input), /transport unavailable|acknowledgement lost/);
    store.failure = 'none';
    const recovered = restart();
    const entries = recovered.recover();
    assert.equal(entries.filter((e) => e.kind === 'prepared').length, 1);
    assert.equal(entries.at(-1)?.kind, 'quarantined');
    assert.throws(() => recovered.run(input), /quarantined/);
    assert.equal(entries.some((e) => e.kind === 'event'), false);
  });
}

test('external acknowledgement loss after intervention isolates effect rather than replaying it', (t) => {
  const { runtime, restart, store } = setup(t);
  const input = { operationId: 'external-effect-loss-01' };
  assert.throws(() => runtime.run(input, (point) => { if (point === 'after-intervention') store.failure = 'after'; }), /checkpoint mismatch/);
  store.failure = 'none'; const next = restart(); const entries = next.recover();
  assert.equal(entries.at(-1)?.kind, 'quarantined');
  assert.equal(entries.filter((e) => e.kind === 'event' && (e.data as { phase: string }).phase === 'intervention-issued').length, 1);
  assert.throws(() => next.run(input), /quarantined/);
  assert.equal(store.head.count, entries.length);
});

test('false external acknowledgement fails closed and requires explicit recovery', (t) => {
  const { runtime, restart, store } = setup(t); store.failure = 'noop';
  assert.throws(() => runtime.run({}), /external checkpoint mismatch/);
  store.failure = 'none'; assert.equal(restart().recover().at(-1)?.kind, 'quarantined');
});

test('wrong series, digest or position in external store cannot pass verification', (t) => {
  for (const change of [{ seriesId: 'wrong' }, { historyId: 'wrong' }, { digest: '0'.repeat(64) }, { count: 1 }, { version: 2 }]) {
    const { runtime, store } = setup(t);
    Object.assign(store.head, change);
    assert.throws(() => runtime.run({}), /external checkpoint mismatch/);
  }
});

test('stale external CAS and missing provisioning cannot silently enrol or overwrite a head', (t) => {
  const { runtime, store } = setup(t);
  const expected = store.read(); store.head = { ...store.head, count: 2 };
  assert.throws(() => store.compareAndSet(expected, { ...expected, count: 1 }), /stale writer/);
  assert.equal(store.head.count, 2);
  store.head = undefined as unknown as ExternalHead;
  assert.throws(() => runtime.run({}), /external checkpoint mismatch/);
  assert.equal(store.writes, 0);
});

test('external writer conflict during commit cannot be blessed by recovery', (t) => {
  const { runtime, restart, store } = setup(t);
  const compare = store.compareAndSet.bind(store);
  store.compareAndSet = (expected, next) => {
    store.head = { ...next, hash: 'a'.repeat(64), digest: 'b'.repeat(64) };
    compare(expected, next);
  };
  assert.throws(() => runtime.run({}), /stale writer/);
  store.compareAndSet = compare;
  assert.throws(() => restart().recover(), /external checkpoint mismatch/);
  assert.equal(store.writes, 0);
});

test('externally committed pending data must still pass exact digest validation', (t) => {
  const { runtime, restart, store } = setup(t); store.failure = 'after';
  assert.throws(() => runtime.run({}), /acknowledgement lost/);
  const checkpoint = runtime.ledger.checkpoint();
  writeFileSync(join(runtime.ledger.directory, checkpoint.pending), '[]');
  store.failure = 'none';
  assert.throws(() => restart().recover(), /pending replacement mismatch/);
  assert.equal(store.head.count, 1);
});
