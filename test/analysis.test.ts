import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorldSpec } from '../src/core/types.ts';
import { runSpec } from '../src/core/counterfactual.ts';
import { localRate, allRates } from '../src/analysis/rates.ts';
import { gini, fragilityTransfer } from '../src/analysis/fragility.ts';
import { evaluateVocabulary, compareVocabularies } from '../src/analysis/vocabulary.ts';
import { grammarBoundedDiscovery } from '../src/analysis/grammar-bounded.ts';
import { compareRuns, LEVELS } from '../src/analysis/compare.ts';
import { analyzeGoal } from '../src/analysis/goals.ts';
import { responsibilityPoints } from '../src/analysis/responsibility.ts';
import { sampleStates } from '../src/analysis/samples.ts';
import { corrections } from '../src/analysis/timing.ts';
import { sharedLoad, SHARED_LOAD_REGIONS, tooLate } from '../src/domains/foundations.ts';

const spec = (over: Partial<WorldSpec> = {}): WorldSpec => ({ id: 'a', seed: 3, horizon: 50, state: { x: 0 }, clocks: [{ id: 'c', period: 1 }], rules: [], ...over });

test('rates: unavailable when too few events or redundant; available when they vary with configuration', () => {
  const none = runSpec(spec());
  assert.equal(localRate(none, 'ignition').available, false);
  const constant = runSpec(spec({ rules: [{ id: 'r', clock: 'c', when: () => true, then: (_c, e) => e.add('x', 1) }] }));
  const c = localRate(constant, 'ignition');
  assert.equal(c.available, false); assert.match(c.why!, /redundant/);
  const varying = runSpec(spec({ rules: [{ id: 'r', clock: 'c', when: (c) => c.t < 20 || c.tick % 5 === 0, then: (_c, e) => e.add('x', 1) }] }));
  assert.equal(localRate(varying, 'ignition').available, true);
  assert.ok(allRates(varying).every((r) => r.windows.length === 5));
});

test('fragility: gini and transfer verdict on shared load', () => {
  assert.equal(gini([0, 0, 0]), 0);
  assert.ok(gini([0, 0, 9]) > 0.6);
  const r = fragilityTransfer(runSpec(sharedLoad.build({ ...sharedLoad.defaults, k: 0 })), runSpec(sharedLoad.build({ ...sharedLoad.defaults, k: 2 })), SHARED_LOAD_REGIONS, 'A');
  assert.equal(r.verdict, 'local-improvement-with-fragility-transfer');
});

test('vocabulary: a partition predictive of the future is non-redundant; an arbitrary one is not', () => {
  const tr = runSpec(spec({ horizon: 200, state: { x: 0, s: 1 }, rules: [
    { id: 'switch', clock: 'c', when: (c) => c.tick % 25 === 0, then: (c, e) => e.set('s', -c.get('s')) },
    { id: 'drift', clock: 'c', when: () => true, then: (c, e) => e.add('x', c.get('s') + 0.2 * (c.rng() - 0.5)) },
  ] }));
  const S = sampleStates(tr, 1);
  const target = { id: 'dx', value: (s: Record<string, number>) => s.s, lag: 3 };
  const good = evaluateVocabulary(S, { id: 'regime', classify: (s) => (s.s > 0 ? 'up' : 'down') }, target);
  const bad = evaluateVocabulary(S, { id: 'parity', classify: (_s, t) => (Math.floor(t) % 2 ? 'odd' : 'even') }, target);
  assert.equal(good.nonRedundant, true); assert.equal(bad.nonRedundant, false);
  const cmp = compareVocabularies(S, { id: 'regime', classify: (s) => (s.s > 0 ? 'up' : 'down') }, { id: 'regime2', classify: (s) => (s.s > 0 ? 'A' : 'B') }, target);
  assert.equal(cmp.verdict, 'isolate-same-difference');
});

test('grammar-bounded discovery: selects a velocity-like variable from the supplied grammar', () => {
  const n = 120, v: number[] = [0];
  for (let i = 1; i < n; i++) v.push(v[i - 1] + Math.sin(i / 7));
  const r = grammarBoundedDiscovery({ p: v }, { maxAccept: 3 });
  assert.ok(r.accepted.length >= 1);
  assert.ok(r.relativeImprovement > 0.5);
  assert.ok(r.accepted.every((g) => /^g\d+$/.test(g.id)), 'machine names, not human names');
});

test('compare: identical runs agree at every applicable level', () => {
  const s = spec({ rules: [{ id: 'r', clock: 'c', when: (c) => c.tick % 3 === 0, then: (_c, e) => e.add('x', 1) }] });
  const c = compareRuns(runSpec(s), runSpec(s));
  for (const l of LEVELS) if (c.levels[l] !== null) assert.equal(c.levels[l], 1, l);
});

test('goals: declared / represented / pursued / maintained / achieved stay separable', () => {
  const s = spec({ horizon: 60, state: { x: 5, 'goal/x': 0 }, probes: [{ id: 'near', test: (c) => Math.abs(c.get('x')) < 0.1 }], rules: [
    { id: 'pursue', clock: 'c', when: (c) => Math.abs(c.get('x') - c.get('goal/x')) > 0.01, then: (c, e) => e.add('x', 0.2 * (c.get('goal/x') - c.get('x'))) },
    { id: 'disturb', clock: 'c', when: (c) => c.tick % 20 === 0, then: (_c, e) => e.add('x', 1) },
  ] });
  const r = analyzeGoal(s, runSpec(s), { id: 'zero', declaredNote: 'goal.declared', representation: 'goal/x', deviation: (st) => Math.abs(st.x - (st['goal/x'] ?? 0)), band: 1.1, achievedProbe: 'near', removal: [{ type: 'goal-removal', rule: 'pursue' }] });
  assert.equal(r.declared, false, 'never declared — yet pursued');
  assert.equal(r.causallyPursued, true);
  assert.equal(r.operationallyMaintained, true);
  assert.equal(r.achieved, true);
});

test('responsibility points are profiles located at rules/addresses, not single scores', () => {
  const s = spec({ horizon: 20, state: { x: 0, gate: 0 }, probes: [{ id: 'open', test: (c) => c.get('gate') > 0, monotone: true }], rules: [
    { id: 'trigger', clock: 'c', when: (c) => c.tick === 3, then: (_c, e) => e.set('x', 1) },
    { id: 'gatekeeper', clock: 'c', when: (c) => c.get('x') > 0 && c.t < 5, then: (_c, e) => e.set('gate', 1) },
    { id: 'idle', clock: 'c', when: (c) => c.tick === 4, then: (_c, e) => e.note('tick') },
  ] });
  const tr = runSpec(s);
  const pts = responsibilityPoints(s, tr, { watch: ['gate'] });
  const trig = pts.find((p) => p.rule === 'trigger')!;
  assert.equal(trig.nonRedundant, true);
  assert.ok(trig.profile.absence!.probesChanged.includes('open'));
  assert.ok(trig.profile.timing!.probesChanged.includes('open'), 'shifting it past the window closes the gate too');
  const idle = pts.find((p) => p.rule === 'idle')!;
  assert.equal(idle.nonRedundant, false);
});

test('timing: too-late ⇔ correction time exceeds reconfiguration time', () => {
  const cs = corrections(runSpec(tooLate.build({ ...tooLate.defaults, envPeriod: 5 })));
  assert.ok(cs.some((c) => c.label === 'correct-but-too-late'));
  for (const c of cs) if (c.epistemic === 'correct' && c.operational !== 'not-executed') assert.equal(c.operational === 'too-late', c.tooSlow);
});
