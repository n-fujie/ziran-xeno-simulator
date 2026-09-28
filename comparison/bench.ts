// External Framework Comparison Benchmarks (research branch; separate from the v0.3.0 suites).
//
// Purpose: compare operational consequences under matched conditions across modelling frameworks. There is no
// global score and no winner; results are statements per distinction, per configuration.
import type { WorldResult, ComparisonRecord } from './core/schema.ts';
import { runWorld1 } from './worlds/w1-aliasing.ts';
import { runWorld2 } from './worlds/w2-too-late.ts';
import { runWorld3, ITEMS } from './worlds/w3-fragility.ts';
import { runWorld4 } from './worlds/w4-description.ts';
import { runWorld5 } from './worlds/w5-thick-category.ts';

export interface ECDefinition { id: string; world: string; question: string; setup: string; compared: string; measured: string[]; predicate: string; wouldCountAsFailure: string }

export const EC_DEFINITIONS: ECDefinition[] = [
  { id: 'EC1', world: 'W1-observation-aliasing', question: 'Which frameworks register a hidden-mode distinction that the initial apparatus aliases, and how (model vs apparatus revision)?', setup: 'x′ = 0.9x + 0.4·h·u + noise; h flips 3× at unknown times; h sensor installable by any framework', compared: 'MPC (nominal, adaptive), RL (fixed, history, sensor action, 10× data), AIF (with/without mode), twin (Kalman, IMM), viability (fixed, information state), Ziran adapter (+ ablation, override)', measured: ['aliasing detected', 'model changed', 'apparatus changed', 'estimate- and behaviour-based latency', 'intervention success', 'energy', 'lost / new observability', 'downstream reachability'], predicate: 'none predefined: per-distinction statements only', wouldCountAsFailure: 'a baseline reported as not retaining the mode distinction while a standard configuration of it that retains it was not tested; or unequal observation access' },
  { id: 'EC2', world: 'W2-too-late-correction', question: 'Which frameworks avoid, self-register or merely suffer corrections that are correct at issue but too late at landing?', setup: 'integrator plant, actuator delay 3, sensor delay 1, target switches every 8–16 steps (unknown schedule)', compared: 'synchronous P, delay-compensated, asynchronous MPC, RL (fixed, goal-conditioned, options, clock feature), AIF, Ziran adapter (+ single-clock ablation)', measured: ['correctness at issue', 'reorganization before landing', 'realized effect', 'correct-but-too-late count', 'tracking error', 'self-classification'], predicate: 'none predefined', wouldCountAsFailure: 'the switching schedule given to some frameworks and not others; correctness and realized effect merged into one measure' },
  { id: 'EC3', world: 'W3-fragility-transfer', question: 'Which frameworks register the downstream consequences of one matched local optimization?', setup: 'shared reservoir, B curtailment rule, scheduled C demand; candidate: A draw 1.8 and meter moved from C to A', compared: 'ABM (+ sweep), local / centralized MPC, RL evaluation (local / team reward), AIF (local / system), system twin, viability, Ziran adapter (+ reachability, 2 ablations)', measured: [...ITEMS, 'closure times under two recovery definitions'], predicate: 'none predefined; per item, compared with ground truth from the true environment', wouldCountAsFailure: 'different pilot data or schedule knowledge per framework; detection asserted rather than read from the framework\'s outputs' },
  { id: 'EC4', world: 'W4-description-space-change', question: 'Which model classes capture a dependence on a distinction absent from the initial vocabulary, how fast and at what cost?', setup: 'linear regime then window-threshold regime; do(x) interventions; online cut-offs without regime boundaries', compared: 'fixed-state, parameter-adaptive, MLP (8 / 3 lags, 1000-epoch variant), v0.3.0 grammar-bounded, grammar morphogenesis, description-space transformation (+ meta-grammar ablation)', measured: ['adaptation latency', 'held-out prediction', 'intervention prediction', 'new named / unnamed distinctions', 'representation cost', 'information loss'], predicate: 'recovery ≥ 0.25 over the fixed-state model defines adaptation (fixed before running)', wouldCountAsFailure: 'regime boundaries given to some models; test rows used for selection' },
  { id: 'EC5', world: 'W5-thick-category', question: 'In paired worlds where a category is relevant (A) or redundant (B), how does each framework handle it?', setup: 'eight Poisson streams, two accounts; separate vs pooled budgets; two account-level cuts', compared: 'ABM (fixed / structure selected), aggregate model, twin (with / without account variable), AIF model comparison, Ziran adapter (+ ablation)', measured: ['prediction MAE per world', 'category used per world'], predicate: 'none predefined', wouldCountAsFailure: 'the category label available to some frameworks only; the worlds differing in anything but the budget structure' },
  { id: 'EC6', world: 'ablations', question: 'Which Ziran / Xeno mechanisms produce non-redundant differences in these worlds?', setup: 'each ablation is compared with the full adapter in the world where the mechanism acts', compared: 'no observation revision (W1), no multiple clocks (W2), no fragility transfer analysis and fixed operational values (W3), no MetaConfiguration and no description-space revision (W4), fixed operational values (W5)', measured: ['the world\'s own measurements'], predicate: 'a mechanism is reported as producing a difference only if the ablation changes a measurement; unchanged measurements are reported as "no difference in this world"', wouldCountAsFailure: 'an ablation that also changes something other than the named mechanism' },
];

export interface Ablation { mechanism: string; world: string; full: string; ablated: string; changed: boolean; detail: string }
export interface ExternalComparison { definitions: ECDefinition[]; worlds: WorldResult[]; ablations: Ablation[]; negativeResults: string[]; claimStatus: 'synthetic-world result' }

const num = (x: unknown) => (typeof x === 'number' ? x : NaN);

function ablations(W: Record<string, WorldResult>): Ablation[] {
  const get = (w: string, p: string) => W[w].records.find((r) => r.configuration.includes(p))!;
  const cmp = (mechanism: string, w: string, fullP: string, abP: string, keys: string[]): Ablation => {
    const f = get(w, fullP), a = get(w, abP);
    const diffs = keys.filter((k) => JSON.stringify(f.measurements[k]) !== JSON.stringify(a.measurements[k]));
    return { mechanism, world: w, full: f.configuration, ablated: a.configuration, changed: diffs.length > 0, detail: keys.map((k) => `${k}: ${JSON.stringify(f.measurements[k])} → ${JSON.stringify(a.measurements[k])}`).join('; ') };
  };
  return [
    cmp('observation revision', 'W1-observation-aliasing', 'Ziran / Xeno adapter', 'no observation revision', ['interventionSuccess', 'resourceCost', 'behaviouralLatencyMean', 'newObservability']),
    cmp('multiple clocks', 'W2-too-late-correction', 'Ziran / Xeno adapter', 'no multiple clocks', ['correctButTooLate', 'meanAbsTrackingError', 'realizedEffect_effectiveFraction']),
    cmp('fragility transfer analysis', 'W3-fragility-transfer', 'Ziran / Xeno adapter (v0.3.0', 'no fragility transfer analysis', ITEMS.map((i) => `detects: ${i}`)),
    cmp('open operational values (per-unit channels)', 'W3-fragility-transfer', 'Ziran / Xeno adapter (v0.3.0', 'fixed operational values', ITEMS.map((i) => `detects: ${i}`)),
    cmp('MetaConfiguration (meta-grammar)', 'W4-description-space-change', 'description-space transformation', 'no MetaConfiguration', ['adaptationLatencyRounds', 'prediction_regime2_finalNMSE', 'newDistinctions_named']),
    cmp('description-space revision', 'W4-description-space-change', 'description-space transformation', 'grammar-bounded', ['adaptationLatencyRounds', 'prediction_regime2_finalNMSE', 'newDistinctions_named']),
    cmp('open operational values (per-stream values)', 'W5-thick-category', 'Ziran / Xeno adapter', 'fixed operational values', ['worldA_predictionMAE', 'worldB_predictionMAE', 'worldA_usesCategory']),
  ];
}

/** Negative / null results derived from the records (§27): baselines that match or exceed the Ziran adapter on a named measurement. */
function negatives(W: Record<string, WorldResult>, A: Ablation[]): string[] {
  const out: string[] = [];
  const z = (w: string) => W[w].records.find((r) => r.framework === 'ziran-xeno' && r.role === 'primary')!;
  const others = (w: string) => W[w].records.filter((r) => r.framework !== 'ziran-xeno' && r.role !== 'budget-sensitivity');
  const compare = (w: string, key: string, better: 'higher' | 'lower', tol: number, unit = '') => {
    const zr = z(w); const zv = num(zr.measurements[key]);
    for (const r of others(w)) { const v = num(r.measurements[key]); if (!Number.isFinite(v) || !Number.isFinite(zv)) continue; const d = better === 'higher' ? v - zv : zv - v;
      if (d > tol) out.push(`${w}: ${r.framework} (${r.configuration}) outperforms the Ziran adapter on ${key}: ${v}${unit} vs ${zv}${unit}`);
      else if (Math.abs(d) <= tol) out.push(`${w}: ${r.framework} (${r.configuration}) matches the Ziran adapter on ${key}: ${v}${unit} vs ${zv}${unit}`); }
  };
  compare('W1-observation-aliasing', 'interventionSuccess', 'higher', 0.005);
  compare('W2-too-late-correction', 'meanAbsTrackingError', 'lower', 0.005);
  compare('W4-description-space-change', 'prediction_regime2_finalNMSE', 'lower', 0.005);
  compare('W5-thick-category', 'worldA_predictionMAE', 'lower', 0.005);
  compare('W5-thick-category', 'worldB_predictionMAE', 'lower', 0.005);
  const z3 = z('W3-fragility-transfer');
  for (const r of others('W3-fragility-transfer')) for (const i of ITEMS) if (r.measurements[`detects: ${i}`] === true && z3.measurements[`detects: ${i}`] !== true) out.push(`W3-fragility-transfer: ${r.framework} (${r.configuration}) registers "${i}", which the Ziran adapter (primary) does not`);
  const w4 = W['W4-description-space-change'];
  if (w4.records.filter((r) => r.framework === 'ziran-xeno').every((r) => (r.measurements.adaptationLatencyRounds as (number | string)[]).every((x) => x === 'never'))) out.push('W4-description-space-change: no v0.3.0 grammar variant (bounded, morphogenesis, description-space transformation) captured the window-threshold dependence within 6 rounds; the world-parameter diagnostic attributes this to grammar coverage (window + threshold composition), not a demonstrated theoretical limitation');
  const w2z = z('W2-too-late-correction'), w2a = W['W2-too-late-correction'].records.find((r) => r.configuration.startsWith('asynchronous MPC'))!;
  if (w2z.measurements.meanAbsTrackingError === w2a.measurements.meanAbsTrackingError) out.push('W2-too-late-correction: the Ziran adapter\'s decisions are identical to asynchronous MPC; its self-classification adds a record, not a different operational effect');
  const w1o = W['W1-observation-aliasing'].records.find((r) => r.configuration.includes('selection override'))!, w1z = z('W1-observation-aliasing');
  out.push(`W1-observation-aliasing: sensor installation (override) costs ${w1o.measurements.resourceCost} energy vs ${w1z.measurements.resourceCost} for the constructed channel, for intervention success ${w1o.measurements.interventionSuccess} vs ${w1z.measurements.interventionSuccess}`);
  for (const a of A) if (!a.changed) out.push(`${a.world}: removing ${a.mechanism} changed none of the measured quantities (${a.detail})`);
  const w5 = z('W5-thick-category'); if (w5.measurements.worldB_judgement_seed1) out.push(`W5-thick-category: in World B the recovered provisional bundles split on counting noise (see record notes); the label test still judged the category redundant`);
  out.push('W3-fragility-transfer (implementation finding, v0.3.0): replayed missing samples do not lower fragilityTransfer\'s observability measure, and each replayed sample counts as a distinct writer (spurious new-dependency); observation loss is detected only through the description-space diff');
  out.push('W3-fragility-transfer (implementation finding, v0.3.0): fragilityTransfer measures variance over effect values without duration weighting and has no transfer kind for a sustained reduction of another region\'s share; B\'s displacement is registered in only some seeds');
  return out;
}

export function runExternalComparison(): ExternalComparison {
  const worlds = [runWorld1(), runWorld2(), runWorld3(), runWorld4(), runWorld5()];
  const W = Object.fromEntries(worlds.map((w) => [w.world, w]));
  const A = ablations(W);
  return { definitions: EC_DEFINITIONS, worlds, ablations: A, negativeResults: negatives(W, A), claimStatus: 'synthetic-world result' };
}

/** Fields that must never appear in a comparison record or result (no global score, rank or winner). */
export const FORBIDDEN_FIELDS = ['score', 'rank', 'winner', 'best', 'bestFramework', 'overall', 'total'];
export function forbiddenFieldsIn(x: unknown, path = ''): string[] {
  if (!x || typeof x !== 'object') return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) { if (FORBIDDEN_FIELDS.includes(k)) out.push(`${path}.${k}`); out.push(...forbiddenFieldsIn(v, `${path}.${k}`)); }
  return out;
}
export type { ComparisonRecord };
