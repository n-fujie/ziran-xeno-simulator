import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorldSpec } from '../src/core/types.ts';
import { runSpec } from '../src/core/counterfactual.ts';
import { validateTrace } from '../src/core/trace.ts';
import { runtimeKindWorld, causalFacetWorld, causalOrderFacet, delayThreshold, slotReuse } from '../src/domains/meta-worlds.ts';
import { sensorBudget, hiddenPhase } from '../src/domains/foundations.ts';
import { marketSpec, marketPreset } from '../src/domains/market.ts';
import { addressing, novelDimension } from '../src/domains/open.ts';
import { observationSeries } from '../src/analysis/samples.ts';
import { grammarMorphogenesis, adaptationRun, MUTATION_REGISTRY } from '../src/analysis/grammar-morphogenesis.ts';
import { projectTrace, TRACE_SCHEMAS, schemaLoss } from '../src/meta/trace-schema.ts';
import { traceSchemaSensitivity } from '../src/meta/schema-sensitivity.ts';
import { multiEmergence, DEFAULT_FEATURES, discoverBundles } from '../src/analysis/emergence.ts';
import { PARETO_AXES } from '../src/ziran/reviser.ts';
import { listTheory, runTheoryBenchmarks } from '../src/bench/theory.ts';
import { runMetaBenchmarks } from '../src/bench/meta.ts';
import { promote, claim, summarize } from '../src/meta/claims.ts';
import { replaySpec, fromCSV } from '../src/external/adapter.ts';
import { globalMeta } from '../src/meta/registry.ts';
import { metaLatencies } from '../src/analysis/meta-time.ts';

const build = (p: { build: (x: Record<string, unknown>) => WorldSpec; defaults: Record<string, unknown> }, over: Record<string, unknown> = {}) => p.build({ ...p.defaults, ...over });

test('runtime registration of a new value kind: comparison, serialization, penetration, metric, rendering — no core edits', () => {
  const tr = runSpec(build(runtimeKindWorld));
  const effs = tr.events.filter((e) => e.kind === 'effect' && e.valueKind === 'interval');
  assert.ok(effs.some((e) => e.address === 'report/band' && String(e.via).startsWith('coupling:')), 'penetrates');
  assert.ok(effs.every((e) => /^\[/.test(e.rendered) && Array.isArray(e.after.interval)), 'rendered and serialized by the kind');
  assert.ok(tr.metaLineage.some((m) => m.registry === 'value-kind' && m.id === 'interval' && m.origin === 'generated'));
  assert.equal(tr.summary.levels.D >= 1, true);
  assert.ok(tr.final.meta.some((m) => m.registry === 'value-kind' && m.id === 'interval'));
  assert.deepEqual(validateTrace(tr), []);
});

test('runtime registration of a new description facet; facet change (D) distinguished from descriptor change (C)', () => {
  const tr = runSpec(build(causalFacetWorld));
  const d = tr.stateSpaceLineage.find((x) => x.facetsAdded.includes('causal-order'))!;
  assert.equal(d.level, 'D');
  const c = tr.stateSpaceLineage.filter((x) => x.level === 'C' && x.added['causal-order']);
  assert.ok(c.length > 0 && c.every((x) => x.t > d.t), 'later precedence pairs are Level C inside the new facet');
  const pre = runSpec(build(causalFacetWorld, { registerAtRuntime: false }));
  assert.ok(!pre.stateSpaceLineage.some((x) => x.level === 'D'), 'pre-registered facet: no Level D');
  assert.ok(pre.initial.meta.some((m) => m.id === causalOrderFacet.id && m.origin === 'domain-registered'));
});

test('Level D event: meta-configuration change is traced with from/to hashes', () => {
  const tr = runSpec(build(causalFacetWorld));
  const ev = tr.events.find((e) => e.kind === 'meta-configuration')!;
  assert.ok(ev && ev.from !== ev.to && ev.registry === 'description-facet');
  assert.ok(tr.events.some((e) => e.kind === 'reorganization' && e.target === 'meta' && e.level === 'D'));
});

test('meta-grammar: recurring sequences are composed, abstractions generated, idle meta-operators retired', () => {
  const S = observationSeries(runSpec(build(delayThreshold)), 'O', ['x', 'y']);
  const mg = grammarMorphogenesis(S, { trainUntil: 200 }, { rounds: 4, metaGrammar: true, recipeHistory: { 'delay→discretize': 2, 'delay→sign': 2 } });
  const ops = mg.metaLineage.map((m) => m.op);
  assert.ok(ops.includes('compose-meta-operator') && ops.includes('generate-meta-operator'));
  assert.ok(mg.metaLineage.some((m) => m.op === 'compose-meta-operator' && m.recipe.join('→') === 'delay→discretize'));
  // here the composed meta-operators never produced a retained proposal and were retired: a negative result, kept in the lineage
  assert.ok(ops.includes('retire-meta-operator') && mg.mutationRegistry.some((m) => m.status === 'retired'));
  assert.ok(mg.metaLineage.every((m) => m.level === 'D'));
  assert.ok(MUTATION_REGISTRY.every((m) => m.applicability && m.transformation && m.expectedRetained && m.possibleLoss && m.hooks.length && m.provenance), 'mutation operators declare themselves');
});

test('trace-schema sensitivity: a narrow schema changes category correspondence and the change is reported', () => {
  const tr = runSpec(marketSpec({ ...marketPreset.defaults, horizon: 200 }), { reachability: false });
  const s = traceSchemaSensitivity(tr, { label: (id) => id.split('.')[0], responsibility: false });
  assert.equal(s.schemas.length, TRACE_SCHEMAS.length);
  assert.ok(Object.values(s.labelStability).some((v) => v.isolatingSchemas.length > 0 && v.isolatingSchemas.length < s.schemas.length), 'some label correspondence is schema-dependent');
  const A = projectTrace(tr, TRACE_SCHEMAS.find((x) => x.id === 'A-ignition-effect')!);
  assert.ok(A.events.every((e) => e.kind === 'ignition' || e.kind === 'effect') && A.dropped.events > 0);
  assert.ok(schemaLoss(TRACE_SCHEMAS[0], TRACE_SCHEMAS.find((x) => x.id === 'coarse-5')!, ['effect']).includes('value payloads'), 'schema contraction is recorded as lost detail');
});

test('feature-set sensitivity in category emergence; bundles are provisional with neutral ids', () => {
  const tr = runSpec(marketSpec({ ...marketPreset.defaults, horizon: 200 }), { reachability: false });
  const me = multiEmergence([{ schema: 'full', tr }], [DEFAULT_FEATURES, ['coupling'], ['ignition-rate', 'timing', 'temporal-scale']]);
  assert.equal(me.canonical, null);
  assert.ok(me.bundles.some((b) => b.stability !== 'stable'), 'at least one bundle depends on the feature set');
  const d = discoverBundles(tr);
  for (const b of d.bundles) {
    assert.match(b.id, /^B\d+$/);
    assert.ok(b.provisional.sourceSchema && b.provisional.featureConstructors.length && b.provisional.procedure && b.provisional.temporalWindow.length === 2);
    assert.ok(b.provisional.stabilityResampling !== null && b.provisional.downstreamProfile !== null);
  }
});

test('Pareto-axis sensitivity: the selected revision changes with the axis set; axes are declared meta-objects', () => {
  const sel = (axes: string[]) => runSpec(build(sensorBudget, { policy: 'lexicographic', axes })).events.find((e) => e.kind === 'note' && String(e.note).startsWith('observability-revision'))!.data;
  const A = sel(['resource-cost', 'observability-net']), B = sel(['observability-net', 'fragility', 'delay']);
  assert.notDeepEqual(A.stages.selected, B.stages.selected);
  assert.ok(A.stages.paretoSet.length >= 1 && A.policyOrigin === 'external');
  for (const ax of PARETO_AXES) assert.ok(ax.assumptions && ax.window && ax.configuration && ax.comparability && ax.preferenceOrigin && (ax.prefer === 'min' || ax.prefer === 'max'));
});

test('benchmark predicates can be inspected, including what would make each benchmark fail', () => {
  const L = listTheory() as any[];
  assert.ok(L.length >= 14);
  for (const d of L) assert.ok(d.modelClasses.length && d.initialConfiguration && d.perturbation && d.measuredOutcomes.length && d.successPredicate && d.uncertainty && d.counterEvidence, d.id);
});

test('adversarial outcomes are first-class: no useful revision, fixed grammar wins, synchronized clocks add nothing, thick category useful and useless, harmful reorganization', () => {
  const T = Object.fromEntries(runTheoryBenchmarks(['G', 'H', 'I', 'J', 'K', 'L']).map((t) => [t.id, t]));
  for (const id of ['G', 'H', 'I', 'J', 'K', 'L']) assert.equal(T[id].hypothesisHolds, true, id);
  assert.equal(T.G.outcomeType, 'negative');
  assert.equal(T.H.outcomeType, 'negative');
  assert.equal(T.I.outcomeType, 'null');
  assert.equal(T.J.outcomeType, 'positive');
  assert.equal(T.K.outcomeType, 'negative');
  assert.equal(T.L.outcomeType, 'negative');
});

test('description-space contraction is tracked, not only expansion', () => {
  const tr = runSpec(build(addressing));
  assert.ok(tr.summary.spaceChange.contraction > 0);
  assert.ok(tr.stateSpaceLineage.some((x) => (x.removed['state-dimension'] ?? []).length > 0));
  const nd = runSpec(build(novelDimension));
  assert.ok(nd.emergentReachability.every((r) => typeof r.contractionCount === 'number'));
});

test('representation change records lost distinctions (relation → scalar; coarser resolution)', () => {
  const tr = runSpec({ id: 'r', seed: 1, horizon: 3, state: { r: { kind: 'relation', edges: [['a', 'b']] } }, clocks: [{ id: 'c', period: 1 }],
    rules: [{ id: 'flatten', clock: 'c', when: (c) => c.tick === 2, then: (_c, e) => e.set('r', 1) }] });
  const e = tr.events.find((x) => x.kind === 'effect')!;
  assert.deepEqual(e.representationChange, { from: 'relation', to: 'scalar' });
  assert.ok(e.distinctions.lost.some((x: string) => /edge identities/.test(x)) && e.distinctions.unknown.length > 0);
  const t2 = runSpec({ id: 'q', seed: 1, horizon: 3, state: { x: 0 }, clocks: [{ id: 'c', period: 1 }], rules: [],
    apparatus: [{ id: 'A', channels: [{ id: 'x', clock: 'c', reads: ['x'], resolution: 0.1 }] }],
    interventions: [{ id: 'coarsen', t: 1, kind: 'emit', apply: (_c, e2) => e2.apparatus.patchChannel('A', 'x', { resolution: 1 }) }] });
  const re = t2.events.find((x) => x.kind === 'reorganization')!;
  assert.ok(re.distinctions.lost.some((x: string) => /finer than 1/.test(x)));
});

test('meta-revision can be too late: an adequate variable system is found only after most of a short regime has passed', () => {
  const S = observationSeries(runSpec(build(delayThreshold)), 'O', ['x', 'y']);
  const long = adaptationRun(S, [[0, 240]], 'grammar-morphogenesis', { window: 30, tau: 0.78 });
  const short = adaptationRun(S, [[0, 100]], 'grammar-morphogenesis', { window: 30, tau: 0.78 });
  assert.equal(long.regimes[0].timing, 'in-time');
  assert.equal(short.regimes[0].timing, 'too-late');
  assert.equal(short.regimes[0].latencyRounds, long.regimes[0].latencyRounds, 'same discovery latency; only the environment is faster');
});

test('operational addresses: uncertain, transient, related, lost, reassigned, re-ignited without identity preservation', () => {
  const tr = runSpec(build(slotReuse));
  const O = Object.fromEntries((tr.final.operationalAddresses as any[]).map((o) => [o.id, o]));
  assert.equal(O['probe-window'].status, 'unavailable', 'transient expired');
  assert.equal(O['gamma'].status, 'uncertain'); assert.equal(O['gamma'].candidates.length, 2);
  assert.equal(O['alpha′'].identityPreserved, false);
  assert.ok(O['alpha′'].relations.some((r: any) => r.to === 'alpha' && r.type === 'reignites'));
  assert.equal(O['beta'].status, 'resolved');
});

test('emergent novelty is layered and indexed to configuration, description space, meta-configuration and history', () => {
  const tr = runSpec(build(novelDimension));
  const r = tr.emergentReachability.find((x) => x.noveltyByLevel.C > 0)!;
  assert.ok(r.relativeTo.configuration && r.relativeTo.descriptionSpace && r.relativeTo.metaConfiguration && typeof r.relativeTo.historyUpTo === 'number');
  const items = Object.values(r.perOption).flatMap((x: any) => x.novelty);
  assert.ok(items.some((n: any) => n.what === 'new transition class' && n.level === 'C' && typeof n.novelToHistory === 'boolean'));
});

test('claim status: synthetic results are never promoted; evidence labels are not mixed silently', () => {
  const c = claim('x', 'synthetic-world result');
  assert.throws(() => promote(c, 'empirically supported generalization'));
  assert.throws(() => summarize([{ evidence: 'synthetic' as const }, { evidence: 'replayed-empirical' as const }]));
  assert.equal(runSpec(build(hiddenPhase)).meta.evidence, 'synthetic');
});

test('external adapter: data enter as configuration-bound observations; missing stays missing', () => {
  const set = fromCSV('t,a\n0,1\n1,\n2,3', { source: 'adapter-test-fixture (synthetic)', domain: 'physical-experiment', samplingRegime: '1 Hz', missingness: 'row 1 missing', apparatus: 'fixture', timebase: 'seconds', uncertainty: 'n/a', provenance: 'generated in test', evidence: 'synthetic' });
  const tr = runSpec(replaySpec(set));
  assert.equal(tr.meta.evidence, 'synthetic');
  assert.ok(tr.events.some((e) => e.kind === 'effect' && e.address === 'ext/a' && e.valueKind === 'unknown'), 'missing sample recorded as unknown, not zero');
  assert.ok((tr.initial.config as any[]).some((d) => d.key === 'missingness'));
});

test('meta-configuration is inspectable across all registries, with origins', () => {
  const snap = globalMeta().snapshot();
  for (const r of ['value-kind', 'description-facet', 'transition-class', 'observation-revision-candidate', 'grammar-mutation', 'comparison-metric', 'emergence-feature', 'pareto-axis', 'trace-schema', 'benchmark-predicate']) assert.ok(snap.some((e) => e.registry === r), r);
  assert.ok(snap.some((e) => e.origin === 'domain-registered'));
});

test('meta-time: sensor-revision latency is recorded', () => {
  const L = metaLatencies(runSpec(build(hiddenPhase)));
  assert.ok(L.some((x) => x.kind === 'sensor revision' && x.latency >= 0));
});

test('meta-boundedness suite reports stability statements, never escape claims', () => {
  const M = runMetaBenchmarks(['MB1', 'MB4', 'MB7']);
  for (const r of M) { assert.equal(r.error, undefined, r.id); assert.match(r.statement, /under this perturbation, result/); assert.doesNotMatch(r.statement, /escaped|prior-free|unrestricted/); }
  assert.equal(M.find((r) => r.id === 'MB4')!.stableOverall, false, 'revision choice is evaluation-relative');
});
