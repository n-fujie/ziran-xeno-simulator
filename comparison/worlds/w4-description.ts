// World 4 — Description-space change.
//
// y responds to a driver x. In regime 1 (t < 200) y′ = 0.2y + 0.4x + noise. In regime 2 the response depends on
// whether the 5-step window mean of x exceeds 0.5: y′ = 0.2y + 1·[mean(x_{t−4..t}) > 0.5] + noise — a distinction
// absent from the initial vocabulary {x, y}. Interventions set x (do(x)) at fixed times. Protocol (identical for all
// model classes): at cut-off `until`, a model is fitted on all rows t < until (no regime boundary is given to any
// model), and predicts y_{t+1} on rows [until, end of the evaluator's regime). Error is variance-normalized.
// Calibration note: an earlier draft used persistence 0.5, where y's own autoregression explained ~89% of regime-2
// variance for every model, so no model class could show the distinction; persistence was lowered to 0.2 before
// any comparison conclusions were drawn. The change affects all model classes identically.
import { rng, gauss, mean, round, wls, predictLin, MLP } from '../frameworks/lib.ts';
import { baseRecord, statement, distinctionRow, type ComparisonRecord, type WorldResult, type FairnessCheck, type MatchedConditions } from '../core/schema.ts';
import { grammarMorphogenesis, MUTATION_REGISTRY } from '../../src/analysis/grammar-morphogenesis.ts';

export const W4 = { N: 500, switchAt: 200, window: 5, thr: 0.5, sdx: 0.5, ar: 0.8, noise: 0.1, persistence: 0.2, interventions: [60, 130, 260, 330, 400, 460], tau: 0.25, round: 30, rounds: 6 };
export const W4_SEEDS = [1, 2, 3];

export function series(seed: number, o: Partial<typeof W4> = {}): { x: number[]; y: number[] } {
  const P = { ...W4, ...o }; const r = rng(seed, 51); const x = [0], y = [0];
  for (let t = 0; t < P.N - 1; t++) {
    const k = P.interventions.indexOf(t + 1); x.push(k >= 0 ? (k % 2 ? -2 : 2) : P.ar * x[t] + gauss(r) * P.sdx);
    const w = x.slice(Math.max(0, t - P.window + 1), t + 1); const m = mean(w);
    y.push(P.persistence * y[t] + (t < P.switchAt ? 0.4 * x[t] : m > P.thr ? 1 : 0) + gauss(r) * P.noise);
  }
  return { x, y };
}

interface Model { predictRows: (S: { x: number[]; y: number[] }, until: number, rows: number[]) => { pred: number[]; generated: string[]; origins: string[]; params: number; lost: string[]; ms: number } }
const feats = (S: { x: number[]; y: number[] }, t: number) => [S.x[t], S.y[t]];

const fixedState: Model = { predictRows: (S, until, rows) => { const t0 = performance.now(); const tr = Array.from({ length: until - 1 }, (_, i) => i); const w = wls(tr.map((t) => feats(S, t)), tr.map((t) => S.y[t + 1])); return { pred: rows.map((t) => predictLin(w, feats(S, t))), generated: [], origins: [], params: 3, lost: [], ms: performance.now() - t0 }; } };
const adaptive = (lambda: number): Model => ({ predictRows: (S, until, rows) => { const t0 = performance.now(); const tr = Array.from({ length: until - 1 }, (_, i) => i); const w = wls(tr.map((t) => feats(S, t)), tr.map((t) => S.y[t + 1]), tr.map((t) => lambda ** (until - 2 - t))); return { pred: rows.map((t) => predictLin(w, feats(S, t))), generated: [], origins: [], params: 3, lost: [], ms: performance.now() - t0 }; } });
const mlp = (win: number, seed: number, epochs = 300): Model => ({ predictRows: (S, until, rows) => {
  const t0 = performance.now(); const inp = (t: number) => [...Array.from({ length: win }, (_, k) => S.x[t - k] ?? 0), S.y[t]];
  const tr = Array.from({ length: until - 1 - win }, (_, i) => i + win); const net = new MLP(win + 1, 8, seed);
  net.train(tr.map(inp), tr.map((t) => S.y[t + 1]), epochs, 0.02);
  return { pred: rows.map((t) => net.forward(inp(t)).y), generated: ['8 hidden tanh features (unnamed)'], origins: ['learned'], params: net.params, lost: [], ms: performance.now() - t0 };
} });
const REPR = ['discretize', 'sign', 'continuize'];
const morph = (kind: 'bounded' | 'morph' | 'full', meta: boolean): Model => ({ predictRows: (S, until, rows) => {
  const t0 = performance.now();
  const registry = kind === 'bounded' ? [] : kind === 'morph' ? MUTATION_REGISTRY.filter((m) => !REPR.includes(m.id)) : MUTATION_REGISTRY;
  const res = grammarMorphogenesis(S, { trainFrom: 0, trainUntil: until, interventions: W4.interventions.filter((k) => k < until) }, { rounds: 3, registry, metaGrammar: meta });
  const extra = Object.values(res.values); const tr = Array.from({ length: until - 1 }, (_, i) => i).filter((t) => extra.every((v) => Number.isFinite(v[t])));
  const f = (t: number) => [...feats(S, t), ...extra.map((v) => v[t])];
  const w = wls(tr.map(f), tr.map((t) => S.y[t + 1]));
  const origins = res.accepted.flatMap((a) => Object.entries(a.operatorOrigins).map(([op, o]) => `${op}:${o}`));
  const lost = res.changes.filter((c) => c.retained && c.distinctions?.lost.length).flatMap((c) => c.distinctions!.lost);
  return { pred: rows.map((t) => (extra.every((v) => Number.isFinite(v[t])) ? predictLin(w, f(t)) : predictLin(w, [...feats(S, t), ...extra.map(() => 0)]))), generated: res.accepted.map((a) => a.expr), origins, params: 3 + extra.length + res.finalGrammar.length, lost, ms: performance.now() - t0 };
} });

function nmse(S: { y: number[] }, rows: number[], pred: number[]): number { const ys = rows.map((t) => S.y[t + 1]); const m = mean(ys); const v = mean(ys.map((y) => (y - m) ** 2)) || 1; return mean(rows.map((t, i) => (S.y[t + 1] - pred[i]) ** 2)) / v; }

interface Config { framework: ComparisonRecord['framework']; configuration: string; role: ComparisonRecord['role']; model: (seed: number) => Model; burden: ComparisonRecord['burden']; supplied: string[] }
export const W4_CONFIGS: Config[] = [
  { framework: 'dynamical-systems', configuration: 'fixed-state linear model (y′ ~ x, y)', role: 'primary', model: () => fixedState, supplied: ['state {x, y}', 'linear form'], burden: [{ item: 'state-variables', supplied: '{x, y}', enabled: 'regime 1 fit', prevented: 'the window-threshold distinction', wrongWhen: 'regime 2' }] },
  { framework: 'dynamical-systems', configuration: 'parameter-adaptive linear model (exponential forgetting 0.97)', role: 'primary', model: () => adaptive(0.97), supplied: ['state {x, y}', 'linear form', 'forgetting factor'], burden: [{ item: 'state-variables', supplied: '{x, y}', enabled: 'tracking parameter drift', prevented: 'new variables', wrongWhen: 'regime 2 needs a new distinction, not new parameters' }] },
  { framework: 'feature-learning', configuration: 'feature learning: MLP on an 8-step lag window (8 hidden units)', role: 'primary', model: (s) => mlp(8, s), supplied: ['lag window 8', 'architecture 9-8-1 tanh', '300 Adam epochs'], burden: [{ item: 'feature-window', supplied: '8 lags of x', enabled: 'implicit windowed features', prevented: 'dependence beyond 8 lags' }] },
  { framework: 'feature-learning', configuration: 'feature learning: MLP on a 3-step lag window', role: 'fairness', model: (s) => mlp(3, s), supplied: ['lag window 3'], burden: [{ item: 'feature-window', supplied: '3 lags (shorter than the true window 5)', enabled: 'fewer parameters', prevented: 'the full window', wrongWhen: 'the relevant window exceeds 3' }] },
  { framework: 'feature-learning', configuration: 'feature learning: MLP 8-step window, 1000 epochs (unmatched compute)', role: 'budget-sensitivity', model: (s) => mlp(8, s, 1000), supplied: ['lag window 8', '1000 epochs'], burden: [{ item: 'feature-window', supplied: '8 lags of x', enabled: 'implicit windowed features', prevented: '—' }] },
  { framework: 'ziran-xeno', configuration: 'grammar-bounded (v0.3.0 engine, empty mutation registry)', role: 'primary', model: () => morph('bounded', false), supplied: ['supplied grammar G0 (diff, inv, inv_sq, sq, abs, log, sub, mul, ratio)'], burden: [{ item: 'grammar', supplied: 'fixed operator grammar', enabled: 'named variables', prevented: 'operators outside G0' }] },
  { framework: 'ziran-xeno', configuration: 'grammar morphogenesis (v0.3.0, no representation-change operators)', role: 'primary', model: () => morph('morph', false), supplied: ['G0', 'mutation registry minus discretize / sign / continuize'], burden: [{ item: 'grammar', supplied: 'G0 + 6 mutation operators', enabled: 'delays, windows, composition', prevented: 'discrete representations' }] },
  { framework: 'ziran-xeno', configuration: 'description-space transformation (v0.3.0 full registry + meta-grammar)', role: 'primary', model: () => morph('full', true), supplied: ['G0', 'full mutation registry', 'meta-grammar'], burden: [{ item: 'grammar', supplied: 'G0 + 9 mutation operators + meta-operations', enabled: 'representation change', prevented: 'step types outside the templates' }] },
  { framework: 'ziran-xeno', configuration: 'ablation: no MetaConfiguration (full registry, meta-grammar off)', role: 'ablation', model: () => morph('full', false), supplied: ['as primary, meta-grammar off'], burden: [] },
];

export function runWorld4(seeds = W4_SEEDS): WorldResult {
  const records: ComparisonRecord[] = [];
  for (const c of W4_CONFIGS) {
    const r = baseRecord('W4-description-space-change', c.framework, c.configuration, c.role); r.representationSupplied = c.supplied; r.burden = c.burden;
    const perSeed = seeds.map((seed) => {
      const S = series(seed); const M = c.model(seed); const base = fixedState;
      const evalAt = (until: number, end: number) => { const rows = Array.from({ length: end - 1 - until }, (_, i) => until + i); const p = M.predictRows(S, until, rows); const b = base.predictRows(S, until, rows); const ivRows = rows.filter((t) => W4.interventions.some((k) => t >= k && t <= k + 6)); const idx = ivRows.map((t) => rows.indexOf(t)); return { e: nmse(S, rows, p.pred), eb: nmse(S, rows, b.pred), iv: ivRows.length >= 5 ? nmse(S, ivRows, idx.map((i) => p.pred[i])) : null, ivb: ivRows.length >= 5 ? nmse(S, ivRows, idx.map((i) => b.pred[i])) : null, p }; };
      const r2 = Array.from({ length: W4.rounds }, (_, k) => evalAt(W4.switchAt + W4.round * (k + 1), W4.N));
      const r1 = evalAt(W4.switchAt - 20, W4.switchAt);
      const rec = r2.map((x) => (x.eb > 0 ? 1 - x.e / x.eb : 0)); const lat = rec.findIndex((x) => x >= W4.tau);
      return { rec, lat: lat < 0 ? null : lat + 1, final: r2.at(-1)!, regime1: r1, ms: r2.reduce((s, x) => s + x.p.ms, 0) + r1.p.ms };
    });
    const f = perSeed.map((x) => x.final);
    r.measurements = {
      adaptationLatencyRounds: perSeed.map((x) => x.lat ?? 'never') as (number | string)[],
      heldOutRecoveryByRound_seed1: perSeed[0].rec.map((x) => round(x, 3)),
      prediction_regime2_finalNMSE: round(mean(f.map((x) => x.e)), 3),
      prediction_regime2_fixedStateNMSE: round(mean(f.map((x) => x.eb)), 3),
      intervention_regime2_NMSE: f.every((x) => x.iv !== null) ? round(mean(f.map((x) => x.iv!)), 3) : null,
      prediction_regime1_NMSE: round(mean(perSeed.map((x) => x.regime1.e)), 3),
      newDistinctions_named: [...new Set(f.flatMap((x) => x.p.generated.filter((g) => !/hidden/.test(g))))].slice(0, 8),
      newDistinctions_unnamed: f[0].p.generated.some((g) => /hidden/.test(g)) ? 8 : 0,
      representationCost_params: Math.round(mean(f.map((x) => x.p.params))),
      informationLoss: [...new Set(f.flatMap((x) => x.p.lost))].slice(0, 6),
    };
    r.representationGenerated = [...new Set(f.flatMap((x) => x.p.generated))].slice(0, 8);
    r.descriptionRevisions = c.framework === 'ziran-xeno' ? [...new Set(f.flatMap((x) => x.p.origins.filter((o) => !/supplied/.test(o))))].slice(0, 8) : [];
    r.modelRevisions = c.configuration.includes('adaptive') ? ['parameters re-weighted each cut-off'] : [];
    r.timing = { adaptationLatencyRounds_seed1: perSeed[0].lat, roundLength: W4.round };
    r.cost = { computeMs: round(mean(perSeed.map((x) => x.ms)), 1), modelEvaluations: null, dataSteps: W4.N, observationsUsed: W4.N * 2, interventionCount: W4.interventions.length, memoryItems: null, representationComplexity: r.measurements.representationCost_params as number, note: 'per seed, all cut-offs' };
    r.conversions = [{ from: 'continuous x history', to: c.configuration.includes('MLP') ? 'lag window vector' : c.framework === 'ziran-xeno' ? 'generated variables' : 'current x', retained: c.configuration.includes('MLP') ? [`last ${c.configuration.includes('3-step') ? 3 : 8} values`] : ['current x'], lost: c.configuration.includes('MLP') ? ['values beyond the window'] : c.framework === 'ziran-xeno' ? ['what no generated variable carries'] : ['all history beyond x_t'], newlyAvailable: r.representationGenerated, unresolved: [] }];
    r.detectedDifferences = perSeed.some((x) => x.lat !== null) ? ['regime-2 dependence captured (recovery ≥ 0.25)'] : [];
    r.inaccessibleDifferences = perSeed.every((x) => x.lat === null) ? ['window-threshold distinction (not captured within 6 rounds)'] : [];
    records.push(r);
  }
  // oracle reference (not a framework): least squares with the true feature, fitted and evaluated like the others
  const oracle = seeds.map((seed) => { const S = series(seed); const until = W4.switchAt + W4.round * W4.rounds; const ind = S.x.map((_, t) => (mean(S.x.slice(Math.max(0, t - W4.window + 1), t + 1)) > W4.thr ? 1 : 0)); const tr = Array.from({ length: until - 1 - W4.switchAt }, (_, i) => W4.switchAt + i); const w = wls(tr.map((t) => [S.y[t], ind[t]]), tr.map((t) => S.y[t + 1])); const rows = Array.from({ length: W4.N - 1 - until }, (_, i) => until + i); return nmse(S, rows, rows.map((t) => predictLin(w, [S.y[t], ind[t]]))); });
  // world-parameter diagnostic for the stop condition (§32): does grammar morphogenesis fail because of the window?
  const diag = [1, 5].map((win) => { const S = series(1, { window: win }); const res = grammarMorphogenesis(S, { trainFrom: 0, trainUntil: 440 }, { rounds: 4, metaGrammar: true }); return `window ${win}: retained ${res.accepted.map((a) => a.expr).join(', ') || 'none'}`; });
  const find = (p: string) => records.find((r) => r.configuration.includes(p))!;
  const fairness: FairnessCheck[] = [
    { distinction: 'window-threshold distinction', firstConfiguration: find('3-step').configuration, alternativeConfiguration: find('8-step').configuration, alternativeTested: true, retainedUnderAlternative: (find('8-step').measurements.adaptationLatencyRounds as (number | string)[]).some((x) => typeof x === 'number'), note: 'the feature learner depends on the supplied window length' },
    { distinction: 'window-threshold distinction', firstConfiguration: find('grammar-bounded').configuration, alternativeConfiguration: find('description-space transformation').configuration, alternativeTested: true, retainedUnderAlternative: (find('description-space transformation').measurements.adaptationLatencyRounds as (number | string)[]).some((x) => typeof x === 'number'), note: `diagnostic on world parameters (seed 1): ${diag.join(' · ')}` },
  ];
  const statements = records.map((r) => statement(r.configuration, r.framework, 'window-threshold dependence in regime 2', (r.measurements.adaptationLatencyRounds as (number | string)[]).some((x) => typeof x === 'number'), `latency ${JSON.stringify(r.measurements.adaptationLatencyRounds)} rounds; final NMSE ${r.measurements.prediction_regime2_finalNMSE} vs fixed ${r.measurements.prediction_regime2_fixedStateNMSE}`));
  const matched: MatchedConditions = { world: 'W4-description-space-change', inputData: 'the same series per seed (x, y, 500 steps) for every model class', initialConditions: 'x₀ = y₀ = 0', interventionHistory: 'do(x = ±2) at t ∈ {60, 130, 260, 330, 400, 460}, known to all', temporalHorizon: '500', computationalBudget: 'not equalized; recorded (MLP 300 epochs; morphogenesis 3 rounds per cut-off)', observationAvailability: 'x and y, noise-free readings', measurementResolution: 'exact', resourceConstraints: 'none', evaluationWindow: 'regime 2: rows [200 + 30k, 500), k = 1…6; regime 1: rows [180, 200)', sameness: [{ framework: 'all', sameRawSource: true, samePreprocessing: true, sameObservation: true, sameStateRepresentation: false, sameIntervention: true, sameOperationalEffect: null, transformation: 'models construct their own inputs (current values, lag windows, generated variables); readout for linear and grammar models is least squares on y′' }, { framework: 'ziran-xeno', sameRawSource: true, samePreprocessing: true, sameObservation: true, sameStateRepresentation: false, sameIntervention: true, sameOperationalEffect: null, transformation: 'grammar-bounded uses the v0.3.0 morphogenesis engine with an empty mutation registry, because grammarBoundedDiscovery has no train/test split; v0.3.0 selection criteria predict all observed series (x and y), the comparison evaluates y only' }] };
  return { world: 'W4-description-space-change', question: 'When successful modelling requires a distinction absent from the initial vocabulary, which model classes generate it, how fast, at what representation cost, and with what loss?', design: 'regime switch at t=200 from linear to window-threshold dependence', matched, records, fairness, statements, distinctionTable: [distinctionRow('regime-2 dependence captured', records, (r) => (r.measurements.adaptationLatencyRounds as (number | string)[]).some((x) => typeof x === 'number')), distinctionRow('named new distinction generated', records, (r) => (r.measurements.newDistinctions_named as string[]).length > 0)], notApplicable: [{ framework: 'agent-based-modeling', reason: 'no population' }, { framework: 'reinforcement-learning', reason: 'prediction task without actions or reward; the feature-learning baseline covers learned representations' }, { framework: 'active-inference', reason: 'structure learning over this hypothesis space was not implemented; a fixed generative model would coincide with the fixed-state baseline' }, { framework: 'viability-reachability', reason: 'prediction task without a constraint set' }, { framework: 'control-mpc', reason: 'prediction task; the adaptive linear model is the corresponding estimator' }, { framework: 'digital-twin', reason: 'covered by the parameter-adaptive model (state and parameter update, fixed variable structure)' }], references: { diagnostic: diag.join(' · '), oracleNMSE_regime2: round(mean(oracle), 3), oracleNote: 'least squares on (y, true window-threshold indicator), trained on regime-2 rows only — uses knowledge no model has; shows the room for improvement over the fixed-state NMSE' }, claimStatus: 'synthetic-world result' };
}
