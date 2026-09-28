// Cascaded Tanks — implementation of the frozen protocol CT-P1 (results/external-comparison/cascaded-tanks/protocol.json).
// Models are implemented as pre-registered; any later change must be recorded as an exploratory follow-up.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mean, wls, predictLin, nelderMead, rng, next, MLP } from '../frameworks/lib.ts';
import { replaySpec } from '../../src/external/adapter.ts';
import { runSpec } from '../../src/core/counterfactual.ts';
import { observationSeries } from '../../src/analysis/samples.ts';
import { grammarMorphogenesis, MUTATION_REGISTRY } from '../../src/analysis/grammar-morphogenesis.ts';

export const CSV = fileURLToPath(new URL('../../data/external/cascaded-tanks/derived/extracted/CascadedTanksFiles/dataBenchmark.csv', import.meta.url));
export const CSV_SHA256 = 'ef2388ed822f3aef4aa80d6b0f2b466dd80b361786b3eafc7a2957c31ea323a7';
export const N = 1024, FIT = 768;

export interface Data { uEst: number[]; yEst: number[]; uTest: number[]; yTest: number[] }
export function load(): Data {
  if (!existsSync(CSV)) throw new Error('dataset not found: run node comparison/empirical/fetch-cascaded-tanks.ts, then unzip -n data/external/cascaded-tanks/raw/CascadedTanksFiles.zip -d data/external/cascaded-tanks/derived/extracted');
  const buf = readFileSync(CSV); const h = createHash('sha256').update(buf).digest('hex');
  if (h !== CSV_SHA256) throw new Error(`dataBenchmark.csv hash ${h} does not match the provenance record`);
  const rows = buf.toString('utf8').split(/\r?\n/).slice(1).filter((l) => l.trim().length).map((l) => l.split(',').map((c) => c.trim()));
  const col = (j: number) => rows.map((r) => Number(r[j]));
  const d = { uEst: col(0), uTest: col(1), yEst: col(2), yTest: col(3) };
  for (const [k, v] of Object.entries(d)) if (v.length !== N || v.some((x) => !Number.isFinite(x))) throw new Error(`${k}: expected ${N} finite samples`);
  return d;
}

// ------------------------------------------------------------------ metrics
export const rmse = (y: number[], yh: number[], from = 0, idx?: number[]) => { const I = idx ?? y.map((_, i) => i).filter((i) => i >= from); if (!I.length) return null; const v = mean(I.map((i) => (y[i] - yh[i]) ** 2)); return Number.isFinite(v) ? Math.sqrt(v) : Infinity; };
export const mae = (y: number[], yh: number[], from = 0) => { const v = mean(y.slice(from).map((x, i) => Math.abs(x - yh[i + from]))); return Number.isFinite(v) ? v : Infinity; };
export const fitPct = (y: number[], yh: number[], from = 0) => { const ys = y.slice(from), m = mean(ys); const num = Math.sqrt(ys.reduce((s, x, i) => s + (x - yh[i + from]) ** 2, 0)), den = Math.sqrt(ys.reduce((s, x) => s + (x - m) ** 2, 0)); return Number.isFinite(num) ? 100 * (1 - num / den) : -Infinity; };

interface Model {
  id: string; family: string;
  /** Free-run simulation of the output for input u (null = not defined for this model). */
  simulate: ((u: number[], y: number[]) => number[]) | null;
  /** One-step prediction ŷ(t) from u(1..t), y(1..t−1) (null = not defined). */
  predict: ((u: number[], y: number[]) => number[]) | null;
  seed: number; params: number; adaptationSteps: number; fitMs: number; describe: Record<string, unknown>;
}

// ------------------------------------------------------------------ M1 ARX and M7 PWARX
const uAt = (u: number[], t: number) => u[Math.max(0, t)]; // u(t<0) := u(0)
const arxRow = (y: number[], u: number[], t: number, na: number, nb: number, nk: number) => [...Array.from({ length: na }, (_, i) => y[t - 1 - i]), ...Array.from({ length: nb }, (_, j) => uAt(u, t - nk - j))];
function fitARX(u: number[], y: number[], rows: number[], na: number, nb: number, nk: number) { return wls(rows.map((t) => arxRow(y, u, t, na, nb, nk)), rows.map((t) => y[t])); }
function arxModel(w: number[], na: number, nb: number, nk: number, gate?: { theta: number; w2: number[] }): { sim: (u: number[], y: number[], from?: number, to?: number) => number[]; pred: (u: number[], y: number[]) => number[] } {
  const pick = (yprev: number) => (gate && yprev >= gate.theta ? gate.w2 : w);
  const sim = (u: number[], y: number[], from = 0, to = u.length) => { const s = y.slice(); for (let t = from + na; t < to; t++) s[t] = predictLin(pick(s[t - 1]), arxRow(s, u, t, na, nb, nk)); return s; };
  const pred = (u: number[], y: number[]) => y.map((v, t) => (t < na ? v : predictLin(pick(y[t - 1]), arxRow(y, u, t, na, nb, nk))));
  return { sim, pred };
}
const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);

function M1(d: Data): Model {
  const t0 = performance.now(); let best = { v: Infinity, na: 1, nb: 1, nk: 0 }; let tried = 0;
  for (let na = 1; na <= 5; na++) for (let nb = 1; nb <= 5; nb++) for (const nk of [0, 1]) {
    const w = fitARX(d.uEst, d.yEst, range(Math.max(na, nk + nb), FIT), na, nb, nk); tried++;
    const s = arxModel(w, na, nb, nk).sim(d.uEst, d.yEst, FIT, N); const v = rmse(d.yEst.slice(FIT), s.slice(FIT)) ?? Infinity; if (v < best.v) best = { v, na, nb, nk };
  }
  const w = fitARX(d.uEst, d.yEst, range(Math.max(best.na, best.nk + best.nb), N), best.na, best.nb, best.nk); const m = arxModel(w, best.na, best.nb, best.nk);
  return { id: 'M1-ARX', family: 'classical system identification (linear)', simulate: (u, y) => m.sim(u, y), predict: (u, y) => m.pred(u, y), seed: best.na, params: w.length, adaptationSteps: tried, fitMs: performance.now() - t0, describe: { na: best.na, nb: best.nb, nk: best.nk, validationSimRMSE: best.v, stateVariables: 'none (input–output)', fitting: 'least squares on estimation samples; orders selected by validation simulation RMSE' } };
}

function M7(d: Data): Model {
  const t0 = performance.now(); let best = { v: Infinity, na: 1, nb: 1, nk: 0, th: 8 }; let tried = 0;
  const fitPW = (rows: number[], na: number, nb: number, nk: number, th: number) => { const lo = rows.filter((t) => d.yEst[t - 1] < th), hi = rows.filter((t) => d.yEst[t - 1] >= th); const k = na + nb + 1; if (lo.length < 3 * k || hi.length < 3 * k) return null; return { w: fitARX(d.uEst, d.yEst, lo, na, nb, nk), w2: fitARX(d.uEst, d.yEst, hi, na, nb, nk) }; };
  for (let na = 1; na <= 5; na++) for (let nb = 1; nb <= 5; nb++) for (const nk of [0, 1]) for (const th of [7, 8, 9]) {
    tried++; const f = fitPW(range(Math.max(na, nk + nb), FIT), na, nb, nk, th); if (!f) continue;
    const s = arxModel(f.w, na, nb, nk, { theta: th, w2: f.w2 }).sim(d.uEst, d.yEst, FIT, N); const v = rmse(d.yEst.slice(FIT), s.slice(FIT)) ?? Infinity; if (v < best.v) best = { v, na, nb, nk, th };
  }
  const f = fitPW(range(Math.max(best.na, best.nk + best.nb), N), best.na, best.nb, best.nk, best.th)!; const m = arxModel(f.w, best.na, best.nb, best.nk, { theta: best.th, w2: f.w2 });
  return { id: 'M7-PWARX', family: 'switching / piecewise-affine ARX (fairness extension)', simulate: (u, y) => m.sim(u, y), predict: (u, y) => m.pred(u, y), seed: 0, params: 2 * f.w.length + 1, adaptationSteps: tried, fitMs: performance.now() - t0, describe: { na: best.na, nb: best.nb, nk: best.nk, threshold_V: best.th, validationSimRMSE: best.v, fitting: 'least squares per regime; switch on y(t−1) ≥ θ' } };
}

// ------------------------------------------------------------------ M2 second-order output-error
function M2(d: Data): Model {
  const t0 = performance.now();
  const sim = (p: number[], u: number[], n = u.length) => { const [f1, f2, b1, b2, c, y0, y1] = p; const s = new Array(n).fill(0); s[0] = y0; s[1] = y1; for (let t = 2; t < n; t++) s[t] = -f1 * s[t - 1] - f2 * s[t - 2] + b1 * u[t - 1] + b2 * u[t - 2] + c; return s; };
  const cost = (p: number[], hi: number) => { const s = sim(p, d.uEst, hi); const e = rmse(d.yEst.slice(0, hi), s); return e === null || !Number.isFinite(e) ? 1e6 : e; };
  let best: { p: number[]; v: number } = { p: [], v: Infinity }; let evals = 0;
  for (let seed = 1; seed <= 5; seed++) {
    const r = rng(seed, 202); const x0 = [-1.5 + next(r) * 0.4, 0.5 + next(r) * 0.2, 0.05 + next(r) * 0.1, 0.05 + next(r) * 0.1, next(r) * 0.2, d.yEst[0], d.yEst[1]];
    const o = nelderMead((p) => cost(p, FIT), x0, { maxEvals: 4000 }); evals += o.evals;
    const v = rmse(d.yEst.slice(FIT), sim(o.x, d.uEst).slice(FIT)) ?? Infinity; if (v < best.v) best = { p: o.x, v };
  }
  const fin = nelderMead((p) => cost(p, N), best.p, { maxEvals: 4000 }); evals += fin.evals; const p = fin.x;
  return { id: 'M2-OE', family: 'linear state-space / output-error (MPC-compatible)', simulate: (u) => sim(p, u), predict: null, seed: 0, params: 7, adaptationSteps: evals, fitMs: performance.now() - t0, describe: { order: 2, parameters: { f: p.slice(0, 2), b: p.slice(2, 4), offset: p[4] }, initialState: p.slice(5), validationSimRMSE: best.v, fitting: 'simulation-error minimization (Nelder–Mead, 5 multi-starts), initial states estimated and reused for the test record', predictionMode: 'not defined (no noise model)' } };
}

// ------------------------------------------------------------------ M3 polynomial NARX
const polyRow = (y: number[], u: number[], t: number, na: number, nb: number, nk: number) => { const b = arxRow(y, u, t, na, nb, nk); const out = [...b]; for (let i = 0; i < b.length; i++) for (let j = i; j < b.length; j++) out.push(b[i] * b[j]); return out; };
function M3(d: Data): Model {
  const t0 = performance.now(); let best = { v: Infinity, na: 1, nb: 1, nk: 0 }; let tried = 0;
  const fit = (rows: number[], na: number, nb: number, nk: number) => wls(rows.map((t) => polyRow(d.yEst, d.uEst, t, na, nb, nk)), rows.map((t) => d.yEst[t]), undefined, 1e-6);
  const mk = (w: number[], na: number, nb: number, nk: number) => ({ sim: (u: number[], y: number[], from = 0, to = u.length) => { const s = y.slice(); for (let t = from + na; t < to; t++) { s[t] = predictLin(w, polyRow(s, u, t, na, nb, nk)); if (!Number.isFinite(s[t]) || Math.abs(s[t]) > 1e6) { for (let k = t; k < to; k++) s[k] = NaN; break; } } return s; }, pred: (u: number[], y: number[]) => y.map((v, t) => (t < na ? v : predictLin(w, polyRow(y, u, t, na, nb, nk)))) });
  for (let na = 1; na <= 3; na++) for (let nb = 1; nb <= 3; nb++) for (const nk of [0, 1]) { tried++; const w = fit(range(Math.max(na, nk + nb), FIT), na, nb, nk); const s = mk(w, na, nb, nk).sim(d.uEst, d.yEst, FIT, N); const v = rmse(d.yEst.slice(FIT), s.slice(FIT)) ?? Infinity; if (Number.isFinite(v) && v < best.v) best = { v, na, nb, nk }; }
  const w = fit(range(Math.max(best.na, best.nk + best.nb), N), best.na, best.nb, best.nk); const m = mk(w, best.na, best.nb, best.nk);
  return { id: 'M3-NARX', family: 'nonlinear autoregressive (degree-2 polynomial)', simulate: (u, y) => m.sim(u, y), predict: (u, y) => m.pred(u, y), seed: 0, params: w.length, adaptationSteps: tried, fitMs: performance.now() - t0, describe: { na: best.na, nb: best.nb, nk: best.nk, validationSimRMSE: best.v, fitting: 'ridge least squares (1e-6) on one-step regressors' } };
}

// ------------------------------------------------------------------ M4 grey-box and M5 twin
interface GB { k: number[]; c: number; x0: number[]; max: number[] | null }
function gbStep(x: number[], u: number, g: GB): number[] {
  let [x1, x2] = x; const dt = 1;
  for (let s = 0; s < 4; s++) { const n1 = x1 + dt * (-g.k[0] * Math.sqrt(Math.max(0, x1)) + g.k[3] * u); const n2 = x2 + dt * (g.k[1] * Math.sqrt(Math.max(0, x1)) - g.k[2] * Math.sqrt(Math.max(0, x2))); x1 = Math.max(0, n1); x2 = Math.max(0, n2); if (g.max) { x1 = Math.min(x1, g.max[0]); x2 = Math.min(x2, g.max[1]); } }
  return [x1, x2];
}
function gbSim(g: GB, u: number[], n = u.length): number[] { const out: number[] = []; let x = g.x0.slice(); for (let t = 0; t < n; t++) { out.push(x[1] + g.c); x = gbStep(x, u[t], g); } return out; }
const unpack = (p: number[], overflow: boolean): GB => ({ k: p.slice(0, 4).map((v) => Math.exp(v)), c: p[4], x0: [Math.exp(p[5]), Math.exp(p[6])], max: overflow ? [Math.exp(p[7]), Math.exp(p[8])] : null });
function fitGB(d: Data, overflow: boolean): { g: GB; v: number; evals: number } {
  const cost = (p: number[], hi: number) => { const s = gbSim(unpack(p, overflow), d.uEst, hi); const e = rmse(d.yEst.slice(0, hi), s); return e === null || !Number.isFinite(e) ? 1e6 : e; };
  let best = { p: [] as number[], v: Infinity }; let evals = 0;
  for (let seed = 1; seed <= 5; seed++) {
    const r = rng(seed, 404); const lu = (a: number, b: number) => Math.log(a) + next(r) * (Math.log(b) - Math.log(a));
    const x0 = [lu(0.01, 0.2), lu(0.01, 0.2), lu(0.01, 0.2), lu(0.01, 0.2), -2 + next(r) * 4, lu(1, 10), lu(1, 10), ...(overflow ? [lu(5, 20), lu(5, 20)] : [])];
    const o = nelderMead((p) => cost(p, FIT), x0, { maxEvals: 4000 }); evals += o.evals;
    const v = rmse(d.yEst.slice(FIT), gbSim(unpack(o.x, overflow), d.uEst).slice(FIT)) ?? Infinity; if (v < best.v) best = { p: o.x, v };
  }
  const fin = nelderMead((p) => cost(p, N), best.p, { maxEvals: 4000 }); evals += fin.evals;
  return { g: unpack(fin.x, overflow), v: best.v, evals };
}
function M4(d: Data, overflow: boolean): Model & { gb: GB } {
  const t0 = performance.now(); const { g, v, evals } = fitGB(d, overflow);
  return { id: overflow ? 'M4b-grey-box-overflow' : 'M4a-grey-box', family: overflow ? 'grey-box with documented overflow' : 'grey-box nonlinear state-space (documented physics)', simulate: (u) => gbSim(g, u), predict: null, seed: 0, params: overflow ? 9 : 7, adaptationSteps: evals, fitMs: performance.now() - t0, gb: g, describe: { stateVariables: ['x1 (upper tank)', 'x2 (lower tank)'], equations: 'documentation (1)–(3), forward Euler 4×1 s, states ≥ 0' + (overflow ? ', saturation at fitted maxima' : ''), k: g.k, offset: g.c, initialState: g.x0, maxima: g.max, validationSimRMSE: v, predictionMode: 'see M5 (EKF)' } };
}
/** Digital twin: M4b as the digital model, synchronized to the sensor by an extended Kalman filter (state updates only). */
function ekfPredict(g: GB, u: number[], y: number[], q: number, r: number): { pred: number[]; nis: number[] } {
  let x = g.x0.slice(); let P = [[1, 0], [0, 1]]; const pred: number[] = [], nis: number[] = [];
  for (let t = 0; t < u.length; t++) {
    const yh = x[1] + g.c; pred.push(yh); const S = P[1][1] + r; const nu = y[t] - yh; nis.push((nu * nu) / S);
    const K = [P[0][1] / S, P[1][1] / S]; x = [Math.max(0, x[0] + K[0] * nu), Math.max(0, x[1] + K[1] * nu)];
    P = [[P[0][0] - K[0] * P[1][0], P[0][1] - K[0] * P[1][1]], [P[1][0] - K[1] * P[1][0], P[1][1] - K[1] * P[1][1]]];
    const f = (z: number[]) => gbStep(z, u[t], g); const fx = f(x); const h = 1e-4;
    const J = [0, 1].map((j) => { const z = x.slice(); z[j] += h; const fz = f(z); return [(fz[0] - fx[0]) / h, (fz[1] - fx[1]) / h]; });
    const F = [[J[0][0], J[1][0]], [J[0][1], J[1][1]]];
    const FP = [[F[0][0] * P[0][0] + F[0][1] * P[1][0], F[0][0] * P[0][1] + F[0][1] * P[1][1]], [F[1][0] * P[0][0] + F[1][1] * P[1][0], F[1][0] * P[0][1] + F[1][1] * P[1][1]]];
    P = [[FP[0][0] * F[0][0] + FP[0][1] * F[0][1] + q, FP[0][0] * F[1][0] + FP[0][1] * F[1][1]], [FP[1][0] * F[0][0] + FP[1][1] * F[0][1], FP[1][0] * F[1][0] + FP[1][1] * F[1][1] + q]];
    x = fx;
  }
  return { pred, nis };
}
function M5(d: Data, m4b: Model & { gb: GB }): Model & { nisEst: number } {
  const t0 = performance.now(); let best = { v: Infinity, q: 1e-3, r: 1e-3 }; let tried = 0;
  for (const q of [1e-4, 1e-3, 1e-2, 1e-1]) for (const r of [1e-4, 1e-3, 1e-2]) { tried++; const p = ekfPredict(m4b.gb, d.uEst, d.yEst, q, r).pred; const v = rmse(d.yEst.slice(FIT), p.slice(FIT)) ?? Infinity; if (v < best.v) best = { v, q, r }; }
  const nisEst = mean(ekfPredict(m4b.gb, d.uEst, d.yEst, best.q, best.r).nis);
  return { id: 'M5-twin', family: 'digital twin (M4b + EKF)', simulate: m4b.simulate, predict: (u, y) => ekfPredict(m4b.gb, u, y, best.q, best.r).pred, seed: 0, params: m4b.params + 2, adaptationSteps: tried, fitMs: performance.now() - t0 + m4b.fitMs, nisEst, describe: { digitalModel: 'M4b', synchronization: 'EKF on (x1, x2), state updates only', processVariance: best.q, measurementVariance: best.r, validationPredRMSE: best.v, meanNIS_estimation: nisEst, simulationMode: 'identical to M4b (no sensor feed in simulation)' } };
}

// ------------------------------------------------------------------ M6 NARX-MLP
function M6(d: Data): Model & { perSeed: { seed: number; model: (u: number[], y: number[], sim: boolean) => number[] }[] } {
  const t0 = performance.now(); const my = mean(d.yEst), sy = Math.sqrt(mean(d.yEst.map((v) => (v - my) ** 2))), mu = mean(d.uEst), su = Math.sqrt(mean(d.uEst.map((v) => (v - mu) ** 2)));
  const inp = (y: number[], u: number[], t: number, L: number) => [...Array.from({ length: L }, (_, i) => (y[t - 1 - i] - my) / sy), ...Array.from({ length: L }, (_, i) => (uAt(u, t - i) - mu) / su)];
  const train = (L: number, seed: number, hi: number) => { const net = new MLP(2 * L, 8, seed); const rows = range(L, hi); net.train(rows.map((t) => inp(d.yEst, d.uEst, t, L)), rows.map((t) => (d.yEst[t] - my) / sy), 500, 0.01); return net; };
  const run = (net: MLP, L: number) => (u: number[], y: number[], sim: boolean) => { const s = y.slice(); for (let t = L; t < u.length; t++) s[t] = net.forward(inp(sim ? s : y, u, t, L)).y * sy + my; return s; };
  let best = { v: Infinity, L: 2 }; let steps = 0;
  for (const L of [2, 3, 5]) { const v = mean([1, 2, 3, 4, 5].map((seed) => { const net = train(L, seed, FIT); steps += 500; const s = run(net, L)(d.uEst.slice(FIT - L), d.yEst.slice(FIT - L), true); const e = rmse(d.yEst.slice(FIT), s.slice(L)); return e ?? Infinity; })); if (v < best.v) best = { v, L }; }
  const perSeed = [1, 2, 3, 4, 5].map((seed) => { const net = train(best.L, seed, N); steps += 500; return { seed, model: run(net, best.L) }; });
  const avg = (sim: boolean) => (u: number[], y: number[]) => { const all = perSeed.map((p) => p.model(u, y, sim)); return u.map((_, t) => mean(all.map((a) => a[t]))); };
  return { id: 'M6-MLP', family: 'feature learning (NARX-MLP)', simulate: avg(true), predict: avg(false), seed: 0, params: new MLP(2 * best.L, 8, 1).params, adaptationSteps: steps, fitMs: performance.now() - t0, perSeed, describe: { lags: best.L, hidden: 8, epochs: 500, seeds: [1, 2, 3, 4, 5], validationSimRMSE_meanOverSeeds: best.v, reported: 'mean of per-seed outputs; per-seed metrics in the results file', normalization: 'estimation-record mean and standard deviation' } };
}

// ------------------------------------------------------------------ Ziran / Xeno adapter
export interface ZiranOut { id: string; predict: number[]; generated: string[]; origins: string[]; retainedChanges: number; representationChanged: boolean; params: number; fitMs: number; replayRoundTrip: string; aliasingRecords: number; configuration: Record<string, string> }
const REPR = ['discretize', 'sign', 'continuize'], TEMPORAL = ['delay', 'window', 'temporal-diff'];
export function ziran(d: Data, variant: 'Z-full' | 'Z-fixed-observations' | 'Z-no-grammar-revision' | 'Z-fixed-description-space' | 'Z-no-multiple-windows' | 'Z-no-meta'): ZiranOut {
  const t0 = performance.now();
  // map both records into v0.3.0 observation sets and replay them through the external adapter
  const meta = { source: 'Cascaded Tanks benchmark, 4TU.ResearchData DOI 10.4121/12960104.v1', domain: 'physical-experiment', samplingRegime: 'uniform, Ts = 4 s (dataset documentation)', missingness: 'none (verified)', apparatus: 'uncalibrated capacitive level sensor; pump voltage input (dataset documentation)', timebase: 'sample index × 4 s', uncertainty: 'output SNR close to 40 dB (dataset documentation)', provenance: 'results/external-comparison/cascaded-tanks/provenance.json', preprocessing: 'parsing only (this project)', evidence: 'replayed-empirical' as const };
  const u = [...d.uEst, ...d.uTest], y = [...d.yEst, ...d.yTest];
  const tr = runSpec(replaySpec({ ...meta, channels: [{ id: 'u', unit: 'V', samples: u.map((v, t) => [t, v] as [number, number]) }, { id: 'y', unit: 'V', samples: y.map((v, t) => [t, v] as [number, number]) }] }));
  const S = observationSeries(tr, 'external', ['u', 'y']);
  let shift = -1; for (const s of [0, 1]) if (S.y.length >= y.length - s && y.slice(0, y.length - s).every((v, i) => Math.abs(S.y[i + s] - v) < 1e-12)) { shift = s; break; }
  const series = shift < 0 ? { u, y } : { u: S.u.slice(shift, shift + u.length), y: S.y.slice(shift, shift + y.length) };
  const roundTrip = shift < 0 ? 'replayed series did not match the source exactly; source arrays used' : `replayed series identical to the source (reading offset ${shift})`;
  // v0.3.0 aliasing key (quantization 1e-3) on the estimation record
  const key = (t: number) => `${Math.round(series.u[t] * 1e3)}|${Math.round(series.y[t] * 1e3)}`; const groups = new Map<string, number[]>(); for (let t = 0; t < N - 1; t++) (groups.get(key(t)) ?? groups.set(key(t), []).get(key(t))!).push(t);
  let aliasing = 0; for (const ts of groups.values()) for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) if (key(ts[i] + 1) !== key(ts[j] + 1)) aliasing++;
  let extra: number[][] = [], generated: string[] = [], origins: string[] = [], retained = 0, reprChanged = false, gsize = 0;
  if (variant !== 'Z-fixed-observations') {
    const registry = variant === 'Z-no-grammar-revision' ? [] : variant === 'Z-fixed-description-space' ? MUTATION_REGISTRY.filter((m) => !REPR.includes(m.id)) : variant === 'Z-no-multiple-windows' ? MUTATION_REGISTRY.filter((m) => !TEMPORAL.includes(m.id)) : MUTATION_REGISTRY;
    const res = grammarMorphogenesis(series, { trainFrom: 0, trainUntil: N }, { rounds: 3, registry, metaGrammar: variant === 'Z-full' });
    extra = Object.values(res.values); generated = res.accepted.map((a) => a.expr); origins = res.accepted.flatMap((a) => Object.entries(a.operatorOrigins).map(([op, o]) => `${op}:${o}`));
    retained = res.changes.filter((c) => c.retained).length; reprChanged = res.representationChanged; gsize = res.finalGrammar.length;
  }
  // one-step readout: ŷ(t+1) = w·[u(t), y(t), generated(t)], least squares on estimation rows
  const f = (t: number) => [series.u[t], series.y[t], ...extra.map((v) => (Number.isFinite(v[t]) ? v[t] : 0))];
  const rows = range(0, N - 1).filter((t) => extra.every((v) => Number.isFinite(v[t])));
  const w = wls(rows.map(f), rows.map((t) => series.y[t + 1]));
  const pred = d.yTest.map((v, i) => { const t = N + i - 1; return predictLin(w, f(t)); });
  return { id: variant, predict: pred, generated, origins, retainedChanges: retained, representationChanged: reprChanged, params: w.length + gsize, fitMs: performance.now() - t0, replayRoundTrip: roundTrip, aliasingRecords: aliasing,
    configuration: { suppliedByDatasetMetadata: 'sampling regime, apparatus, uncertainty, missingness, units (V)', suppliedByResearcher: 'channel ids u and y, readout form, mutation registry variant, rounds (3), train/test boundary', generatedBySimulator: generated.length ? `variables ${generated.join(', ')}` : 'none' } };
}

export const MODELS = { M1, M2, M3, M4, M5, M6, M7 };
