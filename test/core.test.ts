import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorldSpec } from '../src/core/types.ts';
import { Engine } from '../src/core/engine.ts';
import { exportTrace, validateTrace, replayState } from '../src/core/trace.ts';
import { runSpec, runLight, diffTraces, nonRedundancy } from '../src/core/counterfactual.ts';
import { applyPerturbations, PERTURBATION_TYPES, type Perturbation } from '../src/core/perturbations.ts';
import { penetration } from '../src/core/penetration.ts';
import { tiiRecords, sharedTIIs } from '../src/core/tii.ts';

const base = (over: Partial<WorldSpec> = {}): WorldSpec => ({
  id: 't', seed: 1, horizon: 10, state: { x: 0, y: 0, r: 1 }, clocks: [{ id: 'c', period: 1 }], rules: [], ...over,
});

test('exact rerun: same spec → same run hash; different seed → different', () => {
  const s = base({ rules: [{ id: 'noise', clock: 'c', when: () => 0.5, then: (c, e) => e.add('x', c.rng()) }] });
  assert.equal(runSpec(s).meta.runHash, runSpec(s).meta.runHash);
  assert.notEqual(runSpec(s).meta.runHash, runSpec({ ...s, seed: 2 }).meta.runHash);
});

test('writes without an actual difference are recorded as no-effect, not as real effects', () => {
  const tr = runSpec(base({ horizon: 2, rules: [{ id: 'same', clock: 'c', when: () => true, then: (_c, e) => e.set('x', 0) }] }));
  assert.equal(tr.events.filter((e) => e.kind === 'effect').length, 0);
  assert.ok(tr.events.some((e) => e.kind === 'no-effect' && e.why === 'no-difference'));
  const op = tr.events.find((e) => e.kind === 'operation')!;
  assert.equal(op.realEffects, 0);
});

test('delayed operation: intents computed at ignition, applied after delay', () => {
  const tr = runSpec(base({ horizon: 6, rules: [
    { id: 'late', clock: 'c', delay: 3, when: (c) => c.tick === 1, then: (c, e) => e.set('y', c.get('x')) },
    { id: 'inc', clock: 'c', when: () => true, then: (_c, e) => e.add('x', 1) },
  ] }));
  const eff = tr.events.find((e) => e.kind === 'effect' && e.address === 'y');
  // x was 0 at ignition (t=0); intent carries that value even though x has grown since.
  assert.equal(eff, undefined, 'y stays 0: stale intent writes no difference');
  const op = tr.events.find((e) => e.kind === 'operation' && e.rule === 'late')!;
  assert.equal(op.t, 3);
});

test('synchronous ignition: rules on one clock see the same pre-tick state', () => {
  const tr = runSpec(base({ horizon: 0, rules: [
    { id: 'a', clock: 'c', when: (c) => c.get('x') === 0, then: (_c, e) => e.add('x', 1) },
    { id: 'b', clock: 'c', when: (c) => c.get('x') === 0, then: (_c, e) => e.add('x', 1) },
  ] }));
  assert.equal(tr.final.state.x, 2);
  const inter = tr.events.find((e) => e.kind === 'interaction')!;
  assert.equal(inter.mode, 'cooperation');
});

test('resource consumption is atomic: an unmet need blocks the whole operation', () => {
  const tr = runSpec(base({ horizon: 3, rules: [{ id: 'spend', clock: 'c', when: () => true, then: (_c, e) => { e.consume('r', 0.6); e.add('y', 1); } }] }));
  assert.equal(tr.final.state.y, 1);
  assert.ok(tr.events.filter((e) => e.kind === 'blocked').length >= 2);
});

test('couplings: delay, gain, threshold loss, rectification, cross-medium penetration', () => {
  const tr = runSpec(base({
    horizon: 6, addresses: { x: { medium: 'm1' }, y: { medium: 'm2' } },
    rules: [{ id: 'kick', clock: 'c', when: (c) => c.tick <= 3, then: (c, e) => e.add('x', c.tick === 2 ? -1 : c.tick === 3 ? 0.1 : 1) }],
    couplings: [{ id: 'xy', from: 'x', to: 'y', gain: 2, delay: 0.5, medium: 'm2', transform: 'rectify' }, { id: 'xz', from: 'x', to: 'z', gain: 1, transform: 'threshold', threshold: 0.5 }],
  }));
  const ys = tr.events.filter((e) => e.kind === 'effect' && e.address === 'y');
  // tick 1 at t=0 (+1), tick 2 at t=1 (−1, rectified away), tick 3 at t=2 (+0.1)
  assert.deepEqual(ys.map((e) => [e.t, Math.round(e.delta * 1e9) / 1e9]), [[0.5, 2], [2.5, 0.2]]);
  assert.ok(tr.events.some((e) => e.kind === 'loss' && e.coupling === 'xy' && e.why === 'below-threshold'), 'negative delta rectified away');
  assert.ok(tr.events.some((e) => e.kind === 'loss' && e.coupling === 'xz'));
  const p = penetration(tr, tr.events.find((e) => e.kind === 'effect' && e.address === 'x')!.seq);
  assert.ok(p.crossMedium >= 1 && p.reached.includes('y'));
});

test('epistemic statuses never include absence; replay reproduces final state', () => {
  const tr = runSpec(base({
    rules: [{ id: 'w', clock: 'c', when: () => true, then: (c, e) => { e.add('x', 0.01); e.add('hidden', 1); } }],
    apparatus: [{ id: 'A', channels: [{ id: 'x', clock: 'c', reads: ['x'], resolution: 1 }] }],
  }));
  const st = new Set(Object.values(tr.epistemic.A));
  assert.ok(st.has('below-resolution') && st.has('not-measured'));
  assert.ok(!st.has('absent' as never));
  assert.deepEqual(validateTrace(tr), []);
  assert.deepEqual(replayState(tr, Infinity), tr.final.state);
});

test('aliasing is recorded, and reset when the observation map changes', () => {
  const s = base({ horizon: 30, state: { x: 0, h: 1 },
    rules: [
      { id: 'flip', clock: 'c', when: (c) => c.tick % 5 === 0, then: (c, e) => e.set('h', -c.get('h')) },
      { id: 'push', clock: 'c', when: (c) => c.tick % 2 === 1, then: (c, e) => e.set('x', c.get('h')) },
      { id: 'reset', clock: 'c', when: (c) => c.tick % 2 === 0, then: (_c, e) => e.set('x', 0) },
    ],
    apparatus: [{ id: 'A', aliasing: true, channels: [{ id: 'x', clock: 'c', reads: ['x'] }] }] });
  const tr = runSpec(s);
  assert.ok(tr.events.some((e) => e.kind === 'aliasing'));
  const with2 = runSpec({ ...s, apparatus: [{ id: 'A', aliasing: true, channels: [{ id: 'x', clock: 'c', reads: ['x'] }, { id: 'h', clock: 'c', reads: ['h'] }] }] });
  assert.ok(with2.events.filter((e) => e.kind === 'aliasing').length < tr.events.filter((e) => e.kind === 'aliasing').length);
});

test('feedback is detected structurally, including through observation', () => {
  const tr = runSpec(base({
    rules: [{ id: 'ctl', clock: 'c', when: (c) => (c.obs('A', 'y').value ?? 0) < 3, then: (_c, e) => e.add('x', 1) }],
    couplings: [{ id: 'xy', from: 'x', to: 'y', gain: 1 }],
    apparatus: [{ id: 'A', channels: [{ id: 'y', clock: 'c', reads: ['y'] }] }],
  }));
  assert.ok((tr.loops as any[]).some((l) => l.originRule === 'ctl' && l.key === 'a:y' && l.kind === 'observation-mediated'));
});

test('reorganization: dimensions split/merge with lineage; addresses reassigned; prefix removal', () => {
  const tr = runSpec(base({
    horizon: 3, config: [{ key: 'boundary', status: 'specified', value: 'x' }],
    couplings: [{ id: 'k', from: 'p/a', to: 'x', gain: 1 }], state: { 'p/a': 1, x: 0, 'q/b': 2 },
    apparatus: [{ id: 'A', channels: [{ id: 'pa', clock: 'c', reads: ['p/a'] }] }],
    interventions: [
      { id: 'split', t: 1, kind: 'emit', apply: (_c, e) => e.dim.split('boundary', [{ key: 'inner', status: 'partial' }, { key: 'outer', status: 'unknown' }]) },
      { id: 'merge', t: 2, kind: 'emit', apply: (_c, e) => e.dim.merge(['inner', 'outer'], { key: 'boundary2', status: 'specified' }) },
      { id: 'move', t: 2, kind: 'emit', apply: (_c, e) => { e.address.reassign('p/', 'z/'); e.address.remove('q/'); } },
    ],
  }));
  const dims = tr.final.config as any[];
  assert.deepEqual(dims.map((d) => d.key), ['boundary2']);
  assert.deepEqual(dims[0].lineage, ['boundary', 'inner', 'outer']);
  assert.ok('z/a' in tr.final.state && !('p/a' in tr.final.state) && !('q/b' in tr.final.state));
  assert.equal((tr.final.couplings as any[])[0].from, 'z/a');
  assert.deepEqual((tr.final.apparatus as any[])[0].channels[0].reads, ['z/a']);
  assert.deepEqual(validateTrace(tr), []);
});

test('clocks are asynchronous and may be rate-coupled to the world', () => {
  const tr = runSpec(base({ horizon: 20, state: { speed: 1 }, clocks: [{ id: 'slow', period: 4 }, { id: 'fast', period: 1, rate: { address: 'speed', gain: 1 } }],
    rules: [{ id: 'a', clock: 'slow', when: () => true, then: (_c, e) => e.add('n', 1) }, { id: 'b', clock: 'fast', when: () => true, then: (_c, e) => e.add('m', 1) }] }));
  const ticks = Object.fromEntries((tr.final.clocks as any[]).map((c) => [c.id, c.ticks]));
  assert.equal(ticks.slow, 6);
  assert.equal(ticks.fast, 41);
});

test('forking for reachability does not disturb the main run', () => {
  const s = base({ horizon: 20, rules: [{ id: 'grow', clock: 'c', when: () => 0.5, then: (_c, e) => e.add('x', 1) }],
    probes: [{ id: 'x5', test: (c) => c.get('x') >= 5 }] });
  const plain = runSpec(s, { reachability: false });
  const withReach = runSpec({ ...s, reach: { every: 5, horizon: 10 } });
  assert.deepEqual(plain.final.state, withReach.final.state);
  assert.ok(withReach.probeRelativeReachability.length >= 3);
  assert.equal(withReach.emergentReachability.length, withReach.probeRelativeReachability.length);
});

test('suppress and shift interventions (counterfactual presence and timing)', () => {
  const s = base({ horizon: 5, rules: [{ id: 'once', clock: 'c', when: (c) => c.tick === 1, then: (_c, e) => e.set('y', 1) }] });
  const sup = runSpec({ ...s, interventions: [{ id: 's', kind: 'suppress', rule: 'once', occurrence: 0 }] });
  assert.equal(sup.final.state.y, 0);
  const sh = runSpec({ ...s, interventions: [{ id: 'd', kind: 'shift', rule: 'once', dt: 2 }] });
  assert.equal(sh.events.find((e) => e.kind === 'effect' && e.address === 'y')!.t, 2);
  assert.ok(!diffTraces(runSpec(s), sh).identical);
});

test('correction classification separates epistemic validity from operational timeliness', () => {
  const mk = (flipAt: number) => base({ horizon: 12, state: { env: 1, x: -1 },
    rules: [
      { id: 'env', clock: 'c', when: (c) => c.tick === flipAt, then: (_c, e) => e.set('env', -1) },
      { id: 'fix', clock: 'c', delay: 3, when: (c) => c.tick === 1, then: (c, e) => e.set('x', c.get('env')), correction: { premise: (c, b) => c.get('env') === b['a:env'] } },
    ] });
  const inTime = runSpec(mk(20)).events.find((e) => e.kind === 'correction')!;
  const late = runSpec(mk(3)).events.find((e) => e.kind === 'correction')!;
  assert.equal(inTime.label, 'correct-in-time');
  assert.equal(late.label, 'correct-but-too-late');
  assert.equal(late.reconfigT, 2); // env flips at tick 3 = t 2, before the effect lands at t 3
});

test('TIIs are deterministic and shared across exact reruns', () => {
  const s = base({ rules: [{ id: 'mark', clock: 'c', tii: true, when: (c) => c.tick % 3 === 0, then: (_c, e) => e.add('x', 1) }] });
  const a = runSpec(s), b = runSpec(s);
  assert.ok(tiiRecords(a).length > 0);
  assert.equal(sharedTIIs(a, b).length, tiiRecords(a).length);
  assert.ok(tiiRecords(a).every((r) => r.identifier_status === 'test' && r.tii.startsWith('tii-test:')));
});

test('all 20 perturbation types apply', () => {
  const s = base({ horizon: 8, config: [{ key: 'k', status: 'partial' }], state: { x: 0, 'm/a': 1, r: 2 },
    rules: [{ id: 'r1', clock: 'c', when: () => true, then: (_c, e) => e.add('x', 1) }],
    couplings: [{ id: 'k1', from: 'x', to: 'y', gain: 1, medium: 'electrical' }],
    apparatus: [{ id: 'A', channels: [{ id: 'x', clock: 'c', reads: ['x'] }] }],
    interventions: [{ id: 'iv', t: 2, kind: 'add', address: 'x', value: 1 }] });
  const P: Record<string, Perturbation> = {
    configuration: { type: 'configuration', key: 'k', patch: { status: 'specified' } },
    observation: { type: 'observation', apparatus: 'A', channel: 'x', patch: { resolution: 1 }, at: 2 },
    boundary: { type: 'boundary', apparatus: 'A', boundary: ['m/'] },
    scale: { type: 'scale', apparatus: 'A', channel: 'x', aggregate: 'sum', reads: ['x', 'y'] },
    'temporal-window': { type: 'temporal-window', clock: 'c', period: 2 },
    resource: { type: 'resource', address: 'r', delta: 1, at: 3 },
    'medium-substitution': { type: 'medium-substitution', to: 'chemical', table: { electrical: { gain: 1 }, chemical: { gain: 0.5, delay: 2 } } },
    'sensor-replacement': { type: 'sensor-replacement', apparatus: 'A', channel: 'x', with: { id: 'x2', clock: 'c', reads: ['y'] } },
    'memory-removal': { type: 'memory-removal', prefix: 'm/', at: 4 },
    'address-reassignment': { type: 'address-reassignment', from: 'm/', to: 'n/', at: 1 },
    'goal-insertion': { type: 'goal-insertion', rule: { id: 'g', clock: 'c', when: () => true, then: (_c, e) => e.note('goal.declared', { goal: 'g' }) }, at: 2 },
    'goal-removal': { type: 'goal-removal', rule: 'r1', at: 5 },
    'institutional-rule': { type: 'institutional-rule', rule: 'r1', enabled: false },
    'physical-implementation': { type: 'physical-implementation', coupling: 'k1', patch: { gain: 3 } },
    'reconstruction-transfer': { type: 'reconstruction-transfer', bundle: { id: 'b', state: { q: 1 }, rules: [{ id: 'q', clock: 'c', when: () => true, then: (_c, e) => e.add('q', 1) }] } },
    hybridization: { type: 'hybridization', bundles: [{ id: 'h', rules: [{ id: 'h1', clock: 'c', when: () => true, then: (_c, e) => e.add('x', -0.5) }] }] },
    'counterfactual-removal': { type: 'counterfactual-removal', rule: 'r1', occurrence: 0 },
    'delayed-intervention': { type: 'delayed-intervention', intervention: 'iv', dt: 3 },
    'feedback-interruption': { type: 'feedback-interruption', couplings: ['k1'], at: 3 },
    'reorganization-trigger': { type: 'reorganization-trigger', at: 2, apply: (_c, e) => e.dim.set('new', { status: 'unknown' }) },
  };
  assert.deepEqual(Object.keys(P).sort(), [...PERTURBATION_TYPES].sort());
  for (const [k, p] of Object.entries(P)) {
    const tr = runSpec(applyPerturbations(s, [p]));
    assert.deepEqual(validateTrace(tr), [], k);
    const changed = !diffTraces(runSpec(s), tr).identical || JSON.stringify(tr.final.config) !== JSON.stringify(runSpec(s).final.config);
    assert.ok(changed, `${k} changed nothing`);
  }
});

test('non-redundancy test distinguishes a mattering from an idle distinction', () => {
  const s = base({ horizon: 10, rules: [{ id: 'use', clock: 'c', when: (c) => c.get('flag') > 0, then: (_c, e) => e.add('x', 1) }], state: { x: 0, flag: 1, idle: 1 } });
  const m = (e: Engine) => ({ x: e.state.x as number });
  assert.equal(nonRedundancy({ subject: 'flag', base: s, variant: [{ type: 'resource', address: 'flag', value: 0 }], metric: m }).redundant, false);
  assert.equal(nonRedundancy({ subject: 'idle', base: s, variant: [{ type: 'resource', address: 'idle', value: 0 }], metric: m }).redundant, true);
});

test('light runs and traced runs reach the same world state', () => {
  const s = base({ horizon: 30, rules: [{ id: 'n', clock: 'c', when: () => 0.7, then: (c, e) => e.add('x', c.rng() - 0.5) }], couplings: [{ id: 'k', from: 'x', to: 'y', gain: 0.5, delay: 1 }] });
  assert.deepEqual(runLight(s).state, exportTrace(new Engine(s).run()).final.state);
});
