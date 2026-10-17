import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CheckpointHttpStore, checkpointBindingFromEnvironment } from '../src/science/checkpoint-http.ts';
import { externalHead } from '../src/science/checkpoint.ts';
import { Ledger } from './fixtures/ledger-mode.ts';
import { ScientificRuntime } from '../src/science/runtime.ts';

async function fixture(t: { after: (fn: () => void | Promise<void>) => void }) {
  const child = fork(new URL('./fixtures/checkpoint-service.ts', import.meta.url), { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const exit = once(child, 'exit');
  const root = mkdtempSync(join(tmpdir(), 'checkpoint-transport-'));
  t.after(async () => { child.kill(); await exit; rmSync(root, { recursive: true, force: true }); });
  const [{ port }] = await once(child, 'message') as [{ port: number }];
  const endpoint = `http://127.0.0.1:${port}`;
  const options = { endpoint, allowLoopbackHttp: true, timeoutMs: 5000, credential: () => ({ token: 'contract-only-credential', expiresAt: Date.now() + 60000 }) };
  const store = new CheckpointHttpStore(options), binding = { historyId: 'contract', seriesId: 'series', store };
  let request = 0;
  const control = async (mode?: string) => { const result = once(child, 'message'); child.send({ mode, request: ++request }); return (await result)[0] as { head: ReturnType<typeof externalHead>; writes: number; redirected: number }; };
  const runtime = () => new ScientificRuntime(new Ledger(join(root, 'ledger'), undefined, binding));
  return { store, binding, control, runtime, options, root };
}

test('HTTP CAS service contract rejects competing/stale writers and duplicate update', { timeout: 45000 }, async (t) => {
  const { store, control } = await fixture(t);
  const head = store.read('contract', 'series'), next = { ...head, count: 1, hash: '1'.repeat(64), digest: '2'.repeat(64) };
  store.compareAndSet(head, next);
  assert.throws(() => store.compareAndSet(head, next), /conflict/);
  const competing = { ...next, hash: '3'.repeat(64) };
  assert.throws(() => store.compareAndSet(head, competing), /conflict/);
  assert.equal((await control()).writes, 1); assert.deepEqual(store.read('contract', 'series'), next);
});

for (const mode of ['drop-before', 'drop-after'] as const) test(`HTTP ${mode}: uncertain prepare reconciles without repeating the device operation`, { timeout: 45000 }, async (t) => {
  const { control, runtime } = await fixture(t); await control(mode);
  const input = { operationId: 'transport-uncertain-operation' };
  assert.throws(() => runtime().run(input), /outcome unknown/);
  await control('normal'); const restarted = runtime(), entries = restarted.recover();
  assert.equal(entries.filter((e) => e.kind === 'prepared').length, 1);
  assert.equal(entries.at(-1)?.kind, 'quarantined');
  assert.throws(() => restarted.run(input), /quarantined/);
  assert.equal((await control()).writes, 2); // one intent and one quarantine, not a repeated intent
});

test('HTTP denied access, outage, redirect, malformed and oversized responses fail closed without secret details', { timeout: 45000 }, async (t) => {
  const { store, control } = await fixture(t);
  for (const mode of ['unauthorized', 'forbidden', 'unavailable', 'redirect', 'corrupt', 'oversize', 'hang']) {
    await control(mode);
    assert.throws(() => store.read('contract', 'series'), (e: unknown) => {
      assert.doesNotMatch(String(e), /contract-only-credential|private|Bearer|http:\/\//); return true;
    });
  }
  assert.equal((await control('normal')).redirected, 0);
  assert.equal(store.read('contract', 'series').count, 0);
});

test('HTTP credential expiry and rotation are checked per request, not cached', { timeout: 45000 }, async (t) => {
  const { options } = await fixture(t); let token = 'expired', expiresAt = 0;
  const store = new CheckpointHttpStore({ ...options, credential: () => ({ token, expiresAt }) });
  assert.throws(() => store.read('contract', 'series'), /expired/);
  token = 'contract-only-credential'; expiresAt = Date.now() + 60000;
  assert.equal(store.read('contract', 'series').count, 0);
  expiresAt = 0; assert.throws(() => store.read('contract', 'series'), /expired/);
});

test('HTTP false acknowledgement requires explicit reconciliation of retained head', { timeout: 45000 }, async (t) => {
  const { store, control } = await fixture(t); const head = store.read('contract', 'series');
  const next = { ...head, count: 1, hash: '1'.repeat(64), digest: '2'.repeat(64) };
  await control('wrong-ack'); assert.throws(() => store.compareAndSet(head, next), /acknowledgement mismatch/);
  await control('normal'); assert.deepEqual(store.read('contract', 'series'), next);
  assert.equal((await control()).writes, 1);
});

test('transport rejects plaintext remote endpoints, embedded credentials and missing configuration', () => {
  const credential = () => ({ token: 'contract-only-credential', expiresAt: Date.now() + 60000 });
  for (const endpoint of ['http://remote.example', 'https://user:password@remote.example', 'https://remote.example?token=x', 'https://remote.example/#fragment']) assert.throws(() => new CheckpointHttpStore({ endpoint, credential, allowLoopbackHttp: true }), /endpoint/);
  assert.throws(() => checkpointBindingFromEnvironment({}), /configuration missing/);
  const local = new CheckpointHttpStore({ endpoint: 'http://127.0.0.1:1', allowLoopbackHttp: true, credential });
  for (const id of ['.', '..']) assert.throws(() => local.read(id, 'series'), /identity/);
});

test('two actual client processes cannot both update the same external expected head', { timeout: 45000 }, async (t) => {
  const { store, options, control } = await fixture(t); const expected = store.read('contract', 'series');
  const adapterURL = new URL('../src/science/checkpoint-http.ts', import.meta.url).href;
  const run = (digit: string) => {
    const next = { ...expected, count: 1, hash: digit.repeat(64), digest: digit.repeat(64) };
    const source = `import {CheckpointHttpStore} from ${JSON.stringify(adapterURL)};const store=new CheckpointHttpStore({endpoint:${JSON.stringify(options.endpoint)},allowLoopbackHttp:true,credential:()=>({token:'contract-only-credential',expiresAt:Date.now()+60000})});try{store.compareAndSet(${JSON.stringify(expected)},${JSON.stringify(next)})}catch{process.exitCode=3}`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: 'ignore' });
    return once(child, 'exit').then(([code]) => code);
  };
  assert.deepEqual((await Promise.all([run('1'), run('2')])).sort(), [0, 3]);
  assert.equal((await control()).writes, 1);
});

test('HTTP-backed runtime rejects both-file rollback and survives service outage without duplicate intervention', { timeout: 45000 }, async (t) => {
  const { runtime, control, root } = await fixture(t); const first = runtime();
  const file = join(root, 'ledger', 'ledger.json'), witness = readFileSync(first.ledger.checkpointPath, 'utf8');
  const input = { operationId: 'transport-completed-operation' }, result = first.run(input);
  assert.equal(result.intervention?.consistent, true);
  const raw = readFileSync(file, 'utf8'), currentWitness = readFileSync(first.ledger.checkpointPath, 'utf8');
  const count = (await control('unavailable')).writes;
  assert.throws(() => runtime().run(input), /service unavailable/);
  await control('normal'); assert.deepEqual(runtime().run(input), result);
  assert.equal((await control()).writes, count);
  writeFileSync(file, '[]'); writeFileSync(first.ledger.checkpointPath, witness);
  assert.throws(() => runtime().run(input), /external checkpoint mismatch/);
  writeFileSync(file, raw); writeFileSync(first.ledger.checkpointPath, currentWitness);
  assert.deepEqual(runtime().run(input), result);
});
