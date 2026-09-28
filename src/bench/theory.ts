// Theory-Discriminating Benchmarks.
//
// Unlike the conformance suite, each benchmark here compares competing model classes or ablated versions on
// the same environment and reports every axis. A benchmark "discriminates" when the model classes come apart
// on at least one operational axis; where the framework makes a directional prediction, the prediction is
// stated in `hypothesis` and its outcome is reported separately — it can fail. D predefines no winner.
// All results are simulation-internal: they show what these model classes do in these synthetic worlds.
//
// Benchmark predicates are exposed: every benchmark declares its compared model classes, initial
// configuration, perturbation, measured outcomes, success predicate, uncertainty, and what result would
// count against the expected distinction. Adversarial benchmarks (G–L) are built so that the framework's
// favoured mechanism should NOT win automatically; negative and null results are first-class outcomes.
import type { WorldSpec } from '../core/types.ts';
import { runSpec } from '../core/counterfactual.ts';
import { replayState, type Trace } from '../core/trace.ts';
import { hiddenPhase, tooLate } from '../domains/foundations.ts';
import { delayedLaw } from '../domains/science.ts';
import { traderCategoryTest } from '../domains/market.ts';
import { boundaryWorld, relationSpread } from '../domains/open.ts';
import { corrections, correctionSummary } from '../analysis/timing.ts';
import { observationSeries } from '../analysis/samples.ts';
import { grammarBoundedDiscovery } from '../analysis/grammar-bounded.ts';
import { grammarMorphogenesis, evaluateModelClass } from '../analysis/grammar-morphogenesis.ts';
import { responsibilityPoints } from '../analysis/responsibility.ts';
import { uselessRevision, stableLinear, twinUnits, harmfulReorg, slotReuse, delayThreshold, REGIMES_DEFAULT } from '../domains/meta-worlds.ts';
import { adaptationRun } from '../analysis/grammar-morphogenesis.ts';

export interface BenchmarkDefinition {
  id: string; title: string; question: string;
  kind: 'discriminating' | 'adversarial';
  modelClasses: string[];
  initialConfiguration: string;
  perturbation: string;
  measuredOutcomes: string[];
  /** The success predicate, stated as it is evaluated. */
  successPredicate: string;
  uncertainty: string;
  /** What result would count against the expected distinction ("What would make this benchmark fail?"). */
  counterEvidence: string;
  /** Alternative predicates used by the Meta-Boundedness suite to test predicate dependence. */
  alternativePredicates?: { id: string; description: string }[];
}

export interface TheoryResult {
  id: string; title: string; question: string;
  definition?: BenchmarkDefinition;
  /** positive: the expected distinction appeared; negative: the favoured mechanism did not win / no benefit; null: no distinction either way. */
  outcomeType?: 'positive' | 'negative' | 'null';
  claimStatus?: 'model-class discrimination' | 'synthetic-world result' | 'unresolved';
  evidence?: 'synthetic';
  alternativePredicateResults?: Record<string, boolean>;
  modelClasses: string[];
  axes: Record<string, Record<string, unknown>>;
  discriminates: boolean;
  hypothesis: string | null;
  hypothesisHolds: boolean | null;
  verdict: string;
  ms: number;
  error?: string;
}

const build = (p: { build: (x: Record<string, unknown>) => WorldSpec; defaults: Record<string, unknown> }, over: Record<string, unknown> = {}) => p.build({ ...p.defaults, ...over });

interface Bench { id: string; title: string; question: string; run: () => Omit<TheoryResult, 'id' | 'title' | 'question' | 'ms'> }

type Def = Omit<BenchmarkDefinition, 'id' | 'title' | 'question'>;
const DEFS: Record<string, Def> = {
  A: { kind: 'discriminating', modelClasses: ['fixed observation', 'self-revising observation'], initialConfiguration: 'observation.hidden-phase (x-only apparatus; hidden phase h coupled to x)', perturbation: 'enable / disable the Ziran reviser', measuredOutcomes: ['hidden differences detected', 'negative-excursion flips', 'final probe-relative reach fraction', 'excursions after t=20', 'channels / revisions'], successPredicate: 'self-revision has fewer negative-excursion flips AND more channels than fixed observation', uncertainty: 'single seed; one synthetic world; the controller is written to use the grown channel', counterEvidence: 'flips not lower with revision, or revision at zero observation cost (then the "cost" half of the claim fails)', alternativePredicates: [{ id: 'strict-halving', description: 'flips at most half of fixed' }, { id: 'any-difference', description: 'any axis differs' }] },
  B: { kind: 'discriminating', modelClasses: ['fixed variables', 'grammar-bounded', 'grammar morphogenesis'], initialConfiguration: 'science.delayed-law (delayed then thresholded-windowed hidden law)', perturbation: 'model class', measuredOutcomes: ['out-of-sample post-switch predictive recovery', 'intervention recovery', 'novel distinctions', 'representation change'], successPredicate: 'morphogenesis recovery > grammar-bounded ≥ fixed AND only morphogenesis changes representation', uncertainty: 'one world, one seed; block cross-validation; morphogenesis selection uses the whole series (evaluation is out-of-sample but selection is not online)', counterEvidence: 'grammar-bounded recovery ≥ morphogenesis recovery, or no retained grammar change', alternativePredicates: [{ id: 'margin-0.1', description: 'morphogenesis exceeds grammar-bounded by ≥ 0.1' }, { id: 'margin-0.25', description: 'morphogenesis exceeds grammar-bounded by ≥ 0.25' }] },
  C: { kind: 'discriminating', modelClasses: ['single synchronous clock', 'asynchronous clocks'], initialConfiguration: 'timing.too-late-correction, envPeriod 5, sensorError 0.25', perturbation: 'clock model', measuredOutcomes: ['correction classes', 'correct corrections that left the configuration unmodified'], successPredicate: 'single clock has no correct-but-too-late; asynchronous has some; both have incorrect; ≥1 correct-but-failed-to-modify', uncertainty: 'the single-clock model is one choice of synchronous discretization', counterEvidence: 'too-late appears under a single zero-latency clock, or never appears with asynchronous clocks' },
  D: { kind: 'discriminating', modelClasses: ['five configurations', 'matched aggregate flow', 'operational bundle descriptions'], initialConfiguration: 'market.synthetic, 3 seeds, liquidity shock at t=200', perturbation: 'order-flow description', measuredOutcomes: ['five-axis market comparison', 'trader-beyond-role event test'], successPredicate: 'none predefined — the verdict is reported as found', uncertainty: 'the bundle description is one lower-level vocabulary', counterEvidence: 'not applicable (no directional hypothesis)' },
  E: { kind: 'discriminating', modelClasses: ['boundary sys/', 'boundary sys/ + env/'], initialConfiguration: 'open.boundary-localization', perturbation: 'analysis boundary', measuredOutcomes: ['non-redundant responsibility loci'], successPredicate: 'loci differ and the wider boundary has more loci', uncertainty: 'two-rule world', counterEvidence: 'identical loci under both boundaries' },
  F: { kind: 'discriminating', modelClasses: ['scalar-state engine', 'open-value engine'], initialConfiguration: 'open.relation-spread, topology A', perturbation: 'representation; cut bridge vs leaf edge', measuredOutcomes: ['target reached', 'whether interventions are distinguishable'], successPredicate: 'open representation distinguishes the two cuts (n4 reach differs); scalar runs are byte-identical', uncertainty: 'constructed to show a specific information loss', counterEvidence: 'the scalar encoding distinguishes the cuts, or the relation encoding does not' },
  G: { kind: 'adversarial', modelClasses: ['fixed observation', 'self-revising observation'], initialConfiguration: 'adversarial.useless-revision: nothing downstream uses a grown sensor; sensing costs energy', perturbation: 'enable / disable reviser', measuredOutcomes: ['negative-excursion flips', 'sensing energy', 'channels'], successPredicate: 'self-revision does NOT improve flips, and costs more energy', uncertainty: 'one seed', counterEvidence: 'self-revision improves the downstream outcome even though nothing uses the sensor (would indicate a leak)' },
  H: { kind: 'adversarial', modelClasses: ['fixed grammar', 'grammar morphogenesis'], initialConfiguration: 'adversarial.stable-linear: AR(1) with noise', perturbation: 'model class', measuredOutcomes: ['out-of-sample error', 'retained grammar changes'], successPredicate: 'fixed grammar error ≤ morphogenesis error (+1e-6)', uncertainty: 'one seed; the harm guard makes "no change retained" likely', counterEvidence: 'morphogenesis beats fixed in a world with nothing to find (would indicate overfitting leak)' },
  I: { kind: 'adversarial', modelClasses: ['single synchronous clock', 'asynchronous but synchronized clocks'], initialConfiguration: 'timing.too-late-correction with sensePeriod 1, actDelay 0, jitter 0, envPeriod 6', perturbation: 'clock model', measuredOutcomes: ['correction class set'], successPredicate: 'neither model produces correct-but-too-late (asynchrony adds no distinction here)', uncertainty: 'exact counts differ with rng use; only the class set is compared', counterEvidence: 'too-late appears with synchronized asynchronous clocks' },
  J: { kind: 'adversarial', modelClasses: ['operational-role description', 'role + unit (thick) description'], initialConfiguration: 'adversarial.twin-units with separate budgets', perturbation: 'cut unit 1 budget at t=60', measuredOutcomes: ['post/pre order-rate ratio per unit'], successPredicate: 'unit ratios differ by > 0.3 (the thick unit label carries interventional information the role description lacks)', uncertainty: 'stochastic ordering; one seed', counterEvidence: 'both units respond alike despite separate budgets' },
  K: { kind: 'adversarial', modelClasses: ['operational-role description', 'role + unit (thick) description'], initialConfiguration: 'adversarial.twin-units with one shared budget', perturbation: 'cut the shared budget at t=60', measuredOutcomes: ['post/pre order-rate ratio per unit'], successPredicate: 'unit ratios differ by ≤ 0.3 (the thick label adds nothing)', uncertainty: 'stochastic ordering; one seed', counterEvidence: 'units respond differently under a shared budget' },
  L: { kind: 'adversarial', modelClasses: ['no self-reorganization', 'self-reorganization'], initialConfiguration: 'adversarial.harmful-reorganization: stable proportional control', perturbation: 'enable the self-reorganization rule', measuredOutcomes: ['damage'], successPredicate: 'damage with reorganization > damage without', uncertainty: 'the reorganization rule is deliberately naive', counterEvidence: 'reorganization does not increase damage' },
  M: { kind: 'discriminating', modelClasses: ['storage identity as address', 'operational address'], initialConfiguration: 'adversarial.slot-reuse', perturbation: 'interpretation', measuredOutcomes: ['continuity claims about α'], successPredicate: 'storage-identity reading claims α persists in s/slot and is lost elsewhere; operational addressing records α lost, β new, α′ re-ignited with lineage', uncertainty: 'constructed case', counterEvidence: 'both readings agree' },
  N: { kind: 'discriminating', modelClasses: ['fixed grammar', 'grammar morphogenesis', 'meta-grammar morphogenesis'], initialConfiguration: 'meta.delay-threshold, three regimes (240/240/80 steps)', perturbation: 'model class; online adaptation, window 30 per round', measuredOutcomes: ['held-out prediction', 'intervention', 'observability', 'reachability differentiation', 'representation change', 'adaptation latency', 'meta-time class (in-time / too-late / never)'], successPredicate: 'meta-grammar adapts to regime 2 in fewer rounds than grammar morphogenesis (adequacy: held-out recovery ≥ 0.78)', uncertainty: 'single world and seed; adequacy threshold chosen so that a delay alone is not adequate in regime 2; lags are observed-index lags', counterEvidence: 'meta-grammar latency ≥ grammar morphogenesis latency, or neither adapts', alternativePredicates: [{ id: 'tau-0.6', description: 'adequacy threshold 0.6' }] },
};

const BENCHES: Bench[] = [
  {
    id: 'A', title: 'Fixed observation vs self-revising observation', question: 'In an environment with initially aliased states, what changes when the apparatus may revise itself — and what does it cost?',
    run: () => {
      const fixed = runSpec(build(hiddenPhase, { reviser: false })), rev = runSpec(build(hiddenPhase, { reviser: true }));
      const m = (tr: Trace) => {
        const hEff = tr.events.filter((e) => e.kind === 'effect' && e.address === 'h');
        const det = hEff.filter((e) => Object.values(tr.epistemic).some((x) => x[e.seq] === 'detected')).length;
        const last = tr.probeRelativeReachability.at(-1)?.probes['negative-excursion']?.fraction ?? null;
        return {
          detection: { hiddenDifferencesDetected: `${det}/${hEff.length}` },
          intervention: { negativeExcursionFlips: tr.probes['negative-excursion'].flips },
          reachability: { finalNegativeExcursionFraction: last },
          downstreamFailure: { negativeExcursionsAfterT20: tr.events.filter((e) => e.kind === 'probe' && e.probe === 'negative-excursion' && e.satisfied && e.t > 20).length },
          resourceCost: { channels: (tr.final.apparatus as any[]).reduce((a, x) => a + x.channels.length, 0), revisions: tr.events.filter((e) => e.kind === 'reorganization' && e.target === 'apparatus').length },
        };
      };
      const a = m(fixed), b = m(rev);
      const axes: Record<string, Record<string, unknown>> = {};
      for (const k of Object.keys(a)) axes[k] = { fixed: (a as any)[k], selfRevising: (b as any)[k] };
      const differ = Object.keys(a).filter((k) => JSON.stringify((a as any)[k]) !== JSON.stringify((b as any)[k]));
      const holds = b.intervention.negativeExcursionFlips < a.intervention.negativeExcursionFlips && b.resourceCost.channels > a.resourceCost.channels;
      return { modelClasses: ['fixed observation', 'self-revising observation'], axes, discriminates: differ.length >= 2,
        hypothesis: 'self-revision reduces downstream failure at a non-zero observation cost', hypothesisHolds: holds,
        verdict: `classes differ on: ${differ.join(', ')}` };
    },
  },
  {
    id: 'B', title: 'Fixed variables vs grammar-bounded generation vs grammar morphogenesis', question: 'When the hidden law is not representable by the initial variable set (delays, windows, thresholds), which model class recovers — out of sample — and does its representation change?',
    run: () => {
      const tr = runSpec(build(delayedLaw));
      const S = observationSeries(tr, 'O', ['x']);
      const ctx = { changeAt: Number(delayedLaw.defaults.switchAt), interventions: [60, 120, 200, 260] };
      const gb = grammarBoundedDiscovery(S, { maxAccept: 5 });
      const mg = grammarMorphogenesis(S, ctx, { rounds: 4 });
      const R = [
        evaluateModelClass('fixed variables', S, {}, ctx, 0, 0),
        evaluateModelClass('grammar-bounded', S, Object.fromEntries(gb.accepted.map((a) => [a.id, a.values])), ctx, 0, 0),
        evaluateModelClass('grammar morphogenesis', S, mg.values, ctx, mg.accepted.filter((a) => a.discrete || /relational|windowed|delayed/.test(Object.values(a.operatorOrigins).join(','))).length, mg.changes.filter((c) => c.retained).length),
      ];
      const axes: Record<string, Record<string, unknown>> = {
        predictiveRecovery: Object.fromEntries(R.map((r) => [r.modelClass, r.predictiveRecovery])),
        interventionRecovery: Object.fromEntries(R.map((r) => [r.modelClass, r.interventionRecovery])),
        novelDistinctionDiscovery: Object.fromEntries(R.map((r) => [r.modelClass, r.novelDistinctions])),
        representationChange: Object.fromEntries(R.map((r) => [r.modelClass, r.representationChange])),
        grammarChanges: { 'grammar morphogenesis': mg.changes.filter((c) => c.retained).map((c) => `${c.change}:${c.op} because ${c.retainedBecause.join('+')}`) },
      };
      const [f, g, m] = R;
      const discriminates = new Set(R.map((r) => r.predictiveRecovery.toFixed(3))).size > 1 || m.representationChange > 0;
      const holds = m.predictiveRecovery > g.predictiveRecovery && g.predictiveRecovery >= f.predictiveRecovery - 1e-9 && m.representationChange > 0 && g.representationChange === 0;
      return { modelClasses: R.map((r) => r.modelClass), axes, discriminates, hypothesis: 'only grammar morphogenesis changes representation, and it recovers more prediction after the hidden-law switch (out of sample)', hypothesisHolds: holds,
        verdict: `out-of-sample post-switch recovery: ${R.map((r) => `${r.modelClass} ${r.predictiveRecovery.toFixed(2)}`).join(' · ')}` };
    },
  },
  {
    id: 'C', title: 'Single synchronous clock vs asynchronous clocks', question: 'Does only the multi-timescale model capture "correct but too late" as distinct from "incorrect"? Can a correct correction fail to modify the configuration because the environment reorganized first?',
    run: () => {
      const single = runSpec(build(tooLate, { singleClock: true, envPeriod: 5, sensorError: 0.25 })), multi = runSpec(build(tooLate, { envPeriod: 5, sensorError: 0.25 }));
      const cs = correctionSummary(single), cm = correctionSummary(multi);
      // too-late corrections that did not modify the configuration: after the effect the system still mismatches the environment
      const failedToModify = corrections(multi).filter((c) => c.label === 'correct-but-too-late').filter((c) => {
        const ev = multi.events.find((e) => e.kind === 'correction' && e.ignition === c.ignition)!;
        const st = replayState(multi, ev.seq); return Math.sign(st.x as number) !== st.regime;
      }).length;
      const axes = { correctionClasses: { 'single clock': cs, 'asynchronous clocks': cm }, correctButFailedToModify: { 'asynchronous clocks': failedToModify, 'single clock': 0 } };
      const holds = !cs['correct-but-too-late'] && (cm['correct-but-too-late'] ?? 0) > 0 && (cs['incorrect'] ?? 0) > 0 && (cm['incorrect'] ?? 0) > 0 && failedToModify > 0;
      return { modelClasses: ['single synchronous clock', 'asynchronous clocks'], axes, discriminates: JSON.stringify(Object.keys(cs).sort()) !== JSON.stringify(Object.keys(cm).sort()),
        hypothesis: 'with zero intra-process latency no correction is too late; with asynchronous clocks too-late appears distinctly from incorrect, and some correct corrections leave the configuration unmodified', hypothesisHolds: holds,
        verdict: `single: ${JSON.stringify(cs)} · asynchronous: ${JSON.stringify(cm)} · correct-but-failed-to-modify: ${failedToModify}` };
    },
  },
  {
    id: 'D', title: 'Aggregate flow vs operational flow bundles', question: 'Does internal feedback structure produce downstream differences when first-order aggregate statistics are matched — and does "trader" add anything beyond operational bundle descriptions? (No winner predefined.)',
    run: () => {
      const r = traderCategoryTest({}, [44, 45, 46]);
      const axes: Record<string, Record<string, unknown>> = {
        vsMatchedAggregate: Object.fromEntries(Object.entries(r.vsAggregate).map(([k, v]) => [k, v.differs])),
        vsBundleDescriptions: Object.fromEntries(Object.entries(r.vsBundles).map(([k, v]) => [k, v.differs])),
        traderBeyondRoles: Object.fromEntries(Object.entries(r.eventLevel.axes).map(([k, v]) => [k, Number(v.traderAdds.toFixed(4))])),
      };
      return { modelClasses: ['five configurations', 'matched aggregate flow', 'operational bundle descriptions'], axes, discriminates: r.aggregateInsufficient || !r.bundlesReproduce,
        hypothesis: null, hypothesisHolds: null, verdict: r.verdict };
    },
  },
  {
    id: 'E', title: 'Fixed boundary vs revisable boundary', question: 'Does responsibility localization change when the analysis boundary is revised? (No boundary is claimed to be universally correct.)',
    run: () => {
      const spec = build(boundaryWorld); const tr = runSpec(spec);
      const inner = responsibilityPoints(spec, tr, { boundary: ['sys/'] }), outer = responsibilityPoints(spec, tr, { boundary: ['sys/', 'env/'] });
      const loci = (ps: typeof inner) => ps.filter((p) => p.nonRedundant).map((p) => `${p.rule} (writes ${p.locus.wrote.join(',')}; differs in ${[...new Set(Object.values(p.profile).flatMap((d) => d.differsIn))].join(',')})`);
      const a = loci(inner), b = loci(outer);
      return { modelClasses: ['boundary sys/', 'boundary sys/ + env/'], axes: { responsibilityLoci: { 'sys/': a, 'sys/ + env/': b } }, discriminates: JSON.stringify(a) !== JSON.stringify(b),
        hypothesis: 'revising the boundary changes where responsibility localizes', hypothesisHolds: JSON.stringify(a) !== JSON.stringify(b) && b.length > a.length,
        verdict: 'localization is boundary-relative; both localizations are reported, neither is privileged' };
    },
  },
  {
    id: 'F', title: 'Scalar-state engine vs open-value engine', question: 'When a relation is stored as a scalar, which operationally different interventions become indistinguishable?',
    run: () => {
      const o = (cut: string) => runSpec(build(relationSpread, { representation: 'relation', cut })), sc = (cut: string) => runSpec(build(relationSpread, { representation: 'scalar', cut }));
      const ob = o('bridge'), ol = o('leaf'), sb = sc('bridge'), sl = sc('leaf');
      const axes = {
        targetReached: { 'open / cut bridge': ob.probes['n4-reached'].first, 'open / cut leaf': ol.probes['n4-reached'].first, 'scalar / cut bridge': sb.probes['n4-reached'].first, 'scalar / cut leaf': sl.probes['n4-reached'].first },
        distinguishesInterventions: { open: ob.meta.runHash !== ol.meta.runHash, scalar: sb.meta.runHash !== sl.meta.runHash },
        valueKinds: { open: ob.summary.valueKinds, scalar: sb.summary.valueKinds },
        probeExpressible: { open: true, scalar: 'no — node identity is not represented; a count surrogate is used' },
      };
      const holds = ob.probes['n4-reached'].first !== ol.probes['n4-reached'].first && sb.meta.runHash === sl.meta.runHash;
      return { modelClasses: ['scalar-state engine', 'open-value engine'], axes, discriminates: holds, hypothesis: 'the scalar representation collapses a bridge cut and a leaf cut into the same run; the open representation does not', hypothesisHolds: holds,
        verdict: holds ? 'information loss with operational consequence: the scalar encoding cannot distinguish interventions that the relation encoding distinguishes' : 'no discriminating consequence found' };
    },
  },
  {
    id: 'G', title: 'Adversarial: no benefit from observation revision', question: 'When nothing downstream uses a new distinction and sensing costs energy, does self-revision still "win"?',
    run: () => {
      const a = runSpec(build(uselessRevision, { reviser: false })), b = runSpec(build(uselessRevision, { reviser: true }));
      const fl = (t: Trace) => t.probes['negative-excursion'].flips, en = (t: Trace) => Number(t.final.state['sensor/energy']);
      const holds = fl(b) >= fl(a) && en(b) < en(a);
      return { modelClasses: ['fixed', 'self-revising'], axes: { flips: { fixed: fl(a), selfRevising: fl(b) }, energy: { fixed: en(a), selfRevising: en(b) }, channels: { fixed: (a.final.apparatus as any[])[0].channels.length, selfRevising: (b.final.apparatus as any[])[0].channels.length } },
        discriminates: true, hypothesis: 'self-revision yields no downstream advantage here and costs energy', hypothesisHolds: holds, outcomeType: 'negative',
        verdict: holds ? 'negative result: the revision resolved an alias but produced no downstream advantage; it only cost energy' : 'unexpected: revision helped' };
    },
  },
  {
    id: 'H', title: 'Adversarial: fixed grammar wins', question: 'In a stable linear world, does grammar morphogenesis add complexity without benefit?',
    run: () => {
      const S = observationSeries(runSpec(build(stableLinear)), 'O', ['x']);
      const mg = grammarMorphogenesis(S, {});
      const f = evaluateModelClass('fixed', S, {}, {}, 0, 0), m = evaluateModelClass('morphogenesis', S, mg.values, {}, 0, 0);
      const holds = f.overallError <= m.overallError + 1e-6;
      return { modelClasses: ['fixed grammar', 'grammar morphogenesis'], axes: { outOfSampleError: { fixed: f.overallError, morphogenesis: m.overallError }, retainedChanges: { morphogenesis: mg.changes.filter((c) => c.retained).length }, heldVariables: { morphogenesis: mg.accepted.map((a) => a.expr) } },
        discriminates: m.overallError !== f.overallError || mg.changes.some((c) => c.retained), hypothesis: 'fixed grammar performs better or equally', hypothesisHolds: holds, outcomeType: holds ? 'negative' : 'positive',
        verdict: holds ? `negative result for morphogenesis: fixed ${f.overallError.toFixed(3)} ≤ morphogenesis ${m.overallError.toFixed(3)}; ${mg.changes.filter((c) => c.retained).length} grammar change(s) retained` : 'morphogenesis beat fixed in a world with nothing to find' };
    },
  },
  {
    id: 'I', title: 'Adversarial: single clock sufficient', question: 'When all relevant dynamics are synchronized, do asynchronous clocks add a distinction?',
    run: () => {
      const P = { envPeriod: 6, sensePeriod: 1, actDelay: 0, envJitter: 0, sensorError: 0.2 };
      const a = correctionSummary(runSpec(build(tooLate, { ...P, singleClock: true }))), b = correctionSummary(runSpec(build(tooLate, P)));
      const holds = !a['correct-but-too-late'] && !b['correct-but-too-late'];
      return { modelClasses: ['single clock', 'synchronized asynchronous clocks'], axes: { correctionClasses: { single: a, asynchronous: b } }, discriminates: JSON.stringify(Object.keys(a).sort()) !== JSON.stringify(Object.keys(b).sort()),
        hypothesis: 'asynchronous clocks add no too-late distinction in a synchronized world', hypothesisHolds: holds, outcomeType: 'null', verdict: holds ? 'null result: same correction class set under both clock models' : 'asynchrony produced a distinction' };
    },
  },
  {
    id: 'J', title: 'Adversarial: thick category useful', question: 'Can a thick unit category carry interventional information that the lower-level role description lacks?',
    run: () => { const r = unitTest(true); return { modelClasses: ['role description', 'role + unit'], axes: { orderRateRatioAfterCut: r.ratios }, discriminates: r.gap > 0.3, hypothesis: 'the unit label adds interventional information', hypothesisHolds: r.gap > 0.3, outcomeType: r.gap > 0.3 ? 'positive' : 'null', verdict: r.gap > 0.3 ? `thick category non-redundant (interventional): unit response ratios ${JSON.stringify(r.ratios)}` : 'thick category redundant here' }; },
  },
  {
    id: 'K', title: 'Adversarial: thick category useless', question: 'In the matched case with a shared budget, does the unit label add anything?',
    run: () => { const r = unitTest(false); return { modelClasses: ['role description', 'role + unit'], axes: { orderRateRatioAfterCut: r.ratios }, discriminates: r.gap > 0.3, hypothesis: 'the unit label adds nothing', hypothesisHolds: r.gap <= 0.3, outcomeType: r.gap <= 0.3 ? 'negative' : 'positive', verdict: r.gap <= 0.3 ? `thick category redundant (interventional): unit response ratios ${JSON.stringify(r.ratios)}` : 'units responded differently' }; },
  },
  {
    id: 'L', title: 'Adversarial: harmful reorganization', question: 'Can self-reorganization destroy a stable, useful configuration?',
    run: () => {
      const a = runSpec(build(harmfulReorg, { reorganize: false })), b = runSpec(build(harmfulReorg));
      const da = Number(a.final.state.damage), db = Number(b.final.state.damage);
      return { modelClasses: ['no self-reorganization', 'self-reorganization'], axes: { damage: { without: da, with: db }, reorganizations: { with: b.events.filter((e) => e.kind === 'note' && e.note === 'reorganized').length }, levels: { with: b.summary.levels } },
        discriminates: da !== db, hypothesis: 'reorganization increases damage here', hypothesisHolds: db > da, outcomeType: db > da ? 'negative' : 'positive', verdict: db > da ? `negative result for reorganization: damage ${da} → ${db}` : 'reorganization did not harm' };
    },
  },
  {
    id: 'M', title: 'Storage identity vs operational address', question: 'Where does treating a storage key as a stable address produce the wrong interpretation?',
    run: () => {
      const tr = runSpec(build(slotReuse));
      const ops = Object.fromEntries((tr.final.operationalAddresses as any[]).map((o) => [o.id, o]));
      const storageReading = { alphaPersistsIn: 's/slot (value continuity assumed)', alphaAt: tr.final.state['s/slot'], alphaElsewhere: 'not recognized' };
      const opReading = { alpha: ops['alpha']?.status, beta: ops['beta']?.status, 'alpha′': `${ops['alpha′']?.status} ← lineage ${ops['alpha′']?.lineage?.join(',')}`, identityPreserved: ops['alpha′']?.identityPreserved, transient: ops['probe-window']?.status, gamma: `${ops['gamma']?.status} among ${JSON.stringify(ops['gamma']?.candidates)}` };
      const holds = ops['alpha']?.status === 'unavailable' && ops['beta']?.status === 'resolved' && ops['alpha′']?.lineage?.includes('alpha');
      return { modelClasses: ['storage identity', 'operational address'], axes: { storageIdentityReading: storageReading, operationalReading: opReading }, discriminates: holds, hypothesis: 'storage identity misreads continuity and loss', hypothesisHolds: holds, outcomeType: 'positive',
        verdict: holds ? 'storage identity would read α as persisting in s/slot (it is β) and miss α′; operational addressing records loss, new address and re-ignition without identity preservation' : 'no misreading found' };
    },
  },
  {
    id: 'N', title: 'Meta-grammar morphogenesis vs grammar morphogenesis vs fixed grammar', question: 'Does abstracting a recurring mutation sequence into a meta-operator shorten adaptation in a later regime (held-out, online)?',
    run: () => {
      const S = observationSeries(runSpec(build(delayThreshold)), 'O', ['x', 'y']);
      const iv = [60, 150, 300, 390, 500];
      const runs = (tau: number) => (['fixed', 'grammar-morphogenesis', 'meta-grammar-morphogenesis'] as const).map((m) => adaptationRun(S, REGIMES_DEFAULT, m, { window: 30, tau, interventions: iv }));
      const R = runs(0.78);
      const lat = (i: number, reg: number) => R[i].regimes[reg].latencyRounds;
      const cmp = (a: number | null, b: number | null) => a !== null && (b === null || a < b);
      const holds = cmp(lat(2, 1), lat(1, 1));
      const R6 = runs(0.6); const holds6 = R6[2].regimes[1].latencyRounds !== null && (R6[1].regimes[1].latencyRounds === null || R6[2].regimes[1].latencyRounds! < R6[1].regimes[1].latencyRounds!);
      const axes: Record<string, Record<string, unknown>> = {};
      for (const k of ['prediction', 'intervention', 'observability', 'reachabilityDifferentiation', 'representationChanges', 'metaChanges'] as const) axes[k] = Object.fromEntries(R.map((r) => [r.mode, r.regimes.map((g) => g.final[k])]));
      axes.adaptationLatencyRounds = Object.fromEntries(R.map((r) => [r.mode, r.regimes.map((g) => g.latencyRounds)]));
      axes.metaTime = Object.fromEntries(R.map((r) => [r.mode, r.regimes.map((g) => g.timing)]));
      axes.metaLineage = { 'meta-grammar-morphogenesis': R[2].metaLineage.map((m) => `${m.op}:${m.id}`) };
      const disc = JSON.stringify(axes.adaptationLatencyRounds) !== JSON.stringify({}) && new Set(R.map((r) => JSON.stringify(r.regimes.map((g) => g.latencyRounds)))).size > 1;
      return { modelClasses: R.map((r) => r.mode), axes, discriminates: disc, hypothesis: 'meta-grammar adapts to regime 2 in fewer rounds than grammar morphogenesis', hypothesisHolds: holds, outcomeType: holds ? 'positive' : 'negative',
        alternativePredicateResults: { 'tau-0.6': holds6 },
        verdict: `${holds ? '' : 'negative result: '}regime-2 latency (rounds, τ=0.78): ${R.map((r) => `${r.mode} ${r.regimes[1].latencyRounds ?? 'never'}`).join(' · ')}; meta-operators: ${R[2].metaLineage.map((m) => m.id).join(', ') || 'none'}` };
    },
  },
];

function unitTest(separate: boolean) {
  const tr = runSpec(build(twinUnits, { separateBudgets: separate }));
  const cut = Number(twinUnits.defaults.cutAt) + 0.5, H = tr.meta.horizon;
  const rate = (u: string, a: number, b2: number) => tr.events.filter((e) => e.kind === 'effect' && e.address === `${u}/orders` && e.t >= a && e.t < b2).length / (b2 - a);
  const ratios = Object.fromEntries(['u1', 'u2'].map((u) => [u, Number((rate(u, cut, H) / Math.max(1e-9, rate(u, 0, cut))).toFixed(3))]));
  return { ratios, gap: Math.abs(ratios.u1 - ratios.u2) };
}

export function definitionOf(id: string): BenchmarkDefinition | undefined {
  const b = BENCHES.find((x) => x.id === id); const d = DEFS[id];
  return b && d ? { id: b.id, title: b.title, question: b.question, ...d } : undefined;
}

export function listTheory() { return BENCHES.map((b) => definitionOf(b.id) ?? { id: b.id, title: b.title, question: b.question }); }

export function runTheoryBenchmarks(only?: string[]): TheoryResult[] {
  return BENCHES.filter((b) => !only || only.includes(b.id)).map((b) => {
    const t0 = Date.now();
    try {
      const r = b.run();
      const def = definitionOf(b.id);
      const outcomeType = r.outcomeType ?? (r.hypothesis === null ? 'null' : r.hypothesisHolds ? 'positive' : 'negative');
      return { id: b.id, title: b.title, question: b.question, definition: def, claimStatus: (outcomeType === 'null' && r.hypothesis === null ? 'unresolved' : 'model-class discrimination') as 'unresolved' | 'model-class discrimination', evidence: 'synthetic' as const, ...r, outcomeType, ms: Date.now() - t0 };
    }
    catch (e) { return { id: b.id, title: b.title, question: b.question, modelClasses: [], axes: {}, discriminates: false, hypothesis: null, hypothesisHolds: null, verdict: 'error', claimStatus: 'unresolved' as const, evidence: 'synthetic' as const, ms: Date.now() - t0, error: String((e as Error).stack ?? e) }; }
  });
}
