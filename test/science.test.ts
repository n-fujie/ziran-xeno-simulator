import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { Engine } from '../src/core/engine.ts';
import { Ledger } from '../src/science/store.ts';
import { ScientificRuntime, scientificFingerprint, parseRequest } from '../src/science/runtime.ts';
import type { FaultPoint } from '../src/science/runtime.ts';
import { acquire, configured, generate, measure, relation, instrument } from '../src/science/protocol.ts';

function setup(t: { after: (fn: () => void) => void }) {
  const directory = mkdtempSync(join(tmpdir(), 'science-test-'));
  t.after(() => { rmSync(directory, { recursive: true, force: true }); rmSync(`${directory}.checkpoint`, { force: true }); });
  return new ScientificRuntime(new Ledger(directory));
}

test('scientific cycle uses existing engine candidates and independently verifies adoption and actuation', (t) => {
  const runtime = setup(t), result = runtime.run({});
  assert.equal(result.state, 'completed');
  assert.equal(result.claimStatus, 'synthetic-world result');
  assert.equal(result.unexplained, true);
  assert.equal(result.adoptionVerified, true);
  assert.equal(result.intervention?.consistent, true);
  assert.ok(result.intervention!.after! < result.intervention!.before!);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(runtime.ledger.read().map((e) => e.kind), ['prepared', 'event', 'event', 'event', 'event', 'event', 'event', 'completed']);
  assert.deepEqual(runtime.ledger.read().filter((e) => e.kind === 'event').map((e) => (e.data as { phase: string }).phase), ['connect-issued', 'connect-confirmed', 'intervention-issued', 'intervention-remeasured', 'disconnect-issued', 'disconnect-confirmed']);
  assert.equal(result.resources.interventions, 1);
  assert.ok(result.generated.some((p) => p.parent && p.kinds.length === 2));
  assert.ok(result.decisions.some((d) => d.reason === 'loses-existing-target-channel'));
});

test('cohorts, measurement receipts and evaluation data are separate and traceable', (t) => {
  const result = setup(t).run({});
  const targets = ['generation', 'decision', 'evaluation'].map((partition) => new Set(result.measurements.filter((m) => m.partition === partition).map((m) => m.target)));
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok([...targets[i]].every((x) => !targets[j].has(x)));
  for (const m of result.measurements) {
    assert.ok(m.source && m.target && m.apparatus && m.channel && m.scale && m.acquiredAt);
    assert.ok(Number.isFinite(Date.parse(m.acquiredAt)));
    assert.ok(Array.isArray(m.historyRefs));
  }
  assert.equal(new Set(result.measurements.map((m) => m.id)).size, result.measurements.length);
  assert.equal(result.measurements.filter((m) => m.apparatus === 'independent-reference-probe').length, 6 * (2 + result.resources.evaluatedCandidates) + 2);
  for (const a of result.assessments) for (const id of a.measurementIds) assert.equal(result.measurements.find((m) => m.id === id)?.partition, a.partition);
  assert.equal(result.assessments.at(-1)?.partition, 'evaluation');
  assert.ok(result.decisions.every((d) => !d.reason.includes('evaluation')));
});

test('history survives restart and is fed into later candidate ordering without extra target data', (t) => {
  const runtime = setup(t), first = runtime.run({ method: 'history' });
  const restart = new ScientificRuntime(new Ledger(runtime.ledger.directory));
  const next = restart.run({ method: 'history', seed: 2 });
  assert.equal(first.provenance.historyRefs.length, 0);
  assert.equal(next.provenance.historyRefs.length, 1);
  assert.equal(next.generated[0].id, first.selected);
  assert.equal(next.reorganization.origin, 'bounded-compatible-history-feedback');
  assert.ok(next.measurements.every((m) => m.historyRefs.length === 1));
  const unrelated = restart.run({ method: 'history', condition: 'disconnected' });
  assert.deepEqual(unrelated.provenance.historyRefs, []);
  const ablation = restart.run({ method: 'no-history' });
  assert.deepEqual(ablation.provenance.historyRefs, []);
});

test('bounded grammar fails without a coupling and never invents target access', (t) => {
  const result = setup(t).run({ condition: 'disconnected' });
  assert.equal(result.selected, null);
  assert.equal(result.adoptionVerified, false);
  assert.equal(result.intervention, null);
  assert.ok(result.failures.includes('no-candidate-adopted'));
  assert.ok(result.generated.every((p) => !p.kinds.includes('placement')));
});

for (const condition of ['period-shift', 'threshold-shift'] as const) test(`${condition}: final failure is retained, isolated and never used to try another candidate`, (t) => {
  const result = setup(t).run({ condition });
  assert.ok(result.selected);
  assert.equal(result.adoptionVerified, false);
  assert.equal(result.state, 'quarantined');
  assert.equal(result.intervention, null);
  assert.equal(result.assessments.filter((a) => a.partition === 'evaluation').length, 1);
});

test('sensor fault is not interpreted as absence or a successful empty measurement', (t) => {
  const result = setup(t).run({ condition: 'sensor-fault' });
  assert.ok(result.measurements.some((m) => m.status === 'sensor-fault' && m.value === null));
  assert.equal(result.selected, null);
  assert.equal(result.intervention, null);
});

test('intervention model inconsistency is detected after independent remeasurement', (t) => {
  const result = setup(t).run({ condition: 'intervention-mismatch' });
  assert.equal(result.adoptionVerified, true);
  assert.equal(result.intervention?.consistent, false);
  assert.ok(result.intervention!.actualChange! > 0);
  assert.ok(result.failures.includes('intervention-model-mismatch'));
  assert.equal(result.state, 'quarantined');
});

test('no measurement, missing target, incompatible scale, boundary hiding and measured equality stay distinct', () => {
  const pair = acquire(1, 'generation', 'coupled')[0];
  const base = configured(pair.engines[0]);
  const make = (status: Parameters<typeof relation>[0][number]['status']) => ({ ...measure(base, pair, 0, [], new Date().toISOString(), 'coupled')[0], status });
  for (const status of ['not-measured', 'unmeasurable', 'sensor-fault', 'scale-incompatible', 'boundary-hidden', 'inaccessible', 'below-resolution'] as const) {
    assert.equal(relation([make(status)], [make(status)]), 'undetermined', status);
  }
  assert.equal(relation([make('detected')], [make('detected')]), 'no-difference-in-measured-channels');
  const missing = configured(pair.engines[0]); delete missing.state['target/x'];
  const readings = measure(missing, pair, 0, [], new Date().toISOString(), 'coupled');
  assert.equal(readings[0].status, 'unmeasurable');
  assert.equal(readings[0].value, null);
  const hidden = configured(pair.engines[0], { id: 'hidden', kinds: ['boundary'], cost: 0, description: 'test hidden boundary', apply: (emit) => emit.apparatus.patchChannel('science', 'x', { boundary: ['other/'] }) });
  assert.equal(measure(hidden, pair, 0, [], new Date().toISOString(), 'coupled')[0].status, 'boundary-hidden');
});

test('composed operations execute through the original apparatus reorganization API', () => {
  const pair = acquire(1, 'generation', 'coupled')[0];
  const proposal = generate(pair).find((p) => p.parent)!;
  const engine = configured(pair.engines[0], proposal);
  assert.ok(engine.apparatus.science.channels.some((c) => c.reads.includes('target/h')));
  assert.equal(engine.apparatus.science.channels.find((c) => c.id === 'x')?.window, 0);
  assert.ok(engine.events.some((e) => e.kind === 'reorganization'));
});

test('same seeds reproduce decisions, measurements, interventions and operational costs', (t) => {
  const a = setup(t).run({ seed: 23 });
  const b = setup(t).run({ seed: 23 });
  assert.equal(scientificFingerprint(a), scientificFingerprint(b));
});

test('fixed and zero-adoption methods never actuate; evaluation budget is enforced', (t) => {
  const runtime = setup(t);
  for (const request of [{ method: 'fixed' }, { adoptionLimit: 0 }, { budget: 1 }]) {
    const result = runtime.run(request);
    assert.equal(result.selected, null);
    assert.equal(result.intervention, null);
    assert.ok(result.resources.evaluatedCandidates <= (request.budget ?? 4));
  }
});

test('incompatible prior is an explicit stress condition, and cannot manufacture acceptance', (t) => {
  const result = setup(t).run({ method: 'mismatched-history', historyPolicy: 'synthetic-stress', budget: 1 });
  assert.equal(result.provenance.incompatibleHistoryUsed, true);
  assert.equal(result.generated[0].id, 'external memory 0 → 1 frames');
  assert.equal(result.selected, null);
});

test('adverse history can consume the same tight candidate cap and worsen results', (t) => {
  const runtime = setup(t);
  const ordinary = runtime.run({ method: 'adaptive', budget: 3 });
  const adverse = runtime.run({ method: 'mismatched-history', historyPolicy: 'synthetic-stress', budget: 3 });
  assert.equal(ordinary.adoptionVerified, true);
  assert.equal(adverse.adoptionVerified, false);
  assert.equal(ordinary.resources.evaluatedCandidates, adverse.resources.evaluatedCandidates);
});

test('always-search pays for unnecessary exploration in a stable target', (t) => {
  const runtime = setup(t);
  const adaptive = runtime.run({ method: 'adaptive', condition: 'stable' });
  const always = runtime.run({ method: 'always', condition: 'stable' });
  assert.equal(adaptive.unexplained, false);
  assert.equal(adaptive.resources.evaluatedCandidates, 0);
  assert.ok(always.resources.evaluatedCandidates > 0);
  assert.equal(always.selected, null);
  assert.equal(always.intervention, null);
});

test('final distribution shift cannot change decisions already made on independent data', (t) => {
  const runtime = setup(t);
  const ordinary = runtime.run({ condition: 'coupled' });
  const shifted = runtime.run({ condition: 'period-shift' });
  assert.deepEqual(ordinary.decisions, shifted.decisions);
  assert.equal(ordinary.selected, shifted.selected);
  assert.notEqual(ordinary.finalScore, shifted.finalScore);
});

test('quarantined scientific outcomes feed later avoidance without replaying old interventions', (t) => {
  const runtime = setup(t);
  const first = runtime.run({ condition: 'intervention-mismatch', method: 'history' });
  assert.equal(first.state, 'quarantined');
  const next = runtime.run({ condition: 'intervention-mismatch', method: 'history', seed: 2 });
  assert.equal(next.provenance.historyRefs.length, 1);
  assert.notEqual(next.generated[0].id, first.selected);
  assert.equal(runtime.ledger.read().filter((e) => e.kind === 'prepared').length, 2);
});

test('failed durable completion never returns an apparent success', (t) => {
  const runtime = setup(t);
  class FailingLedger extends Ledger {
    override append(kind: Parameters<Ledger['append']>[0], operation: string, data: unknown) {
      if (kind !== 'prepared') throw Error('injected storage unavailable');
      return super.append(kind, operation, data);
    }
  }
  const broken = new ScientificRuntime(new FailingLedger(runtime.ledger.directory));
  assert.throws(() => broken.run({}), /storage unavailable/);
  assert.deepEqual(runtime.ledger.read().map((e) => e.kind), ['prepared']);
  assert.throws(() => runtime.run({}), /recovery required/);
  assert.deepEqual(runtime.recover().map((e) => e.kind), ['prepared', 'quarantined']);
});

for (const point of ['after-prepare', 'after-adoption', 'after-intervention', 'before-complete'] as FaultPoint[]) test(`fault injection ${point}: no partial success or automatic replay`, (t) => {
  const runtime = setup(t);
  assert.throws(() => runtime.run({}, (p) => { if (p === point) throw Error(`injected ${point}`); }), /injected/);
  const entries = runtime.ledger.read();
  assert.deepEqual(entries.filter((e) => e.kind !== 'event').map((e) => e.kind), ['prepared', 'quarantined']);
  assert.equal(runtime.recover().length, entries.length);
  assert.equal(runtime.recover().length, entries.length);
});

test('real process exit leaves intent; explicit recovery isolates it without replaying actuation', (t) => {
  const runtime = setup(t);
  const moduleURL = new URL('../src/science/runtime.ts', import.meta.url).href;
  const storeURL = new URL('../src/science/store.ts', import.meta.url).href;
  const code = `import {ScientificRuntime} from ${JSON.stringify(moduleURL)}; import {Ledger} from ${JSON.stringify(storeURL)}; new ScientificRuntime(new Ledger(${JSON.stringify(runtime.ledger.directory)})).run({}, p => { if(p === 'after-intervention') process.exit(72); });`;
  assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', code], { stdio: 'pipe' }), (e: unknown) => (e as { status: number }).status === 72);
  assert.deepEqual(runtime.ledger.read().filter((e) => e.kind !== 'event').map((e) => e.kind), ['prepared']);
  assert.throws(() => runtime.run({}), /EEXIST/);
  const recovered = runtime.recover();
  assert.deepEqual(recovered.filter((e) => e.kind !== 'event').map((e) => e.kind), ['prepared', 'quarantined']);
  assert.equal(runtime.recover().length, recovered.length);
  assert.equal(runtime.run({ seed: 2 }).state, 'completed');
});

test('checksum corruption blocks both execution and recovery and preserves evidence', (t) => {
  const runtime = setup(t); runtime.run({});
  const file = join(runtime.ledger.directory, 'ledger.json');
  const data = readFileSync(file, 'utf8').replace('"version":2', '"version":3');
  writeFileSync(file, data);
  assert.throws(() => runtime.run({}), /integrity/);
  assert.throws(() => runtime.recover(), /integrity/);
  assert.equal(readFileSync(file, 'utf8'), data);
  assert.ok(!readdirSync(runtime.ledger.directory).includes('writer.lock'));
});

test('live writer is never stolen and invalid/unbounded HTTP requests are rejected', (t) => {
  const runtime = setup(t);
  writeFileSync(join(runtime.ledger.directory, 'writer.lock'), JSON.stringify({ pid: process.pid }));
  assert.throws(() => runtime.recover(), /alive/);
  assert.throws(() => runtime.run({}), /EEXIST/);
  for (const value of [null, [], { seed: NaN }, { seed: -1 }, { budget: 9 }, { budget: 0 }, { adoptionLimit: 2 }, { method: 'other' }, { path: '/tmp/attack' }]) assert.throws(() => parseRequest(value));
});
