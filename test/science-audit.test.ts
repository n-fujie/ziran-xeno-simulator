import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { Ledger } from './fixtures/ledger-mode.ts';
import { ScientificRuntime } from '../src/science/runtime.ts';
import { acquire, configured, generate, independentMeasurement, measure, relation } from '../src/science/protocol.ts';

function setup(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), 'science-audit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return new ScientificRuntime(new Ledger(join(root, 'ledger')));
}

test('separate checkpoint detects valid-prefix truncation, emptying and whole-ledger deletion', (t) => {
  for (const variant of ['prefix', 'empty', 'delete']) {
    const runtime = setup(t); runtime.run({ seed: 1 });
    const first = readFileSync(join(runtime.ledger.directory, 'ledger.json'), 'utf8');
    runtime.run({ seed: 2 });
    const file = join(runtime.ledger.directory, 'ledger.json');
    if (variant === 'delete') rmSync(file); else writeFileSync(file, variant === 'empty' ? '[]' : first);
    assert.throws(() => runtime.ledger.read(), /checkpoint mismatch/);
    assert.throws(() => runtime.recover(), /checkpoint mismatch/);
    assert.equal(existsSync(file), variant !== 'delete');
  }
});

test('missing witness is not silently recreated for a legacy or rolled-back ledger', (t) => {
  const runtime = setup(t); runtime.run({});
  rmSync(runtime.ledger.checkpointPath);
  const restarted = new Ledger(runtime.ledger.directory);
  assert.throws(() => restarted.read(), /missing separate checkpoint/);
});

test('externally retained head detects rollback of both local ledger and local witness', (t) => {
  const runtime = setup(t); runtime.run({ seed: 1 });
  const file = join(runtime.ledger.directory, 'ledger.json');
  const ledger = readFileSync(file, 'utf8'), checkpoint = readFileSync(runtime.ledger.checkpointPath, 'utf8');
  runtime.run({ seed: 2 }); const trusted = runtime.ledger.checkpoint();
  writeFileSync(file, ledger); writeFileSync(runtime.ledger.checkpointPath, checkpoint);
  assert.throws(() => runtime.ledger.verifyCheckpoint(trusted), /external checkpoint mismatch/);
});

test('legacy bootstrap requires an exact independently supplied head', (t) => {
  const runtime = setup(t); runtime.run({});
  const trusted = runtime.ledger.checkpoint(); rmSync(runtime.ledger.checkpointPath);
  assert.throws(() => runtime.ledger.bootstrapLegacy({ count: 0, hash: '' }), /external checkpoint mismatch/);
  runtime.ledger.bootstrapLegacy(trusted);
  runtime.ledger.verifyCheckpoint(trusted);
  assert.equal(runtime.ledger.read().at(-1)?.kind, 'completed');
});

test('interrupted replacement completes only the exact witnessed durable pending file', (t) => {
  const runtime = setup(t); runtime.run({});
  const file = join(runtime.ledger.directory, 'ledger.json'), previous = readFileSync(file, 'utf8');
  runtime.run({ seed: 2 });
  const checkpoint = runtime.ledger.checkpoint();
  renameSync(file, join(runtime.ledger.directory, checkpoint.pending)); writeFileSync(file, previous);
  assert.throws(() => runtime.ledger.read(), /checkpoint mismatch/);
  runtime.recover(); runtime.ledger.verifyCheckpoint(checkpoint);
  assert.equal(runtime.ledger.read().filter((e) => e.kind === 'completed').length, 2);
});

test('corrupt pre-witnessed pending file is isolated instead of trusted', (t) => {
  const runtime = setup(t); runtime.run({});
  const checkpoint = runtime.ledger.checkpoint(), file = join(runtime.ledger.directory, 'ledger.json');
  renameSync(file, join(runtime.ledger.directory, checkpoint.pending)); writeFileSync(file, '[]');
  writeFileSync(join(runtime.ledger.directory, checkpoint.pending), '[]');
  assert.throws(() => runtime.recover(), /pending replacement mismatch/);
  assert.equal(readFileSync(file, 'utf8'), '[]');
});

test('one operation ID restores exact saved state after restart without new events or actuation', (t) => {
  const runtime = setup(t);
  const request = { operationId: 'audit-operation-001', seed: 19 };
  const original = runtime.run(request), length = runtime.ledger.read().length;
  const restarted = new ScientificRuntime(new Ledger(runtime.ledger.directory));
  assert.deepEqual(restarted.run(request), original);
  assert.equal(restarted.ledger.read().length, length);
  assert.equal(original.snapshot.target['target/u'], 0);
  assert.equal(original.snapshot.restoration, 'audit-only; no live device restored');
  assert.throws(() => restarted.run({ ...request, seed: 20 }), /operationId conflict/);
});

test('uncertain operation IDs remain quarantined after recovery and cannot execute again', (t) => {
  const runtime = setup(t), request = { operationId: 'audit-operation-002' };
  assert.throws(() => runtime.run(request, (point) => { if (point === 'after-connect') throw Error('lost connect acknowledgement'); }));
  const length = runtime.ledger.read().length;
  runtime.recover();
  assert.throws(() => runtime.run(request), /quarantined; never replay/);
  assert.equal(runtime.ledger.read().length, length);
});

for (const point of ['after-connect', 'after-disconnect'] as const) test(`SIGKILL ${point}: uncertain device phase remains isolated`, (t) => {
  const runtime = setup(t);
  const runtimeURL = new URL('../src/science/runtime.ts', import.meta.url).href;
  const storeURL = new URL('../src/science/store.ts', import.meta.url).href;
  const source = `import {ScientificRuntime} from ${JSON.stringify(runtimeURL)};import {Ledger} from ${JSON.stringify(storeURL)};new ScientificRuntime(new Ledger(${JSON.stringify(runtime.ledger.directory)})).run({},p=>{if(p===${JSON.stringify(point)})process.kill(process.pid,'SIGKILL')});`;
  assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', source], { stdio: 'pipe' }), (e: unknown) => (e as { signal: string }).signal === 'SIGKILL');
  const recovered = runtime.recover();
  const last = recovered.at(-1)!;
  assert.equal(last.kind, 'quarantined');
  const data = last.data as { lastPhase: { phase: string }; physicalRecoveryVerified: boolean };
  assert.equal(data.lastPhase.phase, point === 'after-connect' ? 'connect-issued' : 'disconnect-issued');
  assert.equal(data.physicalRecoveryVerified, false);
  assert.equal(runtime.recover().length, recovered.length);
});

test('second process cannot commit or steal a live writer lock', (t) => {
  const runtime = setup(t);
  const storeURL = new URL('../src/science/store.ts', import.meta.url).href;
  const code = `import {Ledger} from ${JSON.stringify(storeURL)};const l=new Ledger(${JSON.stringify(runtime.ledger.directory)});try{l.exclusive(()=>{})}catch(e){if(e.code==='EEXIST')process.exit(23);throw e}`;
  runtime.ledger.exclusive(() => assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', code], { stdio: 'pipe' }), (e: unknown) => (e as { status: number }).status === 23));
  assert.deepEqual(runtime.ledger.read(), []);
  assert.throws(() => runtime.ledger.append('prepared', 'unlocked', {}), /exclusive writer/);
});

test('relabelled engine snapshots and fake cohort IDs are rejected', () => {
  const generation = acquire(1, 'generation', 'coupled')[0];
  const engine = configured(generation.engines[0]);
  assert.throws(() => measure(engine, { ...generation, id: 'decision:fake', partition: 'decision' }, 0, [], '', 'coupled'), /provenance mismatch/);
  const decision = acquire(1, 'decision', 'coupled')[0];
  assert.throws(() => measure(engine, decision, 0, [], '', 'coupled'), /provenance mismatch/);
  // Even identical IDs/values cannot substitute another actual acquisition instance.
  const duplicateID = acquire(1, 'generation', 'coupled')[0];
  assert.equal(duplicateID.id, generation.id);
  assert.throws(() => measure(engine, duplicateID, 0, [], '', 'coupled'), /provenance mismatch/);
  assert.throws(() => measure(engine, acquire(1, 'generation', 'disconnected')[0], 0, [], '', 'coupled'), /provenance mismatch/);
});

test('each candidate slot has independent acquisition origins and different target draws', () => {
  const a = acquire(5, 'decision', 'coupled', 3, 0), b = acquire(5, 'decision', 'coupled', 3, 1);
  assert.notEqual(a[0].id, b[0].id);
  assert.notEqual(a[0].engines[1].state['target/h'], b[0].engines[1].state['target/h']);
  assert.ok(a.flatMap((p) => p.referenceEvidence).every((x) => !b.flatMap((p) => p.referenceEvidence).some((y) => x.acquisitionKey === y.acquisitionKey)));
});

test('empty, null, nonfinite or incompatible successful readings do not prove absence', () => {
  assert.equal(relation([], []), 'undetermined');
  const pair = acquire(1, 'generation', 'stable')[0];
  const reading = measure(configured(pair.engines[0]), pair, 0, [], '', 'stable')[0];
  for (const value of [null, undefined, NaN, Infinity]) assert.equal(relation([{ ...reading, value }], [{ ...reading, value }]), 'undetermined');
  assert.equal(relation([reading], [{ ...reading, scale: 'different-scale' }]), 'undetermined');
  assert.equal(relation([reading], [{ ...reading, deviceSpecHash: 'different-device' }]), 'undetermined');
  assert.equal(relation([reading], [reading]), 'no-difference-in-measured-channels');
});

test('cached samples cannot receive a later acquisition time; independent read detects intervening state', () => {
  const pair = acquire(3, 'control', 'coupled')[0];
  const engine = configured(pair.engines[1]);
  engine.state['target/x'] = 7;
  assert.equal(measure(engine, pair, 1, [], '', 'coupled')[0].value, 0);
  assert.equal(independentMeasurement(engine, pair, 1, 'target/x', []).value, 7);
  engine.run(0.5);
  const stale = measure(engine, pair, 1, [], '', 'coupled')[0];
  assert.equal(stale.simulationTime, 0);
  assert.equal(stale.status, 'not-measured');
  assert.equal(stale.value, null);
});

test('adopted connection and independent post-intervention references are actual separate paths', (t) => {
  const runtime = setup(t), result = runtime.run({});
  assert.equal(result.connection.connected, true); assert.equal(result.connection.disconnected, true);
  const receipts = result.intervention!.measurementIds.map((id) => result.measurements.find((m) => m.id === id)!);
  const refs = receipts.filter((m) => m.apparatus === 'independent-control-reference');
  assert.equal(refs.length, 3); assert.ok(refs.every((m) => m.route === 'Engine.readChannel' && m.partition === 'control'));
  assert.equal(refs.find((m) => m.channel === 'target/x' && m.simulationTime === 2)?.value, result.intervention!.after);
  assert.ok(result.measurements.filter((m) => m.partition === 'evaluation').every((m) => !refs.some((r) => r.target === m.target)));
  assert.equal(new Set(result.measurements.map((m) => m.acquisitionKey)).size, result.measurements.length);
  const issued = runtime.ledger.read().find((e) => e.kind === 'event' && (e.data as { phase: string }).phase === 'intervention-issued')!.data as { detail: { action: number; expectedChange: number; address: string } };
  assert.equal(issued.detail.action, result.intervention!.action);
  assert.equal(issued.detail.expectedChange, result.intervention!.actualChange);
  assert.equal(issued.detail.address, 'target/u');
});

test('same-seed historical evaluation packets cannot leak into a nominally new episode', (t) => {
  const runtime = setup(t); runtime.run({ method: 'history', seed: 4 });
  const repeated = runtime.run({ method: 'history', seed: 4 });
  assert.deepEqual(repeated.provenance.historyRefs, []);
  assert.equal(runtime.run({ method: 'history', seed: 5 }).provenance.historyRefs.length, 1);
});

test('mismatched method consumes actual foreign records; synthetic adverse prior remains separate', (t) => {
  const runtime = setup(t);
  const past = runtime.run({ seed: 1, condition: 'coupled' });
  const result = runtime.run({ seed: 2, condition: 'disconnected', method: 'mismatched-history' });
  assert.ok(past.adoptionVerified);
  assert.equal(result.provenance.historyRefs.length, 1);
  assert.equal(result.provenance.incompatibleHistoryUsed, true);
  assert.ok(result.generationRevision.expired.includes(past.selected!));
  assert.equal(result.reorganization.origin, 'incompatible-history-stress');
});

test('residual-conditioned grammar creates structure, expires missing parents and regenerates for current graph', () => {
  const pair = acquire(7, 'generation', 'coupled')[0];
  const parent = generate(pair).find((p) => p.kinds[0] === 'placement')!;
  const revised = generate(pair, { residual: 1, rejected: [parent.id] });
  const child = revised.find((p) => p.revision)!;
  assert.ok(child && !generate(pair).some((p) => p.id === child.id));
  const engine = configured(pair.engines[0], child);
  assert.ok(engine.apparatus.science.channels.some((c) => c.construct?.op === 'abs'));
  assert.ok(!generate(pair, { residual: 0, rejected: [parent.id] }).some((p) => p.revision));
  assert.ok(!generate(acquire(7, 'generation', 'disconnected')[0], { residual: 1, rejected: [parent.id] }).some((p) => p.id === child.id));
});

test('failed final evaluation cannot connect a live target or actuate', (t) => {
  const runtime = setup(t), result = runtime.run({ condition: 'period-shift' });
  assert.equal(result.connection.connected, false);
  assert.equal(result.intervention, null);
  assert.equal(runtime.ledger.read().filter((e) => e.kind === 'event').length, 0);
});

test('cost ledger includes independent reference acquisitions and generation/ranking/decision work', (t) => {
  const result = setup(t).run({ budget: 3 });
  assert.equal(result.resources.measurementCount + result.resources.referenceMeasurements, result.measurements.length);
  assert.equal(result.resources.generatedCandidates, result.generated.length);
  assert.ok(result.resources.rankingComparisons > 0);
  assert.equal(result.resources.operationUnits, result.measurements.length + result.generated.length + result.resources.evaluatedCandidates + result.resources.rankingComparisons);
  for (const key of ['generationMs', 'generationCpuMicros', 'rankingMs', 'rankingCpuMicros', 'decisionMs', 'decisionCpuMicros', 'historyQueryMs', 'historyQueryCpuMicros'] as const) assert.ok(result.resources[key] >= 0);
});
