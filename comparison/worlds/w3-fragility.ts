// World 3 — Fragility transfer.
//
// Units A, B, C draw from a shared reservoir R (capacity 100, inflow 3/step, noise). B's local rule curtails its draw
// when R ≤ 20; C has a published scheduled demand increase (need 3.0 during [200, 230)). The matched intervention is
// one local optimization of A, identical for every framework: A raises its draw from 1.0 to 1.8 and the shared flow
// meter is moved from C's line to A's line. Every framework receives the same two pilot logs (t < 100, baseline and
// candidate, each observed through its own apparatus) and the published schedule, and reports what its own
// representation registers. Detection is read from each framework's outputs; ground truth comes from running the
// true environment to t = 300.
import { rng, gauss, type RngState, mean, round } from '../frameworks/lib.ts';
import { baseRecord, statement, distinctionRow, type ComparisonRecord, type WorldResult, type FairnessCheck, type MatchedConditions } from '../core/schema.ts';
import { replaySpec, type ExternalObservationSet } from '../../src/external/adapter.ts';
import { runSpec } from '../../src/core/counterfactual.ts';
import { fragilityTransfer, type Region } from '../../src/analysis/fragility.ts';
import { diffSpace } from '../../src/core/description.ts';

export const W3 = { cap: 100, R0: 80, inflow: 3, noise: 0.3, horizon: 300, pilot: 100, spike: [200, 230] as [number, number], spikeNeed: 3.0, bThresh: 20, bLow: 0.3, base: 1.0, candidate: 1.8 };
export const W3_SEEDS = [1, 2, 3];
export const ITEMS = ['local improvement', 'transferred dependency', 'delayed failure', 'resource displacement', 'observation loss', 'new closure'] as const;
type Item = (typeof ITEMS)[number];

export interface W3Params { inflow: number; bThresh: number; bLow: number; bHigh: number; cDraw: number }
export const TRUE_PARAMS: W3Params = { inflow: W3.inflow, bThresh: W3.bThresh, bLow: W3.bLow, bHigh: 1.0, cDraw: 1.0 };

export interface W3Row { t: number; R: number; A: number; B: number; C: number; Cneed: number; Cshort: number }

/** Deterministic given params and a noise stream (null = noise-free model forecast). */
export function simulate(p: W3Params, aPolicy: (t: number, R: number) => number, from: { t: number; R: number } = { t: 0, R: W3.R0 }, until = W3.horizon, r: RngState | null = null): W3Row[] {
  const rows: W3Row[] = []; let R = from.R;
  for (let t = from.t; t < until; t++) {
    const need = { A: aPolicy(t, R), B: R > p.bThresh ? p.bHigh : p.bLow, C: t >= W3.spike[0] && t < W3.spike[1] ? W3.spikeNeed : p.cDraw };
    const avail = Math.max(0, R + p.inflow + (r ? gauss(r) * W3.noise : 0)); const tot = need.A + need.B + need.C; const f = tot > avail ? avail / tot : 1;
    const got = { A: need.A * f, B: need.B * f, C: need.C * f };
    R = Math.min(W3.cap, avail - got.A - got.B - got.C);
    rows.push({ t, R, A: got.A, B: got.B, C: got.C, Cneed: need.C, Cshort: need.C - got.C });
  }
  return rows;
}
const basePolicy = () => W3.base, candPolicy = () => W3.candidate;

/** What a framework is given: two pilot logs observed through each scenario's apparatus, plus the published schedule. */
export interface Pilot { base: Partial<W3Row>[]; cand: Partial<W3Row>[]; schedule: string }
export function pilots(seed: number): Pilot {
  const b = simulate(TRUE_PARAMS, basePolicy, undefined, W3.pilot, rng(seed, 1)), c = simulate(TRUE_PARAMS, candPolicy, undefined, W3.pilot, rng(seed, 1));
  return { base: b, cand: c.map(({ C: _c, Cshort: _s, Cneed: _n, ...rest }) => rest), schedule: `C needs ${W3.spikeNeed} during [${W3.spike[0]}, ${W3.spike[1]})` };
}

/** System identification from the pilots (shared by every model-based framework). */
export function identify(P: Pilot): { params: W3Params; identified: string[]; unidentified: string[] } {
  const inflows = P.base.slice(1).map((r, i) => r.R! - P.base[i].R! + r.A! + r.B! + r.C!);
  const lowB = P.cand.filter((r) => r.B! < 0.9); const highB = P.cand.filter((r) => r.B! >= 0.9);
  const identified = ['inflow', 'C baseline draw'], unidentified: string[] = [];
  let bThresh = Infinity, bLow = 1.0;
  if (lowB.length && highB.length) { bThresh = (Math.max(...lowB.map((r) => r.R!)) + Math.min(...highB.map((r) => r.R!))) / 2; bLow = mean(lowB.map((r) => r.B!)); identified.push('B curtailment rule'); } else unidentified.push('B curtailment rule');
  return { params: { inflow: mean(inflows), bThresh, bLow, bHigh: mean(P.base.map((r) => r.B!)), cDraw: mean(P.base.map((r) => r.C!)) }, identified, unidentified };
}

export interface Truth { items: Record<Item, boolean>; closureRevertToBaseline: number | null; closureAnyPolicy: number | null; details: Record<string, number> }
/** Latest t from which *some* A policy in [0, candidate] (reverting to a) avoids any C shortfall, given the candidate until t. */
function closureTime(p: W3Params, revertTo: number, r: () => RngState | null): number | null {
  let last: number | null = null;
  for (let t = 0; t <= W3.spike[0]; t += 2) { const rows = simulate(p, (s) => (s < t ? W3.candidate : revertTo), undefined, W3.horizon, r()); if (rows.every((x) => x.Cshort < 1e-6)) last = t; }
  return last;
}
export function truth(seed: number): Truth {
  const b = simulate(TRUE_PARAMS, basePolicy, undefined, W3.horizon, rng(seed, 1)), c = simulate(TRUE_PARAMS, candPolicy, undefined, W3.horizon, rng(seed, 1));
  const sum = (rows: W3Row[], k: keyof W3Row, lo = 0, hi = W3.horizon) => rows.filter((x) => x.t >= lo && x.t < hi).reduce((s, x) => s + (x[k] as number), 0);
  const tb = closureTime(TRUE_PARAMS, W3.base, () => rng(seed, 1)), ta = closureTime(TRUE_PARAMS, 0, () => rng(seed, 1));
  // "new closure" (truth): the revert-to-baseline recovery branch closes before the scheduled window. The any-policy
  // branch is reported separately; which one counts as "recovery" is a modelling choice, stated rather than hidden.
  const shortC = sum(c, 'Cshort'), shortB = sum(b, 'Cshort');
  return { items: { 'local improvement': sum(c, 'A') > sum(b, 'A'), 'transferred dependency': shortC > shortB + 1e-6, 'delayed failure': shortC > shortB + 1e-6 && sum(c, 'Cshort', 0, W3.spike[0]) < 1e-6, 'resource displacement': sum(c, 'B') < sum(b, 'B') - 1e-6, 'observation loss': true, 'new closure': tb === null || tb < W3.spike[0] },
    closureRevertToBaseline: tb, closureAnyPolicy: ta, details: { A_gain: round(sum(c, 'A') - sum(b, 'A'), 2), B_loss: round(sum(b, 'B') - sum(c, 'B'), 2), C_shortfall_candidate: round(shortC, 2), C_shortfall_base: round(shortB, 2) } };
}

/** Closure of the recovery branch under two policy sets: revert A to its baseline draw, or any admissible A (down to 0). */
export function closureTimes(p: W3Params, from: { t: number; R: number } = { t: 0, R: W3.R0 }): { revertToBaseline: number | null; anyPolicy: number | null; evaluations: number } {
  let evaluations = 0; const last = (revert: number) => { let l: number | null = null; for (let t = from.t; t <= W3.spike[0]; t += 2) { evaluations++; if (simulate(p, (s2) => (s2 < t ? W3.candidate : revert), from).every((x) => x.Cshort < 1e-6)) l = t; } return l; };
  return { revertToBaseline: last(W3.base), anyPolicy: last(0), evaluations };
}
const closed = (c: { revertToBaseline: number | null; anyPolicy: number | null }, from = 0) => (c.revertToBaseline === null || c.revertToBaseline < W3.spike[0]) || (c.anyPolicy === null || c.anyPolicy < W3.spike[0]) ? from >= 0 : false;
const closureText = (c: { revertToBaseline: number | null; anyPolicy: number | null }) => `revert-to-baseline recovery lost after t=${c.revertToBaseline ?? 'start'}; any-policy recovery lost after t=${c.anyPolicy ?? 'start'}`;

// ------------------------------------------------------------------ framework reports
interface Report { items: Record<Item, boolean>; evidence: Partial<Record<Item, string>>; outputs: string[]; notRepresented: string[]; evaluations: number; closure?: { revertToBaseline: number | null; anyPolicy: number | null } }
const none = (): Record<Item, boolean> => Object.fromEntries(ITEMS.map((i) => [i, false])) as Record<Item, boolean>;
const fcast = (p: W3Params, pol: (t: number, R: number) => number) => simulate(p, pol);
const tot = (rows: W3Row[], k: keyof W3Row, lo = 0, hi = W3.horizon) => rows.filter((x) => x.t >= lo && x.t < hi).reduce((s, x) => s + (x[k] as number), 0);

/** ABM: agents A, B, C with identified rules; environment R; interaction via the shared reservoir; synchronous update. */
function abm(P: Pilot, sweep: boolean): Report {
  const { params } = identify(P); const b = fcast(params, basePolicy), c = fcast(params, candPolicy); const it = none(), ev: Report['evidence'] = {};
  if (tot(c, 'A') > tot(b, 'A')) { it['local improvement'] = true; ev['local improvement'] = `A output +${round(tot(c, 'A') - tot(b, 'A'), 1)}`; }
  if (tot(c, 'B') < tot(b, 'B') - 1e-6) { it['resource displacement'] = true; ev['resource displacement'] = `B draw −${round(tot(b, 'B') - tot(c, 'B'), 1)}`; }
  if (tot(c, 'Cshort') > tot(b, 'Cshort') + 1e-6) { it['transferred dependency'] = true; ev['transferred dependency'] = 'C outcome differs between runs that differ only in A\'s rule'; if (tot(c, 'Cshort', 0, W3.spike[0]) < 1e-6) { it['delayed failure'] = true; ev['delayed failure'] = `C shortfall ${round(tot(c, 'Cshort'), 1)} only from t=${c.find((x) => x.Cshort > 0)?.t}`; } }
  let evaluations = 2, cl: Report['closure'];
  if (sweep) { const c2 = closureTimes(params); evaluations += c2.evaluations; cl = c2; if (closed(c2)) { it['new closure'] = true; ev['new closure'] = `intervention sweep: ${closureText(c2)}`; } }
  return { items: it, evidence: ev, outputs: ['per-agent time series', 'scenario comparison'], notRepresented: ['observation apparatus (ABM simulates true states)', ...(sweep ? [] : ['reachability of recovery'])], evaluations, closure: cl };
}

/** Local MPC for A: model R′ = R + net exogenous flow − A, constraint R ≥ 5, horizon 20, others lumped into a disturbance. */
function localMPC(P: Pilot): Report {
  const net = mean(P.base.slice(1).map((r, i) => r.R! - P.base[i].R! + r.A!)); const it = none(), ev: Report['evidence'] = {};
  const R100 = P.cand.at(-1)!.R!; const H = 20; let feasible = true; let R = R100; for (let k = 0; k < H; k++) { R += net - W3.candidate; if (R < 5) feasible = false; }
  it['local improvement'] = true; ev['local improvement'] = `A objective +${W3.candidate - W3.base}/step`;
  return { items: it, evidence: ev, outputs: [`predicted R over ${H} steps (min ${round(R, 1)})`, `own constraint R ≥ 5 ${feasible ? 'satisfied' : 'violated'} within horizon`], notRepresented: ['units B and C (lumped into a constant disturbance)', 'events beyond the horizon', 'observation apparatus'], evaluations: H };
}

/** Centralized MPC (fairness): full identified model, horizon to the end of the schedule, soft constraint on C shortfall. */
function centralMPC(P: Pilot): Report {
  const { params } = identify(P); const it = none(), ev: Report['evidence'] = {};
  const c = fcast(params, candPolicy), b = fcast(params, basePolicy);
  if (tot(c, 'A') > tot(b, 'A')) { it['local improvement'] = true; ev['local improvement'] = 'A term of the objective increases'; }
  if (tot(c, 'B') < tot(b, 'B') - 1e-6) { it['resource displacement'] = true; ev['resource displacement'] = 'B draw lower in the predicted trajectory'; }
  if (tot(c, 'Cshort') > tot(b, 'Cshort') + 1e-6) { it['transferred dependency'] = true; ev['transferred dependency'] = 'C shortfall constraint becomes active under A\'s change'; if (tot(c, 'Cshort', 0, W3.spike[0]) < 1e-6) { it['delayed failure'] = true; ev['delayed failure'] = 'constraint violation predicted only inside the scheduled window'; } }
  // feasibility of the C-shortfall constraint from the state after the pilot (A ∈ [0, candidate] thereafter)
  const R100 = P.cand.at(-1)!.R!; const bestShort = Math.min(...[0, 0.5, 1.0].map((a) => tot(simulate(params, () => a, { t: W3.pilot, R: R100 }), 'Cshort')));
  const c2 = closureTimes(params, { t: W3.pilot, R: R100 }); const evaluations = 3 + c2.evaluations;
  if (closed(c2)) { it['new closure'] = true; ev['new closure'] = `feasibility analysis from t=${W3.pilot}: ${closureText(c2)}`; }
  return { items: it, evidence: ev, outputs: ['full-horizon predicted trajectory', `best achievable C shortfall from t=100: ${round(bestShort, 2)}`, 'feasibility over switch times'], notRepresented: ['observation apparatus (state assumed available)'], evaluations, closure: c2 };
}

/** RL policy evaluation (Monte Carlo) of the two fixed policies under the supplied reward, in training episodes. */
function rlEval(team: boolean): Report {
  const it = none(), ev: Report['evidence'] = {};
  const ret = (pol: () => number) => mean([11, 12, 13, 14, 15].map((s) => simulate(TRUE_PARAMS, pol, undefined, W3.horizon, rng(900 + s, 1)).reduce((acc, x) => acc + (team ? x.A + x.B + x.C - 10 * x.Cshort : x.A), 0)));
  const rb = ret(basePolicy), rc = ret(candPolicy);
  if (!team && rc > rb) { it['local improvement'] = true; ev['local improvement'] = `return ${round(rb, 1)} → ${round(rc, 1)}`; }
  return { items: it, evidence: ev, outputs: [`${team ? 'team' : 'local'} return: base ${round(rb, 1)}, candidate ${round(rc, 1)}`], notRepresented: team ? ['which unit or event caused the return change (merged into one scalar)'] : ['B, C, R (outside the reward)'], evaluations: 10 };
}

/**
 * Active inference: EFE of each scenario under a generative model with preferences. Local variant: A output and
 * R ≥ 5 over 20 steps. System variant (fairness): preferences over all units incl. C's need, full horizon, and an
 * explicit observation model in which removing a meter raises ambiguity about that line.
 */
function aif(P: Pilot, system: boolean): Report {
  const { params } = identify(P); const it = none(), ev: Report['evidence'] = {};
  const H = system ? W3.horizon : W3.pilot + 20; const lnPref = (x: W3Row) => (system ? x.A + x.B + x.C - 10 * x.Cshort : x.A) - (x.R < 5 ? 10 : 0);
  const c = simulate(params, candPolicy, undefined, H), b = simulate(params, basePolicy, undefined, H);
  const amb = (unobservedLines: number) => (system ? unobservedLines * (H - W3.pilot) * 0.5 * Math.log(2 * Math.PI * Math.E * 0.3 ** 2 + 1) : 0);
  const Gc = -c.reduce((s, x) => s + lnPref(x), 0) + amb(1), Gb = -b.reduce((s, x) => s + lnPref(x), 0) + amb(0);
  if (tot(c, 'A') > tot(b, 'A')) { it['local improvement'] = true; ev['local improvement'] = 'pragmatic value of A output'; }
  if (system) {
    if (tot(c, 'B') < tot(b, 'B') - 1e-6) { it['resource displacement'] = true; ev['resource displacement'] = 'predicted B outcome lower'; }
    if (tot(c, 'Cshort') > tot(b, 'Cshort') + 1e-6) { it['transferred dependency'] = true; ev['transferred dependency'] = 'predicted C outcomes violate preferences only under the candidate'; if (tot(c, 'Cshort', 0, W3.spike[0]) < 1e-6) { it['delayed failure'] = true; ev['delayed failure'] = 'preference violation inside the scheduled window'; } }
    it['observation loss'] = true; ev['observation loss'] = 'ambiguity term increases: C line no longer an outcome modality';
  }
  return { items: it, evidence: ev, outputs: [`G(base) = ${round(Gb, 1)}, G(candidate) = ${round(Gc, 1)} → prefers ${Gc < Gb ? 'candidate' : 'base'}`], notRepresented: system ? ['reachability of recovery'] : ['B, C', 'events beyond 20 steps after the pilot'], evaluations: 2 };
}

/** Digital twin of the whole system: synchronized from the sensor feed during the pilots, forecasting with the identified model. */
function twin(P: Pilot): Report {
  const { params } = identify(P); const it = none(), ev: Report['evidence'] = {};
  const gaps = ['A', 'B', 'C', 'R'].filter((k) => P.base.some((r) => (r as Record<string, unknown>)[k] !== undefined) && P.cand.every((r) => (r as Record<string, unknown>)[k] === undefined));
  if (gaps.length) { it['observation loss'] = true; ev['observation loss'] = `synchronization lost for line(s) ${gaps.join(', ')} under the candidate`; }
  const b = fcast(params, basePolicy), c = fcast(params, candPolicy);
  if (tot(c, 'A') > tot(b, 'A')) { it['local improvement'] = true; ev['local improvement'] = 'twin forecast'; }
  if (tot(c, 'B') < tot(b, 'B') - 1e-6) { it['resource displacement'] = true; ev['resource displacement'] = 'twin forecast of B'; }
  if (tot(c, 'Cshort') > tot(b, 'Cshort') + 1e-6) { it['transferred dependency'] = true; ev['transferred dependency'] = 'twin forecast of C (last synchronized value carried forward)'; if (tot(c, 'Cshort', 0, W3.spike[0]) < 1e-6) { it['delayed failure'] = true; ev['delayed failure'] = 'forecast shortfall in the scheduled window'; } }
  return { items: it, evidence: ev, outputs: ['synchronized state', 'forecast to t=300', 'sync-gap log'], notRepresented: ['reachability of recovery'], evaluations: 2 };
}

/** Viability kernel in (t, R) for "no C shortfall", A ∈ {0, …, candidate} as control, B's rule and C's schedule as dynamics. */
function viability(P: Pilot): Report {
  const { params } = identify(P); const it = none(), ev: Report['evidence'] = {};
  const c = fcast(params, candPolicy); let evaluations = 0;
  // kernel membership of the candidate trajectory under two control sets: {baseline draw} and [0, candidate]
  const exitFor = (u: number) => { for (const row of c) { if (row.t > W3.spike[0]) break; if (row.t % 2) continue; evaluations++; if (!simulate(params, () => u, { t: row.t + 1, R: row.R }).every((x) => x.Cshort < 1e-6)) return row.t; } return null; };
  const eB = exitFor(W3.base), eA = exitFor(0);
  const cl = { revertToBaseline: eB === null ? W3.spike[0] : eB - 2, anyPolicy: eA === null ? W3.spike[0] : eA - 2 };
  if (eB !== null || eA !== null) { it['new closure'] = true; ev['new closure'] = `candidate trajectory leaves the kernel for control set {1.0} at t≈${eB ?? 'never'} and for [0, 1.8] at t≈${eA ?? 'never'}`; }
  if (eA !== null || eB !== null) { it['transferred dependency'] = true; ev['transferred dependency'] = 'kernel membership depends on A\'s control'; }
  if (eA !== null) { it['delayed failure'] = true; ev['delayed failure'] = 'outside the [0, 1.8] kernel every admissible A policy leads to C shortfall in the scheduled window'; }
  return { items: it, evidence: ev, outputs: ['viability kernels over (t, R) for two control sets', `exit times ${eB ?? 'none'} / ${eA ?? 'none'}`], notRepresented: ['objectives (no local improvement notion)', 'B\'s outcome as a separate quantity', 'observation apparatus'], evaluations, closure: cl };
}

/**
 * Ziran / Xeno adapter: forecasts both scenarios with the identified model, exports them as observation sets — observed
 * channels per scenario apparatus plus model-predicted channels marked `pred_` — replays them through the v0.3.0
 * external adapter, and runs v0.3.0 `fragilityTransfer` (regions A, B, C, R) and a Level-C description-space diff
 * of the two apparatus configurations. Known replay artefact: every replayed sample carries its own intervention id,
 * so fragilityTransfer's `new-dependency` counts sample writers; those entries are discarded and recorded.
 */
function ziran(P: Pilot, o: { fragility?: boolean; scalarValues?: boolean; reachability?: boolean } = {}): Report & { raw: unknown } {
  const { params } = identify(P); const it = none(), ev: Report['evidence'] = {};
  const b = fcast(params, basePolicy), c = fcast(params, candPolicy);
  const meta = { source: 'W3 forecast', domain: 'synthetic', samplingRegime: 'every step', missingness: 'lines without a meter are absent', apparatus: 'flow meters', timebase: 'step', uncertainty: 'model forecast', provenance: 'identified from pilot logs', evidence: 'synthetic' as const };
  const toSet = (rows: W3Row[], observed: string[]): ExternalObservationSet => {
    const ch = (id: string, f: (r: W3Row) => number) => ({ id, samples: rows.map((r) => [r.t, f(r)] as [number, number]) });
    if (o.scalarValues) return { ...meta, channels: [ch('pred_R', (r) => r.R), ch('pred_total', (r) => r.A + r.B + r.C - r.Cshort)] };
    return { ...meta, channels: [ch('pred_A_draw', (r) => r.A), ch('pred_B_draw', (r) => r.B), ch('pred_C_short', (r) => r.Cshort), ch('pred_R', (r) => r.R), ...observed.map((k) => ch(`obs_${k}`, (r) => (r as unknown as Record<string, number>)[k]))] };
  };
  const tb = runSpec(replaySpec(toSet(b, ['A', 'B', 'C', 'R']))), tc = runSpec(replaySpec(toSet(c, ['A', 'B', 'R'])));
  const regions: Region[] = o.scalarValues
    ? [{ id: 'R', prefixes: ['ext/pred_R'], limits: [{ address: 'ext/pred_R', limit: 0, dir: 'below' }] }, { id: 'all-units', prefixes: ['ext/pred_total'] }]
    : [{ id: 'A', prefixes: ['ext/pred_A'] }, { id: 'B', prefixes: ['ext/pred_B'] }, { id: 'C', prefixes: ['ext/pred_C'], limits: [{ address: 'ext/pred_C_short', limit: 0, dir: 'above' }] }, { id: 'R', prefixes: ['ext/pred_R'], limits: [{ address: 'ext/pred_R', limit: 0, dir: 'below' }] }];
  // Consequences are read from model-predicted channels only (identical channel sets in both scenarios); observed
  // channels enter only the description-space diff. Mixing them lets the lost C meter hide C's risk — a real
  // effect, but one that must be reported as observation loss, not as absence of transferred risk.
  const target = o.scalarValues ? 'all-units' : 'A';
  const improved = () => tot(c, 'A') > tot(b, 'A');
  let rep: ReturnType<typeof fragilityTransfer> | null = null; let discarded: string[] = [];
  if (o.fragility !== false) {
    rep = fragilityTransfer(tb, tc, regions, target, improved);
    discarded = rep.transfers.filter((x) => x.kind === 'new-dependency').map((x) => `${x.region}:${x.kind} (replay artefact)`);
    const tr = rep.transfers.filter((x) => x.kind !== 'new-dependency');
    if (rep.targetImproved) { it['local improvement'] = true; ev['local improvement'] = `fragilityTransfer: target ${target} improved`; }
    const B = tr.filter((x) => x.region === 'B'), Cc = tr.filter((x) => x.region === 'C');
    if (B.some((x) => x.kind === 'risk-moved' || x.kind === 'resource-burden-moved' || x.kind === 'margin-reduced')) { it['resource displacement'] = true; ev['resource displacement'] = B.map((x) => x.kind).join(', '); }
    if (Cc.some((x) => x.kind === 'margin-reduced' || x.kind === 'risk-moved')) { it['transferred dependency'] = true; ev['transferred dependency'] = Cc.map((x) => x.kind).join(', '); }
    if (Cc.some((x) => x.kind === 'delayed-instability' || x.kind === 'failure-moved')) { it['delayed failure'] = true; ev['delayed failure'] = Cc.filter((x) => x.kind === 'delayed-instability' || x.kind === 'failure-moved').map((x) => x.kind).join(', '); }
  } else if (tot(c, 'A') > tot(b, 'A')) { it['local improvement'] = true; ev['local improvement'] = 'target region only (fragility analysis disabled)'; }
  const asSpace = (x: unknown) => Object.fromEntries(Object.entries(x as Record<string, string[]>).map(([k, v]) => [k, new Set(v)]));
  const d = diffSpace(asSpace(tb.final.space), asSpace(tc.final.space));
  const lostCh = (d.removed['channel'] ?? []).filter((x) => x.includes('obs_'));
  if (lostCh.length) { it['observation loss'] = true; ev['observation loss'] = `Level-C description-space diff: −channel ${lostCh.join(', ')}`; }
  let cl: Report['closure']; let evaluations = 2;
  if (o.reachability) { const c2 = closureTimes(params); evaluations += c2.evaluations; cl = c2; if (closed(c2)) { it['new closure'] = true; ev['new closure'] = `probe-relative reachability (probe "no C shortfall", option menu: revert time × revert level): ${closureText(c2)}`; } }
  return { items: it, evidence: ev, outputs: ['fragilityTransfer report', 'description-space diff', ...(o.reachability ? ['probe-relative reachability sweep'] : [])], notRepresented: [...(o.reachability ? [] : ['closure of the recovery branch (no probe declared)']), ...(o.scalarValues ? ['per-unit channels (collapsed to totals)'] : [])], evaluations, closure: cl, raw: rep ? { verdict: rep.verdict, fates: rep.fates, transfers: rep.transfers.map((x) => `${x.region}:${x.kind}`), discarded } : null };
}

// ------------------------------------------------------------------ assemble
interface Config { framework: ComparisonRecord['framework']; configuration: string; role: ComparisonRecord['role']; run: (P: Pilot) => Report & { raw?: unknown }; supplied: string[]; burden: ComparisonRecord['burden'] }
const MODEL = { item: 'dynamics' as const, supplied: 'model structure (reservoir, unit draw rules) with parameters identified from the pilots', enabled: 'forecasts to the scheduled event', prevented: 'nothing observed in the pilots is excluded', wrongWhen: 'B\'s rule is only identifiable because the candidate pilot drove R below 20' };
const SCHED = { item: 'schedule' as const, supplied: 'published C demand schedule (same for every framework)', enabled: 'anticipating the scheduled window', prevented: '—' };
export const W3_CONFIGS: Config[] = [
  { framework: 'agent-based-modeling', configuration: 'ABM (agents A, B, C; reservoir environment; scenario comparison)', role: 'primary', run: (P) => abm(P, false), supplied: ['agents', 'agent rules (structure)', 'interaction network (shared reservoir)', 'synchronous update schedule'], burden: [{ item: 'agents', supplied: 'A, B, C as agents with rules', enabled: 'per-unit outcomes', prevented: '—' }, MODEL, SCHED] },
  { framework: 'agent-based-modeling', configuration: 'ABM + intervention sweep (A reverts at t)', role: 'fairness', run: (P) => abm(P, true), supplied: ['as ABM', 'sweep over revert times'], burden: [MODEL, SCHED] },
  { framework: 'control-mpc', configuration: 'local MPC for A (horizon 20, others lumped)', role: 'primary', run: localMPC, supplied: ['A and R', 'constant disturbance for others', 'constraint R ≥ 5'], burden: [{ item: 'boundary', supplied: 'controller boundary = unit A + reservoir', enabled: 'decentralized control', prevented: 'representing B and C', wrongWhen: 'consequences arise outside the boundary' }] },
  { framework: 'control-mpc', configuration: 'centralized MPC (full identified model, full horizon, C-shortfall constraint)', role: 'fairness', run: centralMPC, supplied: ['full model', 'schedule', 'constraints for all units'], burden: [MODEL, SCHED] },
  { framework: 'reinforcement-learning', configuration: 'RL policy evaluation, local reward (A output)', role: 'primary', run: () => rlEval(false), supplied: ['reward = A output', 'training episodes'], burden: [{ item: 'reward', supplied: 'A output', enabled: 'evaluating A\'s change', prevented: 'anything outside the reward' }] },
  { framework: 'reinforcement-learning', configuration: 'RL policy evaluation, team reward (all outputs − 10·C shortfall)', role: 'fairness', run: () => rlEval(true), supplied: ['team reward'], burden: [{ item: 'reward', supplied: 'team reward incl. C shortfall penalty', enabled: 'a return that falls under the candidate', prevented: 'localizing why' }] },
  { framework: 'active-inference', configuration: 'AIF, local preferences (A output, R ≥ 5, 20 steps)', role: 'primary', run: (P) => aif(P, false), supplied: ['generative model (A, R)', 'local preferences'], burden: [{ item: 'preferences', supplied: 'A output, R ≥ 5', enabled: 'local evaluation', prevented: 'other units' }] },
  { framework: 'active-inference', configuration: 'AIF, system preferences + observation model (full horizon)', role: 'fairness', run: (P) => aif(P, true), supplied: ['generative model (all units)', 'system preferences', 'observation modalities per line'], burden: [MODEL, SCHED, { item: 'preferences', supplied: 'all outputs − 10·C shortfall', enabled: 'system evaluation', prevented: '—' }] },
  { framework: 'digital-twin', configuration: 'system twin (sync from meters, forecast with identified model)', role: 'primary', run: twin, supplied: ['physical ↔ digital mapping per line', 'identified model', 'sync-gap monitoring'], burden: [MODEL, SCHED] },
  { framework: 'viability-reachability', configuration: 'viability kernel over (t, R) for "no C shortfall"', role: 'primary', run: viability, supplied: ['constraint', 'identified dynamics', 'A as control in [0, 1.8]'], burden: [MODEL, SCHED, { item: 'boundary', supplied: 'constraint "no C shortfall"', enabled: 'closure time', prevented: 'objectives' }] },
  { framework: 'ziran-xeno', configuration: 'Ziran / Xeno adapter (v0.3.0 fragilityTransfer + description-space diff on replayed forecasts)', role: 'primary', run: (P) => ziran(P), supplied: ['identified model (same as ABM)', 'regions A, B, C, R with limits', 'apparatus per scenario'], burden: [MODEL, SCHED, { item: 'boundary', supplied: 'regions and limits', enabled: 'per-region transfer kinds', prevented: 'consequences in undeclared regions' }] },
  { framework: 'ziran-xeno', configuration: 'Ziran / Xeno adapter + probe-relative reachability sweep', role: 'fairness', run: (P) => ziran(P, { reachability: true }), supplied: ['as primary', 'probe "no C shortfall"', 'option menu: revert times'], burden: [MODEL, SCHED] },
  { framework: 'ziran-xeno', configuration: 'ablation: no fragility transfer analysis', role: 'ablation', run: (P) => ziran(P, { fragility: false }), supplied: ['as primary, target region only'], burden: [MODEL] },
  { framework: 'ziran-xeno', configuration: 'ablation: fixed operational values (per-unit channels collapsed to totals)', role: 'ablation', run: (P) => ziran(P, { scalarValues: true }), supplied: ['as primary, aggregate channels'], burden: [MODEL] },
];

export function runWorld3(seeds = W3_SEEDS): WorldResult {
  const T = seeds.map(truth); const records: ComparisonRecord[] = [];
  for (const c of W3_CONFIGS) {
    const t0 = performance.now(); const reps = seeds.map((s) => c.run(pilots(s))); const ms = performance.now() - t0;
    const r = baseRecord('W3-fragility-transfer', c.framework, c.configuration, c.role); r.representationSupplied = c.supplied; r.burden = c.burden;
    const det = Object.fromEntries(ITEMS.map((i) => [i, reps.filter((x) => x.items[i]).length])) as Record<Item, number>;
    for (const i of ITEMS) r.measurements[`detects: ${i}`] = det[i] === seeds.length ? true : det[i] === 0 ? false : `${det[i]}/${seeds.length} seeds`;
    for (const i of ITEMS) r.measurements[`correct: ${i}`] = reps.every((x, k) => x.items[i] === T[k].items[i]);
    r.detectedDifferences = ITEMS.filter((i) => det[i] > 0).map((i) => `${i}: ${reps[0].evidence[i] ?? '(other seeds)'}`);
    r.inaccessibleDifferences = reps[0].notRepresented;
    r.observationsSupplied = ['pilot logs t < 100 (baseline: A, B, C, R; candidate: A, B, R)', 'published schedule'];
    r.interventions = ['matched: A draw 1.0 → 1.8 and meter moved from C to A'];
    r.timing = { closureReported_revertToBaseline: reps[0].closure?.revertToBaseline ?? null, closureReported_anyPolicy: reps[0].closure?.anyPolicy ?? null, closureTrue_revertToBaseline: T[0].closureRevertToBaseline, closureTrue_anyPolicy: T[0].closureAnyPolicy, seed: seeds[0] };
    r.branchChanges = reps[0].closure ? [closureText(reps[0].closure)] : [];
    r.modelRevisions = []; r.descriptionRevisions = c.framework === 'ziran-xeno' && reps[0].items['observation loss'] ? ['−channel obs_C (Level C)'] : [];
    r.notes.push(`outputs: ${reps[0].outputs.join('; ')}`); if ((reps[0] as { raw?: unknown }).raw) r.notes.push(`v0.3.0 report (seed ${seeds[0]}): ${JSON.stringify((reps[0] as { raw?: unknown }).raw)}`);
    r.cost = { computeMs: round(ms, 1), modelEvaluations: Math.round(mean(reps.map((x) => x.evaluations))), dataSteps: 2 * W3.pilot, observationsUsed: 2 * W3.pilot, interventionCount: 1, memoryItems: null, representationComplexity: null };
    r.conversions = c.configuration.includes('collapsed') ? [{ from: 'per-unit draws', to: 'total draw', retained: ['total demand on R'], lost: ['which unit bears the shortfall', 'B\'s curtailment'], newlyAvailable: [], unresolved: [] }] : c.framework === 'ziran-xeno' ? [{ from: 'forecast rows', to: 'v0.3.0 replayed trace', retained: ['per-channel values'], lost: ['distinct writers (each sample is its own intervention)'], newlyAvailable: ['description-space facets of the apparatus'], unresolved: ['new-dependency kind (artefact, discarded)'] }] : [];
    r.profile.preserves = ITEMS.filter((i) => det[i] === seeds.length);
    r.profile.inaccessible = reps[0].notRepresented;
    records.push(r);
  }
  const statements = records.flatMap((r) => ITEMS.map((i) => statement(r.configuration, r.framework, i, r.measurements[`detects: ${i}`] === true ? true : r.measurements[`detects: ${i}`] === false ? false : null)));
  const find = (p: string) => records.find((r) => r.configuration.includes(p))!;
  const fairness: FairnessCheck[] = [
    { distinction: 'new closure', firstConfiguration: find('ABM (agents').configuration, alternativeConfiguration: find('ABM + intervention sweep').configuration, alternativeTested: true, retainedUnderAlternative: find('ABM + intervention sweep').measurements['detects: new closure'] === true, note: 'ABM needs an explicit intervention sweep; a standard ABM study design' },
    { distinction: 'transferred dependency / delayed failure', firstConfiguration: find('local MPC').configuration, alternativeConfiguration: find('centralized MPC').configuration, alternativeTested: true, retainedUnderAlternative: find('centralized MPC').measurements['detects: delayed failure'] === true, note: 'local MPC is decentralized by design; the centralized formulation represents all units' },
    { distinction: 'observation loss', firstConfiguration: find('local preferences').configuration, alternativeConfiguration: find('system preferences').configuration, alternativeTested: true, retainedUnderAlternative: find('system preferences').measurements['detects: observation loss'] === true, note: 'AIF represents observation modalities explicitly once the model includes them' },
    { distinction: 'new closure', firstConfiguration: find('Ziran / Xeno adapter (v0.3.0').configuration, alternativeConfiguration: find('reachability sweep').configuration, alternativeTested: true, retainedUnderAlternative: find('reachability sweep').measurements['detects: new closure'] === true, note: 'v0.3.0 fragilityTransfer does not compute closure; a declared probe and option menu are needed' },
    { distinction: 'observation loss', firstConfiguration: find('local MPC').configuration, alternativeConfiguration: 'MPC with an explicit measurement model and estimator', alternativeTested: false, retainedUnderAlternative: null, note: 'Not run. With a measurement model, loss of the C meter would appear as reduced observability of C; this is standard and should not be counted as a limitation of control theory.' },
  ];
  const distinctionTable = ITEMS.map((i) => distinctionRow(i, records, (r) => (r.measurements[`detects: ${i}`] === true ? true : r.measurements[`detects: ${i}`] === false ? false : null)));
  const matched: MatchedConditions = { world: 'W3-fragility-transfer', inputData: 'the same two pilot logs (t < 100) per seed and the same published schedule for every framework; RL evaluates in 5 training episodes from disjoint seeds', initialConditions: 'R₀ = 80', interventionHistory: 'one matched intervention (A draw 1.0 → 1.8, meter moved C → A)', temporalHorizon: 'forecast/evaluation to t = 300', computationalBudget: 'not equalized; recorded', observationAvailability: 'baseline apparatus A, B, C, R; candidate apparatus A, B, R', measurementResolution: 'exact meter values', resourceConstraints: 'reservoir dynamics', evaluationWindow: 'ground truth over [0, 300)', sameness: [{ framework: 'all model-based', sameRawSource: true, samePreprocessing: true, sameObservation: true, sameStateRepresentation: false, sameIntervention: true, sameOperationalEffect: true, transformation: 'ABM, centralized MPC, system AIF, twin, viability and the Ziran adapter use one shared identified model; local MPC and local AIF use a reduced model by design' }, { framework: 'ziran-xeno', sameRawSource: true, samePreprocessing: false, sameObservation: true, sameStateRepresentation: false, sameIntervention: true, sameOperationalEffect: true, transformation: 'forecast rows exported as observation sets and replayed through the v0.3.0 external adapter; model-predicted channels marked pred_' }] };
  return { world: 'W3-fragility-transfer', question: 'A local optimization improves A. Which frameworks register the transferred dependency, delayed failure, resource displacement, observation loss and new closure it produces elsewhere?', design: 'shared reservoir, B curtails below R = 20, scheduled C demand in [200, 230); matched candidate: A draw 1.8 and meter moved from C to A', matched, records, fairness, statements, distinctionTable, notApplicable: [{ framework: 'dynamical-systems', reason: 'the shared identified model is itself the dynamical-systems formulation; its consequences are reported through the frameworks that use it' }], references: { ...Object.fromEntries(Object.entries(T[0].details).map(([k, v]) => [`truth seed1 ${k}`, v])), truthItems: ITEMS.filter((i) => T.every((x) => x.items[i])).join(', '), closureAnyPolicy: String(T.map((x) => x.closureAnyPolicy)), closureRevertToBaseline: String(T.map((x) => x.closureRevertToBaseline)) }, claimStatus: 'synthetic-world result' };
}
