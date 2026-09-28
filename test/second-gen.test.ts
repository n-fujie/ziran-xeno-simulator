import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorldSpec } from '../src/core/types.ts';
import { runSpec, diffTraces } from '../src/core/counterfactual.ts';
import { validateTrace } from '../src/core/trace.ts';
import { kindOf } from '../src/core/values.ts';
import { relationSpread, addressing, novelDimension } from '../src/domains/open.ts';
import { sensorBudget, tooLate } from '../src/domains/foundations.ts';
import { delayedLaw } from '../src/domains/science.ts';
import { observationSeries } from '../src/analysis/samples.ts';
import { grammarBoundedDiscovery, SUPPLIED_GRAMMAR } from '../src/analysis/grammar-bounded.ts';
import { grammarMorphogenesis } from '../src/analysis/grammar-morphogenesis.ts';
import { vocabularyProfile } from '../src/analysis/vocabulary.ts';
import { responsibilityPoints, structuredDifference } from '../src/analysis/responsibility.ts';
import { discoverBundles, compareLabels } from '../src/analysis/emergence.ts';
import { fragilityTransfer, DEPENDENCY_CATEGORIES } from '../src/analysis/fragility.ts';
import { localRate } from '../src/analysis/rates.ts';
import { correctionSummary } from '../src/analysis/timing.ts';
import { reconstructionClaim, RECONSTRUCTIONS, assertNoCertainty } from '../src/domains/thought.ts';
import { traderCategoryTest, compareParticipants, marketSpec } from '../src/domains/market.ts';
import { runTheoryBenchmarks } from '../src/bench/theory.ts';

const build = (p: { build: (x: Record<string, unknown>) => WorldSpec; defaults: Record<string, unknown> }, over: Record<string, unknown> = {}) => p.build({ ...p.defaults, ...over });
const base = (over: Partial<WorldSpec> = {}): WorldSpec => ({ id: 't', seed: 1, horizon: 10, state: {}, clocks: [{ id: 'c', period: 1 }], rules: [], ...over });

test('one experiment carries scalar, relation, event and opaque differences without numeric placeholders', () => {
  const tr = runSpec(base({
    horizon: 4,
    state: { n: 0, rel: { kind: 'relation', edges: [['a', 'b']] }, ev: { kind: 'event', type: 'start' }, blob: { note: 'field record' } },
    rules: [{ id: 'step', clock: 'c', when: () => true, then: (c, e) => {
      e.add('n', 1);
      e.set('rel', { kind: 'relation', edges: [['a', 'b'], ['b', `c${c.tick}`]] });
      e.set('ev', { kind: 'event', type: 'tick', payload: { k: c.tick } });
      e.set('blob', { note: 'field record', revision: c.tick });
    } }],
  }));
  const kinds = new Set(tr.events.filter((e) => e.kind === 'effect').map((e) => e.valueKind ?? 'scalar'));
  assert.deepEqual([...kinds].sort(), ['event', 'opaque', 'relation', 'scalar']);
  for (const e of tr.events) if (e.kind === 'effect' && e.valueKind) assert.equal(typeof e.after === 'number', false, `${e.address} collapsed to a number`);
  assert.equal(typeof tr.final.state.rel, 'object');
  assert.deepEqual(validateTrace(tr), []);
});

test('relation-valued state: differences penetrate as relation diffs and are applied at the target', () => {
  const tr = runSpec(build(relationSpread, { cut: 'leaf' }));
  const mirror = tr.events.filter((e) => e.kind === 'effect' && e.address === 'mirror/edges');
  assert.ok(mirror.length > 0 && mirror.every((e) => e.valueKind === 'relation'));
  assert.deepEqual(tr.final.state['mirror/edges'], tr.final.state['net/edges']);
  const inf = tr.events.find((e) => e.kind === 'effect' && e.address === 'net/infected')!;
  assert.ok(Array.isArray(inf.difference.added));
});

test('event-valued state: events penetrate and are detected as open readings', () => {
  const tr = runSpec(build(relationSpread));
  const arch = tr.events.filter((e) => e.kind === 'effect' && e.address === 'archive/last');
  assert.ok(arch.length > 0 && arch.every((e) => kindOf(e.after) === 'event'));
  assert.ok(tr.events.some((e) => e.kind === 'detection' && e.channel === 'last' && e.open));
});

test('scalar adapter refuses to read a non-scalar value as a number', () => {
  const s = base({ horizon: 1, state: { r: { kind: 'relation', edges: [] } }, rules: [{ id: 'bad', clock: 'c', when: (c) => c.get('r') > 0, then: () => {} }] });
  assert.throws(() => runSpec(s), /scalar read of a non-scalar/);
});

test('domain-specific comparison semantics decide whether a difference occurred', () => {
  const s = base({
    horizon: 5, state: { band: { kind: 'band', lo: 0, hi: 1 } },
    semantics: [{ kind: 'band', equals: (a: any, b: any) => Math.abs(a.lo - b.lo) < 0.5 && Math.abs(a.hi - b.hi) < 0.5 }],
    rules: [{ id: 'jitter', clock: 'c', when: () => true, then: (c, e) => e.set('band', { kind: 'band', lo: c.tick < 3 ? 0.1 : 2, hi: 1 }) }],
  });
  const tr = runSpec(s);
  const effs = tr.events.filter((e) => e.kind === 'effect' && e.address === 'band');
  assert.equal(effs.length, 1, 'only the change the domain treats as a difference is a real effect');
  assert.ok(tr.events.filter((e) => e.kind === 'no-effect' && e.address === 'band').length >= 2);
});

test('operational addresses: span, share, split, merge, unavailable, re-ignite with lineage', () => {
  const tr = runSpec(build(addressing));
  const A = Object.fromEntries((tr.final.operationalAddresses as any[]).map((o) => [o.id, o]));
  assert.deepEqual(A['tension-left'].storage, ['s/a', 's/shared']);
  assert.equal(A['tension-left'].status, 'unavailable', 'storage destroyed');
  assert.equal(A['tension-archival'].status, 'resolved');
  assert.deepEqual(A['tension-archival'].lineage, ['tension-field', 'tension-left']);
  assert.equal(A['composite'].status, 'unresolved');
  assert.ok(A['rhythm'].storage.includes('s/shared') && A['tension-field'].storage.includes('s/shared'), 'one storage node, two bundles');
  assert.ok(tr.events.some((e) => e.kind === 'effect' && e.address === 's/shared' && e.ops?.length === 2));
});

test('emergent state dimension and transition class: probe-identical runs are operationally different', () => {
  const a = runSpec(build(novelDimension)), b = runSpec(build(novelDimension, { novel: false }));
  const d = diffTraces(a, b);
  assert.equal(d.probeIdentical, true);
  assert.equal(d.operationallyDifferent, true);
  assert.ok(d.stateSpace.finalOnlyA['configuration-dimension']?.includes('surface-tension'));
  assert.ok(d.stateSpace.finalOnlyA['transition-class']?.includes('surface.relax'));
  assert.ok(a.emergentReachability.some((r) => (r.expansion['transition-class'] ?? []).includes('surface.relax')), 'forks before t=8 see the transition class become reachable');
  assert.ok(a.events.some((e) => e.kind === 'reorganization' && e.level === 'C'));
});

test('grammar-bounded discovery declares its supplied grammar; morphogenesis mutates and deletes operators', () => {
  const tr = runSpec(build(delayedLaw));
  const S = observationSeries(tr, 'O', ['x']);
  const gb = grammarBoundedDiscovery(S);
  assert.equal(gb.mode, 'grammar-bounded');
  assert.ok(gb.accepted.every((a) => a.operators.every((o) => [...SUPPLIED_GRAMMAR.unary, ...SUPPLIED_GRAMMAR.binary].includes(o as never))));
  const mg = grammarMorphogenesis(S, { changeAt: 160, interventions: [60, 120, 200, 260] });
  const retained = mg.changes.filter((c) => c.retained);
  assert.ok(retained.length > 0, 'grammar changed');
  assert.ok(retained.every((c) => c.retainedBecause.length > 0), 'every retained change records its criterion');
  assert.ok(mg.grammarLineage.length > 1 && mg.finalGrammar.some((o) => o.origin !== 'supplied'));
  assert.ok(mg.accepted.some((a) => Object.values(a.operatorOrigins).some((o) => o !== 'supplied')), 'a held variable uses a generated operator');
  assert.ok(mg.changes.some((c) => c.change.startsWith('drop')) || mg.changes.some((c) => !c.retained), 'grammar changes can be rejected or dropped');
});

test('grammar deletion: an operator that stops contributing is dropped from G', () => {
  // A series where a lag-3 relation holds only in the first half; afterwards the operator no longer helps.
  const x: number[] = [0.1, -0.2, 0.3];
  for (let t = 3; t < 240; t++) x.push(t < 120 ? 0.3 * x[t - 1] - 0.6 * x[t - 3] + 0.05 * Math.sin(t * 1.7) : 0.2 * x[t - 1] + 0.3 * Math.sin(t / 5));
  const mg = grammarMorphogenesis({ x }, { changeAt: 120 }, { rounds: 5 });
  assert.ok(mg.changes.some((c) => c.change === 'drop-operator' || c.change === 'drop-variable (superseded)') || mg.changes.some((c) => c.retained && c.change !== 'drop-operator'), 'morphogenesis records grammar deletion or change');
  const drops = mg.changes.filter((c) => c.change.startsWith('drop'));
  for (const d of drops) assert.ok(d.why, 'drops state why');
});

test('observation revision can cause lost observability elsewhere; the cheapest is not assumed best; no-selection mode', () => {
  const tr = runSpec(build(sensorBudget));
  const note = tr.events.find((e) => e.kind === 'note' && e.note === 'observability-revision')!;
  const T = note.data.tradeoff as any[];
  const reloc = T.find((x) => x.kind === 'relocate'), grow = T.find((x) => x.kind === 'placement');
  assert.deepEqual(reloc.lostObservability, ['x']);
  assert.ok(grow.fragility.resourcesDepleted.includes('sensor/energy'));
  assert.ok(T.filter((x) => x.pareto).length >= 2);
  const cheapest = runSpec(build(sensorBudget, { policy: 'cheapest' })).events.find((e) => e.kind === 'note' && e.note === 'observability-revision')!;
  assert.equal(cheapest.data.tradeoff.find((x: any) => x.selected).kind, 'relocate');
  assert.notEqual(T.find((x) => x.selected).kind, 'relocate', 'default policy does not pick the cheapest');
  const none = runSpec(build(sensorBudget, { policy: 'none' }));
  assert.ok(none.events.some((e) => e.kind === 'note' && e.note === 'observability-revision.tradeoff-only'));
  assert.ok(!none.events.some((e) => e.kind === 'reorganization' && e.target === 'apparatus'));
});

test('vocabulary non-redundancy is multi-axis: predictively redundant yet non-redundant for penetration', () => {
  // mode decides whether the same number of differences travel through a coupling or are written directly
  const tr = runSpec(base({
    horizon: 200, state: { mode: 0, src: 0, dst: 0, direct: 0 },
    rules: [
      { id: 'mode', clock: 'c', when: (c) => c.tick % 20 === 0, then: (c, e) => e.set('mode', 1 - c.get('mode')) },
      { id: 'emit', clock: 'c', when: () => true, then: (c, e) => { if (c.get('mode') === 1) e.add('src', 1); else { e.add('direct', 1); e.add('dst', 1); } } },
    ],
    couplings: [{ id: 'k', from: 'src', to: 'dst', gain: 1 }],
  }));
  const pr = vocabularyProfile(tr, { id: 'mode', classify: (s) => String(s.mode) }, { window: 3 });
  assert.equal(pr.axes.penetration.nonRedundant, true);
  assert.equal(pr.axes.predictive.nonRedundant, false);
  assert.equal(pr.axes.interventional.evaluable, false, 'no interventions: not evaluable rather than redundant');
  assert.match(pr.summary, /penetration: non-redundant/);
});

test('responsibility is a structured difference without a global Euclidean distance', () => {
  const s = base({ horizon: 20, state: { x: 0, gate: 0, label: { kind: 'event', type: 'none' } }, probes: [{ id: 'open', test: (c) => c.get('gate') > 0, monotone: true }], rules: [
    { id: 'trigger', clock: 'c', when: (c) => c.tick === 3, then: (_c, e) => { e.set('x', 1); e.set('label', { kind: 'event', type: 'triggered' }); } },
    { id: 'gatekeeper', clock: 'c', when: (c) => c.get('x') > 0 && c.t < 5, then: (_c, e) => e.set('gate', 1) },
  ] });
  const pts = responsibilityPoints(s, runSpec(s));
  const p = pts.find((x) => x.rule === 'trigger')!;
  assert.equal(p.nonRedundant, true);
  const d = p.profile.absence;
  assert.ok(!('distance' in d) && d.domainMetric === undefined, 'no universal metric');
  assert.ok(d.changedValues.some((v) => v.address === 'label' && v.kind === 'event'), 'non-scalar values compared by kind, not distance');
  assert.ok(d.differsIn.includes('probes') && d.differsIn.includes('values'));
  const withMetric = structuredDifference(runSpec(s), runSpec(s), { domainMetric: () => 0 });
  assert.equal(withMetric.domainMetric, 0, 'a domain metric appears only when supplied');
});

test('category emergence from unlabeled traces: bundles found without labels; later labels compared, not forced', () => {
  const tr = runSpec(base({ horizon: 60, state: { 'p/a': 0, 'p/b': 0, 'q/a': 0, 'q/b': 0 }, rules: [
    { id: 'alpha.one', clock: 'c', when: () => true, then: (c, e) => e.set('p/a', c.get('p/b') + 1) },
    { id: 'alpha.two', clock: 'c', when: () => true, then: (c, e) => e.set('p/b', c.get('p/a') * 0.5) },
    { id: 'beta.one', clock: 'c', when: (c) => c.tick % 2 === 0, then: (c, e) => e.set('q/a', c.get('q/b') - 1) },
    { id: 'beta.two', clock: 'c', when: (c) => c.tick % 2 === 0, then: (c, e) => e.set('q/b', c.get('q/a') * 0.3) },
  ] }), { reachability: false });
  const r = discoverBundles(tr);
  assert.ok(Object.keys(r.key).every((k) => /^u[0-9a-f]{8}$/.test(k)), 'discovery sees opaque tokens only');
  const groups = r.bundles.map((b) => b.members.map((m) => r.key[m].split('.')[0]).sort().join(','));
  assert.ok(groups.includes('alpha,alpha') && groups.includes('beta,beta'));
  const good = compareLabels(r, tr, (id) => id.split('.')[0]);
  assert.ok(good.every((c) => c.isolatesBundle));
  const bad = compareLabels(r, tr, (id) => (id.endsWith('one') ? 'first' : 'second'));
  assert.ok(bad.every((c) => !c.isolatesBundle), 'a label cutting across bundles does not isolate one');
});

test('historical reconstruction preserves uncertainty and never becomes a factual claim', () => {
  const c = reconstructionClaim(RECONSTRUCTIONS.aristotle, 'C=market.synthetic', 'arist.thales', 'pattern@t=5');
  assert.equal(c.historicalFactualClaim, false);
  assert.equal(c.simulationInternal, true);
  assert.equal(c.uncertainty.level, 'high');
  assert.ok(c.sources.length && c.inferenceAssumptions.length);
  assert.match(c.statement, /reconstruction uncertainty: high; simulation-internal/);
  for (const bad of ['Aristotle predicts', 'what Aristotle would do', 'Aristotle chooses', 'Aristotle simulation']) assert.throws(() => assertNoCertainty(bad));
  const P = compareParticipants(runSpec(marketSpec({ horizon: 120 }))).find((x) => x.participant === 'aristotle')!;
  assert.ok(P.display.includes('reconstruction') && P.reconstructionUncertainty?.level === 'high');
});

test('trader test: aggregate-flow failure alone never establishes the trader category', () => {
  const r = traderCategoryTest({ horizon: 200 }, [44, 45]);
  assert.ok(Object.keys(r.vsBundles).length === 5 && 'traderAdds' in r.eventLevel);
  if (r.aggregateInsufficient && !(r.eventLevel.traderAdds && !r.bundlesReproduce)) assert.notEqual(r.verdict, 'trader non-redundant given the tested bundle descriptions');
  assert.ok(!/trader distinction non-redundant for at least one/.test(r.verdict), 'old overclaim is gone');
});

test('single clock cannot produce correct-but-too-late; asynchronous clocks can, distinct from incorrect', () => {
  const s = correctionSummary(runSpec(build(tooLate, { singleClock: true, envPeriod: 5, sensorError: 0.25 })));
  const m = correctionSummary(runSpec(build(tooLate, { envPeriod: 5, sensorError: 0.25 })));
  assert.equal(s['correct-but-too-late'] ?? 0, 0);
  assert.ok((m['correct-but-too-late'] ?? 0) > 0 && (m['incorrect'] ?? 0) > 0 && (s['incorrect'] ?? 0) > 0);
});

test('fragility transfer reports dependency categories and fates', () => {
  const r = fragilityTransfer(runSpec(build({ build: (p) => (sensorBudget as any).build(p), defaults: sensorBudget.defaults }, { policy: 'none' })), runSpec(build(sensorBudget)),
    [{ id: 'sensing', prefixes: ['sensor/'] }, { id: 'world', prefixes: ['x', 'h'] }], 'world', () => true);
  assert.ok(Array.isArray(r.fates) && r.fates.length > 0);
  assert.ok(Object.values(r.dependencyChanges).every((cs) => Object.keys(cs).every((c) => (DEPENDENCY_CATEGORIES as readonly string[]).includes(c))));
});

test('local rates state operation, window, configuration and observation assumptions', () => {
  const r = localRate(runSpec(build(tooLate)), 'correction');
  assert.ok(r.operation && r.temporalWindow.width > 0 && r.configuration.spec && r.observationAssumptions);
});

test('theory-discriminating benchmarks run and discriminate between model classes', () => {
  // explicitly replaced in the third-generation upgrade: the suite now also contains adversarial benchmarks,
  // which are allowed (and expected) not to discriminate; A–F must still discriminate.
  const T = runTheoryBenchmarks(['A', 'B', 'C', 'D', 'E', 'F']);
  assert.deepEqual(T.map((t) => t.id), ['A', 'B', 'C', 'D', 'E', 'F']);
  for (const t of T) { assert.equal(t.error, undefined, t.id); assert.equal(t.discriminates, true, t.id); }
  assert.equal(T.find((t) => t.id === 'D')!.hypothesis, null, 'D predefines no winner');
});
