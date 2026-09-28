// Meta-Boundedness Benchmarks.
// These ask which current results depend on the supplied meta-configuration: description facets, mutation
// operators, trace schema, Pareto axes, benchmark predicates, emergence feature sets. Output is always of the
// form "under this perturbation, result R was / was not stable to changes in meta-configuration M" —
// never "the system escaped all human priors".
import type { WorldSpec } from '../core/types.ts';
import { runSpec, diffTraces } from '../core/counterfactual.ts';
import { DEFAULT_FACETS } from '../core/description.ts';
import { novelDimension, boundaryWorld } from '../domains/open.ts';
import { delayedLaw } from '../domains/science.ts';
import { sensorBudget, hiddenPhase } from '../domains/foundations.ts';
import { marketSpec, marketPreset } from '../domains/market.ts';
import { observationSeries } from '../analysis/samples.ts';
import { grammarBoundedDiscovery } from '../analysis/grammar-bounded.ts';
import { grammarMorphogenesis, evaluateModelClass, MUTATION_REGISTRY } from '../analysis/grammar-morphogenesis.ts';
import { traceSchemaSensitivity } from '../meta/schema-sensitivity.ts';
import { projectTrace, TRACE_SCHEMAS } from '../meta/trace-schema.ts';
import { multiEmergence, DEFAULT_FEATURES } from '../analysis/emergence.ts';
import { runTheoryBenchmarks } from './theory.ts';
import { crossLevelTradeoffs, traceLevelMetrics } from '../analysis/meta-fragility.ts';

export interface MetaDefinition {
  setup: string; compared: string[]; measured: string;
  /** How "stable" is decided for one perturbation. */
  stabilityPredicate: string;
  /** Expected distinction, if any was stated before running (null = none predefined). */
  expected: string | null;
  /** What would make this benchmark fail as a benchmark (as opposed to reporting meta-dependence). */
  counterEvidence: string;
}

const MB_DEFS: Record<string, MetaDefinition> = {
  MB1: { setup: 'open.novel-dimension, pair of runs with and without the novel dimension', compared: ['all 17 default facets', 'each facet retired singly', 'configuration-dimension + state-dimension + transition-class retired jointly'], measured: 'whether description-space lineage still distinguishes the pair', stabilityPredicate: 'diffTraces(a, b).stateSpace.identical is false', expected: null, counterEvidence: 'the pair stays distinguishable with every facet that could register the change retired (then the facets are not what carries the result), or the pair is indistinguishable with all facets present' },
  MB2: { setup: 'science.delayed-law, grammar morphogenesis for 4 rounds', compared: ['full mutation registry', 'registry minus each operator in turn'], measured: 'out-of-sample predictive recovery of morphogenesis vs grammar-bounded', stabilityPredicate: 'morphogenesis recovery > grammar-bounded recovery', expected: null, counterEvidence: 'the full-registry comparison itself does not favour morphogenesis (then there is no result to test for stability)' },
  MB3: { setup: 'market.synthetic (horizon 200) and open.boundary-localization, projected under 6 trace schemas', compared: ['full', 'A-ignition-effect', 'B-plus-observation-revision', 'C-plus-coupling-lineage', 'A0-no-read-sets', 'coarse-5'], measured: 'later-label correspondence per label, bundle agreement, responsibility loci', stabilityPredicate: 'a label corresponds under all or no schemas; bundle agreement > 0.99; responsibility loci identical across schemas', expected: null, counterEvidence: 'a schema projection that drops no information changes the result (then the projection code, not the schema, is responsible)' },
  MB4: { setup: 'observation.sensor-budget with policy lexicographic', compared: ['axes A: cost + observability (reference)', 'B: observability + fragility + delay', 'C: future reachability + observability', 'default axes'], measured: 'selected revision and Pareto set', stabilityPredicate: 'selected revision identical to the reference axis set', expected: null, counterEvidence: 'the Pareto set is empty or the reviser selects outside the Pareto set' },
  MB5: { setup: 'theory benchmarks A, B, N re-evaluated with alternative predicates', compared: ['original predicate', 'A: flips at most half', 'B: margin 0.1', 'B: margin 0.25', 'N: τ = 0.6'], measured: 'hypothesis status', stabilityPredicate: 'alternative predicate gives the same hypothesis status as the original', expected: null, counterEvidence: 'the alternative predicates cannot be evaluated from the recorded axes' },
  MB6: { setup: 'market.synthetic (horizon 200), 6 trace schemas × 5 feature subsets', compared: ['default features', 'coupling', 'coupling + ignition-co-occurrence', 'ignition-rate + timing + temporal-scale + observation-dependence', 'coupling + resource-sharing + resource-dependence'], measured: 'presence of each multi-token bundle across runs', stabilityPredicate: 'bundle present in every feature run and every schema run', expected: null, counterEvidence: 'no bundles are recovered under the default schema and features' },
  MB7: { setup: 'observation.hidden-phase (fixed vs self-revising) and observation.sensor-budget (full vs schema A)', compared: ['fixed vs self-revising observation', 'full schema vs schema A'], measured: 'level-tagged metrics (A/B/C/D) improving and worsening together', stabilityPredicate: 'at least one gain at one level co-occurs with a cost at another', expected: 'a gain at one level is accompanied by a cost at another', counterEvidence: 'all metrics improve (or all worsen) together in both comparisons' },
};
export function metaDefinitionOf(id: string): MetaDefinition | undefined { return MB_DEFS[id]; }

export interface MetaResult { id: string; question: string; result: string; definition?: MetaDefinition; perturbations: { meta: string; stable: boolean; detail?: unknown }[]; statement: string; stableOverall: boolean; ms: number; claimStatus: 'synthetic-world result'; error?: string }

const build = (p: { build: (x: Record<string, unknown>) => WorldSpec; defaults: Record<string, unknown> }, over: Record<string, unknown> = {}) => p.build({ ...p.defaults, ...over });
const say = (R: string, M: string, stable: boolean) => `under this perturbation, result "${R}" was ${stable ? '' : 'not '}stable to changes in ${M}`;

interface MB { id: string; question: string; result: string; run: () => { perturbations: MetaResult['perturbations'] } }

const BENCHES: MB[] = [
  { id: 'MB1', question: 'Which results depend on the supplied description facets?', result: 'the novel-dimension pair is distinguishable by description-space lineage',
    run: () => {
      const pair = (retire: string[]) => { const mo = { retire: retire.map((id) => ({ registry: 'description-facet', id })) }; const a = runSpec({ ...build(novelDimension), metaOverrides: mo }), b = runSpec({ ...build(novelDimension, { novel: false }), metaOverrides: mo }); return !diffTraces(a, b).stateSpace.identical; };
      const single = DEFAULT_FACETS.map((f) => ({ meta: `retire facet ${f.id}`, stable: pair([f.id]) }));
      const joint = { meta: 'retire configuration-dimension + state-dimension + transition-class', stable: pair(['configuration-dimension', 'state-dimension', 'transition-class']) };
      return { perturbations: [...single, joint] };
    } },
  { id: 'MB2', question: 'Which results depend on the supplied grammar-mutation operators?', result: 'theory B: morphogenesis recovers more than grammar-bounded after the hidden-law switch',
    run: () => {
      const S = observationSeries(runSpec(build(delayedLaw)), 'O', ['x']);
      const ctx = { changeAt: Number(delayedLaw.defaults.switchAt), interventions: [60, 120, 200, 260] };
      const g = evaluateModelClass('gb', S, Object.fromEntries(grammarBoundedDiscovery(S, { maxAccept: 5 }).accepted.map((a) => [a.id, a.values])), ctx, 0, 0).predictiveRecovery;
      return { perturbations: MUTATION_REGISTRY.map((m) => {
        const mg = grammarMorphogenesis(S, ctx, { rounds: 4, registry: MUTATION_REGISTRY.filter((x) => x.id !== m.id) });
        const r = evaluateModelClass('mg', S, mg.values, ctx, 0, 0).predictiveRecovery;
        return { meta: `remove mutation operator ${m.id}`, stable: r > g, detail: { morphogenesis: +r.toFixed(3), grammarBounded: +g.toFixed(3) } };
      }) };
    } },
  { id: 'MB3', question: 'Which results depend on the trace schema?', result: 'category correspondence (market labels) and responsibility localization (boundary world)',
    run: () => {
      const tr = runSpec(marketSpec({ ...marketPreset.defaults, horizon: 200 }), { reachability: false });
      const s = traceSchemaSensitivity(tr, { label: (id) => { const p = id.split('.')[0]; return ['arist', 'human', 'rule', 'ai', 'hyb'].includes(p) ? p : null; } });
      const sp = build(boundaryWorld); const sb = traceSchemaSensitivity(runSpec(sp), { spec: sp });
      return { perturbations: [
        ...Object.entries(s.labelStability).map(([l, v]) => ({ meta: `trace schemas (label ${l})`, stable: v.isolatingSchemas.length === 0 || v.isolatingSchemas.length === s.schemas.length, detail: v.verdict })),
        { meta: 'trace schemas (market bundle agreement)', stable: s.bundleAgreement > 0.99, detail: s.bundleAgreement },
        { meta: 'trace schemas (responsibility localization)', stable: sb.responsibilityStable === true, detail: sb.schemas.map((x) => `${x.schema}: ${JSON.stringify(x.responsibilityLoci)}`) },
      ] };
    } },
  { id: 'MB4', question: 'Which results depend on the selected Pareto axes?', result: 'the observation revision selected in observation.sensor-budget',
    run: () => {
      const sel = (axes?: string[]) => { const tr = runSpec(build(sensorBudget, { policy: 'lexicographic', ...(axes ? { axes } : {}) })); const n = tr.events.find((e) => e.kind === 'note' && String(e.note).startsWith('observability-revision')); return { selected: n?.data.stages.selected ?? [], pareto: n?.data.stages.paretoSet ?? [] }; };
      const ref = sel(['resource-cost', 'observability-net']);
      const sets: [string, string[]][] = [['A: cost + observability', ['resource-cost', 'observability-net']], ['B: observability + fragility + delay', ['observability-net', 'fragility', 'delay']], ['C: future reachability + observability', ['future-reachability', 'observability-net']], ['default axes', undefined as any]];
      return { perturbations: sets.map(([nm, ax]) => { const r = sel(ax); return { meta: `Pareto axes ${nm}`, stable: JSON.stringify(r.selected) === JSON.stringify(ref.selected), detail: r }; }) };
    } },
  { id: 'MB5', question: 'Which results depend on benchmark predicates?', result: 'theory-benchmark hypothesis status',
    run: () => {
      const T = runTheoryBenchmarks(['A', 'B', 'N']);
      const out: MetaResult['perturbations'] = [];
      const A = T.find((t) => t.id === 'A')!; const fl = A.axes.intervention as any;
      out.push({ meta: 'A: predicate "flips at most half of fixed"', stable: (fl.selfRevising.negativeExcursionFlips <= fl.fixed.negativeExcursionFlips / 2) === A.hypothesisHolds, detail: fl });
      const B = T.find((t) => t.id === 'B')!; const pr = B.axes.predictiveRecovery as Record<string, number>;
      for (const m of [0.1, 0.25]) out.push({ meta: `B: predicate "morphogenesis exceeds grammar-bounded by ≥ ${m}"`, stable: (pr['grammar morphogenesis'] - pr['grammar-bounded'] >= m) === B.hypothesisHolds, detail: pr });
      const N = T.find((t) => t.id === 'N')!;
      out.push({ meta: 'N: adequacy threshold 0.6 instead of 0.78', stable: N.alternativePredicateResults?.['tau-0.6'] === N.hypothesisHolds, detail: { original: N.hypothesisHolds, alternative: N.alternativePredicateResults?.['tau-0.6'] } });
      return { perturbations: out };
    } },
  { id: 'MB6', question: 'Which provisional-bundle recovery results depend on the feature set and trace schema?', result: 'provisional bundles recovered from the market trace (default schema and features)',
    run: () => {
      const tr = runSpec(marketSpec({ ...marketPreset.defaults, horizon: 200 }), { reachability: false });
      const traces = TRACE_SCHEMAS.map((s) => ({ schema: s.id, tr: projectTrace(tr, s) }));
      const subsets = [DEFAULT_FEATURES, ['coupling'], ['coupling', 'ignition-co-occurrence'], ['ignition-rate', 'timing', 'temporal-scale', 'observation-dependence'], ['coupling', 'resource-sharing', 'resource-dependence']];
      const me = multiEmergence(traces, subsets);
      return { perturbations: me.bundles.filter((b) => b.members.length > 1).map((b) => ({ meta: `bundle of ${b.members.length} tokens`, stable: b.stability === 'stable', detail: `${b.stability} (feature runs ${b.presentInFeatureRuns}/${b.totalFeatureRuns}, schema runs ${b.presentInSchemaRuns}/${b.totalSchemaRuns})` })) };
    } },
  { id: 'MB7', question: 'Does a gain at one descriptive level create fragility at another?', result: 'a gain at one descriptive level is accompanied by a cost at another level',
    run: () => {
      const a = traceLevelMetrics(runSpec(build(hiddenPhase, { reviser: false }))), b = traceLevelMetrics(runSpec(build(hiddenPhase)));
      const r1 = crossLevelTradeoffs(a, b);
      const tr = runSpec(build(sensorBudget));
      const full = traceLevelMetrics(tr), coarse = traceLevelMetrics(projectTrace(tr, TRACE_SCHEMAS.find((s) => s.id === 'A-ignition-effect')!));
      const r2 = crossLevelTradeoffs(coarse, full);
      return { perturbations: [
        { meta: 'self-revising observation vs fixed', stable: r1.tradeoffs.length > 0, detail: r1.tradeoffs.map((t) => `${t.gain} (${t.gainLevel}) improves while ${t.cost} (${t.costLevel}) worsens`) },
        { meta: 'full trace schema vs schema A', stable: r2.tradeoffs.length > 0, detail: r2.tradeoffs.map((t) => `${t.gain} (${t.gainLevel}) improves while ${t.cost} (${t.costLevel}) worsens`) },
      ] };
    } },
];

export function runMetaBenchmarks(only?: string[]): MetaResult[] {
  return BENCHES.filter((b) => !only || only.includes(b.id)).map((b) => {
    const t0 = Date.now();
    try {
      const r = b.run();
      const stableOverall = r.perturbations.every((p) => p.stable);
      const unstable = r.perturbations.filter((p) => !p.stable).map((p) => p.meta);
      return { id: b.id, question: b.question, result: b.result, definition: MB_DEFS[b.id], perturbations: r.perturbations, stableOverall, ms: Date.now() - t0, claimStatus: 'synthetic-world result',
        statement: stableOverall ? say(b.result, 'the tested meta-configuration entries', true) : `${say(b.result, unstable.join('; '), false)} (stable under the other ${r.perturbations.length - unstable.length} perturbation(s))` };
    } catch (e) { return { id: b.id, question: b.question, result: b.result, perturbations: [], stableOverall: false, statement: 'error', ms: Date.now() - t0, claimStatus: 'synthetic-world result', error: String((e as Error).stack ?? e) }; }
  });
}

export function listMeta() { return BENCHES.map((b) => ({ id: b.id, question: b.question, result: b.result, definition: MB_DEFS[b.id] })); }
