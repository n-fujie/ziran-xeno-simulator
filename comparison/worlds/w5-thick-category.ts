// World 5 — Thick category (paired worlds).
//
// Eight order streams, each labelled with an account (a1: s1–s4, a2: s5–s8) in its metadata. Counts per step are
// Poisson with rate base_i × budget available to stream i.
//   World A — each account has its own budget: the account label carries interventionally relevant structure.
//   World B — one pooled budget: the same label exists but budget cuts act on the pool.
// Interventions (identical in both worlds, stated in account terms): t=100 "cut account a2's budget by 40%",
// t=200 "cut account a1's budget by 50%". In World B a cut of an account's budget reduces the pool by that account's
// share. Every framework sees counts up to t=200 and the two intervention statements, and predicts each stream's
// post/pre rate ratio for the t=200 intervention. Nothing assumes which world a framework handles better.
import { rng, next, mean, round, type RngState } from '../frameworks/lib.ts';
import { baseRecord, statement, distinctionRow, type ComparisonRecord, type WorldResult, type FairnessCheck, type MatchedConditions } from '../core/schema.ts';

export const W5 = { streams: 8, horizon: 300, cut1: { t: 100, account: 'a2', frac: 0.4 }, cut2: { t: 200, account: 'a1', frac: 0.5 }, window: 50 };
export const W5_SEEDS = [1, 2, 3];
export const ACCOUNT = (i: number) => (i < 4 ? 'a1' : 'a2');

function poisson(lam: number, r: RngState): number { const L = Math.exp(-lam); let k = 0, p = 1; do { k++; p *= next(r); } while (p > L); return k - 1; }

export function generate(world: 'A' | 'B', seed: number): { counts: number[][]; base: number[] } {
  const r = rng(seed, 61); const base = Array.from({ length: W5.streams }, () => 2 + next(r) * 2);
  const budget: Record<string, number> = { a1: 1, a2: 1 }; let pool = 1; const counts: number[][] = [];
  for (let t = 0; t < W5.horizon; t++) {
    for (const cut of [W5.cut1, W5.cut2]) if (t === cut.t) { if (world === 'A') budget[cut.account] *= 1 - cut.frac; else pool -= 0.5 * cut.frac * (cut.account === 'a1' ? budget.a1 : budget.a2); if (world === 'B') budget[cut.account] *= 1 - cut.frac; }
    counts.push(base.map((b, i) => poisson(b * (world === 'A' ? budget[ACCOUNT(i)] : pool), r)));
  }
  return { counts, base };
}
const ratioAt = (counts: number[][], t: number, i: number) => mean(counts.slice(t, t + W5.window).map((c) => c[i])) / Math.max(1e-9, mean(counts.slice(t - W5.window, t).map((c) => c[i])));

interface Pred { ratios: number[]; usesCategory: boolean; categoryJudgement: string; evidence: string; params: number }
type Predictor = (counts: number[][]) => Pred;

/** ABM: agents = accounts (traders) owning their streams; each agent's budget scales its streams. */
const abmAgents: Predictor = () => ({ ratios: Array.from({ length: W5.streams }, (_, i) => (ACCOUNT(i) === W5.cut2.account ? 1 - W5.cut2.frac : 1)), usesCategory: true, categoryJudgement: 'assumed (agents defined by account)', evidence: 'agent identity = account; agent budget scales its streams', params: 2 });
/** ABM with calibrated structure: choose between per-agent budgets and an environment-level shared budget by fit to the t=100 response. */
const abmCalibrated: Predictor = (counts) => {
  const obs = Array.from({ length: W5.streams }, (_, i) => ratioAt(counts, W5.cut1.t, i));
  const perAgent = obs.map((_, i) => (ACCOUNT(i) === W5.cut1.account ? 1 - W5.cut1.frac : 1)); const shared = obs.map(() => 1 - 0.5 * W5.cut1.frac);
  const sse = (p: number[]) => p.reduce((s, x, i) => s + (x - obs[i]) ** 2, 0); const agentWins = sse(perAgent) < sse(shared);
  const ratios = Array.from({ length: W5.streams }, (_, i) => (agentWins ? (ACCOUNT(i) === W5.cut2.account ? 1 - W5.cut2.frac : 1) : (1 - 0.5 * W5.cut2.frac * 1) / 1 * 1));
  // shared-budget prediction for the second cut: pool loses half of a1's (unreduced) share
  const pool1 = 1 - 0.5 * W5.cut1.frac, pool2 = pool1 - 0.5 * W5.cut2.frac; if (!agentWins) for (let i = 0; i < W5.streams; i++) ratios[i] = pool2 / pool1;
  return { ratios, usesCategory: agentWins, categoryJudgement: agentWins ? 'per-agent budget structure selected' : 'shared environment budget selected', evidence: `SSE per-agent ${round(sse(perAgent), 3)} vs shared ${round(sse(shared), 3)}`, params: 2 };
};
/** Aggregate dynamical model: total flow with a pooled budget; no account structure. */
const aggregate: Predictor = () => { const pool1 = 1 - 0.5 * W5.cut1.frac, pool2 = pool1 - 0.5 * W5.cut2.frac; return { ratios: new Array(W5.streams).fill(pool2 / pool1), usesCategory: false, categoryJudgement: 'not represented', evidence: 'total flow ∝ pooled budget', params: 1 }; };
/** Digital twin at stream level: per-stream elasticity to budget events estimated from the t=100 response; optional account variable. */
const twin = (withAccount: boolean): Predictor => (counts) => {
  const el = Array.from({ length: W5.streams }, (_, i) => (1 - ratioAt(counts, W5.cut1.t, i)) / W5.cut1.frac);
  if (!withAccount) return { ratios: el.map((e) => Math.max(0, 1 - e * W5.cut2.frac)), usesCategory: false, categoryJudgement: 'not represented (stream state vocabulary)', evidence: 'per-stream elasticity carried to the next budget event', params: W5.streams };
  // account variable: elasticity to "own account cut" vs "other account cut" estimated from the t=100 event
  const own = mean(el.filter((_, i) => ACCOUNT(i) === W5.cut1.account)), other = mean(el.filter((_, i) => ACCOUNT(i) !== W5.cut1.account));
  return { ratios: el.map((_, i) => Math.max(0, 1 - (ACCOUNT(i) === W5.cut2.account ? own : other) * W5.cut2.frac)), usesCategory: true, categoryJudgement: `account variable in twin state; elasticity own ${round(own, 2)} / other ${round(other, 2)}`, evidence: 'twin extended with the account label', params: 2 };
};
/**
 * Active inference / Bayesian model comparison over two generative structures (per-account budgets vs pooled
 * budget), using the Poisson likelihood of the post-t=100 counts; predictions are posterior-weighted.
 */
const aifBMC: Predictor = (counts) => {
  const pre = Array.from({ length: W5.streams }, (_, i) => mean(counts.slice(W5.cut1.t - W5.window, W5.cut1.t).map((c) => c[i])));
  const post = counts.slice(W5.cut1.t, W5.cut1.t + W5.window);
  const logLik = (factor: (i: number) => number) => post.reduce((s, c) => s + c.reduce((t, k, i) => { const lam = Math.max(1e-6, pre[i] * factor(i)); return t + k * Math.log(lam) - lam; }, 0), 0);
  const lA = logLik((i) => (ACCOUNT(i) === W5.cut1.account ? 1 - W5.cut1.frac : 1)), lB = logLik(() => 1 - 0.5 * W5.cut1.frac);
  const m = Math.max(lA, lB); const pA = Math.exp(lA - m) / (Math.exp(lA - m) + Math.exp(lB - m));
  const pool1 = 1 - 0.5 * W5.cut1.frac, pool2 = pool1 - 0.5 * W5.cut2.frac;
  return { ratios: Array.from({ length: W5.streams }, (_, i) => pA * (ACCOUNT(i) === W5.cut2.account ? 1 - W5.cut2.frac : 1) + (1 - pA) * (pool2 / pool1)), usesCategory: pA > 0.5, categoryJudgement: `posterior P(per-account structure) = ${round(pA, 3)}`, evidence: `log-evidence difference ${round(lA - lB, 1)}`, params: 2 };
};
/**
 * Ziran / Xeno adapter: provisional operational bundles recovered from the t=100 response (feature: response ratio;
 * grouping: split at the largest gap if it exceeds 0.15), then the v0.3.0 J/K predicate: the account label is
 * non-redundant if it isolates a recovered bundle and unit response ratios differ by > 0.3.
 * Prediction uses the label only when it was judged non-redundant.
 */
const ziran = (scalarValues: boolean): Predictor => (counts) => {
  const pool1 = 1 - 0.5 * W5.cut1.frac, pool2 = pool1 - 0.5 * W5.cut2.frac;
  if (scalarValues) { return { ratios: new Array(W5.streams).fill(pool2 / pool1), usesCategory: false, categoryJudgement: 'no per-stream values (collapsed to total flow); label not testable', evidence: 'ablation: fixed operational values', params: 1 }; }
  const resp = Array.from({ length: W5.streams }, (_, i) => ratioAt(counts, W5.cut1.t, i));
  const order = resp.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]); let gap = 0, at = -1;
  for (let k = 1; k < order.length; k++) if (order[k][0] - order[k - 1][0] > gap) { gap = order[k][0] - order[k - 1][0]; at = k; }
  const bundles = gap > 0.15 ? [order.slice(0, at).map((x) => x[1]), order.slice(at).map((x) => x[1])] : [order.map((x) => x[1])];
  const labelIsolates = bundles.length > 1 && bundles.every((b) => new Set(b.map(ACCOUNT)).size === 1);
  const unitRatio = (a: string) => mean(resp.filter((_, i) => ACCOUNT(i) === a)); const diff = Math.abs(unitRatio('a1') - unitRatio('a2'));
  const nonRedundant = labelIsolates && diff > 0.3;
  return { ratios: Array.from({ length: W5.streams }, (_, i) => (nonRedundant ? (ACCOUNT(i) === W5.cut2.account ? 1 - W5.cut2.frac : 1) : pool2 / pool1)), usesCategory: nonRedundant, categoryJudgement: nonRedundant ? 'account label non-redundant (isolates a recovered bundle; unit ratio difference > 0.3)' : 'account label redundant given the recovered bundles', evidence: `provisional bundles (schema: per-stream counts, feature: response ratio, window ±${W5.window}, procedure: largest-gap split > 0.15): ${bundles.map((b) => `{${b.map((i) => 's' + (i + 1)).join(',')}}`).join(' ')}; unit ratio difference ${round(diff, 3)}`, params: bundles.length };
};

interface Config { framework: ComparisonRecord['framework']; configuration: string; role: ComparisonRecord['role']; predict: Predictor; supplied: string[]; burden: ComparisonRecord['burden'] }
export const W5_CONFIGS: Config[] = [
  { framework: 'agent-based-modeling', configuration: 'ABM: accounts as agents owning streams', role: 'primary', predict: abmAgents, supplied: ['agents = accounts', 'agent budget → stream rates'], burden: [{ item: 'agents', supplied: 'account = agent', enabled: 'account-level intervention semantics', prevented: 'pooled-budget structure', wrongWhen: 'World B' }] },
  { framework: 'agent-based-modeling', configuration: 'ABM with budget structure selected by fit to the first intervention', role: 'fairness', predict: abmCalibrated, supplied: ['two candidate agent structures', 'calibration on t=100'], burden: [{ item: 'agents', supplied: 'agents plus a structural alternative', enabled: 'choosing the structure from data', prevented: '—' }] },
  { framework: 'dynamical-systems', configuration: 'aggregate flow model (pooled budget)', role: 'primary', predict: aggregate, supplied: ['total flow ∝ pooled budget'], burden: [{ item: 'state-variables', supplied: 'total flow', enabled: 'parsimony', prevented: 'account structure', wrongWhen: 'World A' }] },
  { framework: 'digital-twin', configuration: 'stream-level twin (per-stream elasticity, no account variable)', role: 'primary', predict: twin(false), supplied: ['per-stream state', 'elasticity update from events'], burden: [{ item: 'state-variables', supplied: 'one state per stream', enabled: 'stream-specific response', prevented: 'relating an event to its target account', wrongWhen: 'the next event targets a different account' }] },
  { framework: 'digital-twin', configuration: 'twin extended with the account variable', role: 'fairness', predict: twin(true), supplied: ['per-stream state + account label'], burden: [{ item: 'state-variables', supplied: 'account label added', enabled: 'event targeting', prevented: '—' }] },
  { framework: 'active-inference', configuration: 'Bayesian model comparison over two generative structures', role: 'primary', predict: aifBMC, supplied: ['two generative structures', 'Poisson likelihood', 'flat structure prior'], burden: [{ item: 'hidden-factors', supplied: 'the two candidate structures', enabled: 'evidence-weighted prediction', prevented: 'structures outside the pair' }] },
  { framework: 'ziran-xeno', configuration: 'Ziran / Xeno adapter (provisional bundles + v0.3.0 J/K predicate)', role: 'primary', predict: ziran(false), supplied: ['feature constructor: response ratio', 'grouping: largest gap > 0.15', 'J/K predicate (difference > 0.3)'], burden: [{ item: 'other', supplied: 'feature, grouping procedure and predicate', enabled: 'testing the label rather than assuming it', prevented: 'bundles the feature cannot separate' }] },
  { framework: 'ziran-xeno', configuration: 'ablation: fixed operational values (per-stream values collapsed)', role: 'ablation', predict: ziran(true), supplied: ['total flow only'], burden: [] },
];

export function runWorld5(seeds = W5_SEEDS): WorldResult {
  const records: ComparisonRecord[] = [];
  for (const c of W5_CONFIGS) {
    const r = baseRecord('W5-thick-category', c.framework, c.configuration, c.role); r.representationSupplied = c.supplied; r.burden = c.burden;
    const t0 = performance.now();
    const res = (['A', 'B'] as const).map((w) => seeds.map((s) => { const { counts } = generate(w, s); const truthR = Array.from({ length: W5.streams }, (_, i) => ratioAt(counts, W5.cut2.t, i)); const p = c.predict(counts.slice(0, W5.cut2.t)); return { p, mae: mean(p.ratios.map((x, i) => Math.abs(x - truthR[i]))), truthR }; }));
    const ms = performance.now() - t0;
    for (const [k, w] of (['A', 'B'] as const).entries()) {
      r.measurements[`world${w}_predictionMAE`] = round(mean(res[k].map((x) => x.mae)), 3);
      r.measurements[`world${w}_usesCategory`] = res[k].every((x) => x.p.usesCategory) ? true : res[k].every((x) => !x.p.usesCategory) ? false : `${res[k].filter((x) => x.p.usesCategory).length}/${seeds.length}`;
      r.measurements[`world${w}_judgement_seed1`] = res[k][0].p.categoryJudgement;
      r.measurements[`world${w}_predicted_seed1`] = res[k][0].p.ratios.map((x) => round(x, 2));
      r.measurements[`world${w}_actual_seed1`] = res[k][0].truthR.map((x) => round(x, 2));
    }
    r.notes.push(`evidence (World A, seed 1): ${res[0][0].p.evidence}`, `evidence (World B, seed 1): ${res[1][0].p.evidence}`);
    r.detectedDifferences = [r.measurements.worldA_usesCategory === true && r.measurements.worldB_usesCategory === false ? 'category relevant in A and redundant in B (distinguished)' : 'worlds A and B not distinguished by category use'];
    r.interventions = ['t=100 cut a2 −40%', 't=200 cut a1 −50% (predicted)'];
    r.observationsSupplied = ['per-stream counts t < 200', 'account metadata label', 'intervention statements'];
    r.cost = { computeMs: round(ms, 2), modelEvaluations: null, dataSteps: W5.cut2.t, observationsUsed: W5.cut2.t * W5.streams, interventionCount: 1, memoryItems: null, representationComplexity: res[0][0].p.params };
    r.conversions = c.configuration.includes('collapsed') || c.configuration.includes('aggregate') ? [{ from: 'per-stream counts', to: 'total flow', retained: ['total rate'], lost: ['which streams respond'], newlyAvailable: [], unresolved: [] }] : c.framework === 'ziran-xeno' ? [{ from: 'trace (per-stream counts)', to: 'provisional bundles', retained: ['response-ratio groups'], lost: ['within-bundle differences'], newlyAvailable: ['bundle membership'], unresolved: ['whether other features would group differently'] }] : [];
    records.push(r);
  }
  const statements = records.flatMap((r) => (['A', 'B'] as const).map((w) => statement(r.configuration, r.framework, `account category in World ${w}`, r.measurements[`world${w}_usesCategory`] === true ? true : r.measurements[`world${w}_usesCategory`] === false ? false : null, `prediction MAE ${r.measurements[`world${w}_predictionMAE`]}`)));
  const find = (p: string) => records.find((r) => r.configuration.includes(p))!;
  const fairness: FairnessCheck[] = [
    { distinction: 'category redundant in World B', firstConfiguration: find('accounts as agents').configuration, alternativeConfiguration: find('selected by fit').configuration, alternativeTested: true, retainedUnderAlternative: find('selected by fit').measurements.worldB_usesCategory === false, note: `ABM MAE in B ${find('accounts as agents').measurements.worldB_predictionMAE} → ${find('selected by fit').measurements.worldB_predictionMAE}` },
    { distinction: 'category relevant in World A', firstConfiguration: find('no account variable').configuration, alternativeConfiguration: find('extended with the account').configuration, alternativeTested: true, retainedUnderAlternative: find('extended with the account').measurements.worldA_usesCategory === true, note: `twin MAE in A ${find('no account variable').measurements.worldA_predictionMAE} → ${find('extended with the account').measurements.worldA_predictionMAE}` },
  ];
  const matched: MatchedConditions = { world: 'W5-thick-category', inputData: 'same counts per world and seed for all', initialConditions: 'budgets 1', interventionHistory: 'two account-level budget cuts, stated identically in both worlds', temporalHorizon: '300 (prediction target: response to the t=200 cut)', computationalBudget: 'negligible for all', observationAvailability: 'per-stream counts and account labels', measurementResolution: 'Poisson counts', resourceConstraints: 'budgets', evaluationWindow: '50 steps before/after each cut', sameness: [{ framework: 'all', sameRawSource: true, samePreprocessing: true, sameObservation: true, sameStateRepresentation: false, sameIntervention: true, sameOperationalEffect: null, transformation: 'each framework maps "cut account a’s budget" into its own representation (agent budget, pool, stream elasticity, structure posterior, bundle)' }] };
  return { world: 'W5-thick-category', question: 'In paired worlds where an account category is interventionally relevant (A) or redundant (B), how does each framework handle it, and what does that do to intervention prediction?', design: 'eight Poisson streams, two accounts; separate budgets (A) vs pooled budget (B)', matched, records, fairness, statements, distinctionTable: [distinctionRow('category used in World A', records, (r) => r.measurements.worldA_usesCategory === true), distinctionRow('category not used in World B', records, (r) => r.measurements.worldB_usesCategory === false)], notApplicable: [{ framework: 'reinforcement-learning', reason: 'prediction of an intervention response; no action or reward' }, { framework: 'control-mpc', reason: 'no control task' }, { framework: 'viability-reachability', reason: 'no constraint set' }, { framework: 'feature-learning', reason: 'eight streams and two interventions give too few samples for a learned representation to be meaningful' }], references: { note: 'actual ratios are estimated from 50-step windows of Poisson counts; the irreducible MAE from counting noise is non-zero' }, claimStatus: 'synthetic-world result' };
}
