// Shared, textbook building blocks for the baselines. Each is a standard formulation; none is tuned to a world.
import { seedStream, next, gauss, type RngState } from '../../src/core/rng.ts';

export { seedStream, next, gauss, type RngState };
export const rng = (seed: number, stream = 0): RngState => seedStream(seed, stream);
export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
export const variance = (xs: number[]) => { const m = mean(xs); return xs.length > 1 ? xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1) : 0; };
export const round = (x: number, d = 3) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : x);

/** Solve A w = b (Gaussian elimination with partial pivoting and a tiny ridge). */
export function solve(A: number[][], b: number[], ridge = 1e-8): number[] {
  const k = b.length; const M = A.map((r, i) => [...r.map((v, j) => v + (i === j ? ridge : 0)), b[i]]);
  for (let c = 0; c < k; c++) {
    let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]]; if (Math.abs(M[c][c]) < 1e-14) continue;
    for (let r = 0; r < k; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let q = c; q <= k; q++) M[r][q] -= f * M[c][q]; }
  }
  return M.map((r, i) => (Math.abs(r[i]) < 1e-14 ? 0 : r[k] / r[i]));
}

/** Weighted least squares; weights default to 1. Returns coefficients for [1, ...features]. */
export function wls(X: number[][], y: number[], w?: number[], ridge = 1e-6): number[] {
  const k = (X[0]?.length ?? 0) + 1; const A = Array.from({ length: k }, () => new Array(k).fill(0)); const b = new Array(k).fill(0);
  X.forEach((row, i) => { const r = [1, ...row]; const wi = w ? w[i] : 1; for (let p = 0; p < k; p++) { b[p] += wi * r[p] * y[i]; for (let q = 0; q < k; q++) A[p][q] += wi * r[p] * r[q]; } });
  return solve(A, b, ridge);
}
export const predictLin = (w: number[], row: number[]) => w[0] + row.reduce((s, x, j) => s + x * w[j + 1], 0);

/** Recursive least squares with exponential forgetting (standard adaptive estimation). */
export class RLS {
  w: number[]; P: number[][]; lambda: number; updates = 0;
  constructor(n: number, lambda = 0.95, p0 = 100, w0?: number[]) { this.w = w0 ? [...w0] : new Array(n).fill(0); this.P = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? p0 : 0))); this.lambda = lambda; }
  predict(x: number[]) { return x.reduce((s, v, i) => s + v * this.w[i], 0); }
  update(x: number[], y: number) {
    const n = x.length; const Px = this.P.map((r) => r.reduce((s, v, j) => s + v * x[j], 0)); const den = this.lambda + x.reduce((s, v, i) => s + v * Px[i], 0);
    const K = Px.map((v) => v / den); const e = y - this.predict(x);
    this.w = this.w.map((v, i) => v + K[i] * e);
    this.P = this.P.map((r, i) => r.map((v, j) => (v - K[i] * Px[j]) / this.lambda));
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (!Number.isFinite(this.P[i][j])) this.P[i][j] = i === j ? 100 : 0;
    this.updates++; return e;
  }
}

/** Scalar Kalman filter for x' = a x + b u + w, z = x + v. */
export class Kalman1 {
  x: number; P: number; a: number; b: number; q: number; r: number;
  constructor(a: number, b: number, q: number, r: number, x0 = 0, P0 = 1) { this.a = a; this.b = b; this.q = q; this.r = r; this.x = x0; this.P = P0; }
  predict(u: number) { this.x = this.a * this.x + this.b * u; this.P = this.a * this.a * this.P + this.q; }
  /** Returns the normalized innovation squared (NIS). */
  update(z: number) { const S = this.P + this.r; const nu = z - this.x; const K = this.P / S; this.x += K * nu; this.P *= 1 - K; return (nu * nu) / S; }
}

/** Tabular Q-learning (Watkins) with ε-greedy exploration. State and action encodings are supplied by the caller. */
export class QTable {
  Q = new Map<string, number[]>(); updates = 0; nActions: number; alpha: number; gamma: number;
  constructor(nActions: number, alpha = 0.2, gamma = 0.9) { this.nActions = nActions; this.alpha = alpha; this.gamma = gamma; }
  q(s: string) { let v = this.Q.get(s); if (!v) { v = new Array(this.nActions).fill(0); this.Q.set(s, v); } return v; }
  act(s: string, eps: number, r: RngState) { if (next(r) < eps) return Math.floor(next(r) * this.nActions); const v = this.q(s); let b = 0; for (let i = 1; i < v.length; i++) if (v[i] > v[b] + 1e-12) b = i; return b; }
  learn(s: string, a: number, rew: number, s2: string | null) { const v = this.q(s); const t = rew + (s2 === null ? 0 : this.gamma * Math.max(...this.q(s2))); v[a] += this.alpha * (t - v[a]); this.updates++; }
}

// ------------------------------------------------------------------ discrete active inference primitives
export const softmax = (v: number[], beta = 1) => { const m = Math.max(...v); const e = v.map((x) => Math.exp(beta * (x - m))); const s = e.reduce((a, b) => a + b, 0); return e.map((x) => x / s); };
export const entropy = (p: number[]) => -p.reduce((s, x) => s + (x > 1e-16 ? x * Math.log(x) : 0), 0);
export const kl = (p: number[], q: number[]) => p.reduce((s, x, i) => s + (x > 1e-16 ? x * (Math.log(x) - Math.log(Math.max(q[i], 1e-16))) : 0), 0);
/** Normal CDF (Abramowitz–Stegun 7.1.26 via erf). */
export function normCdf(z: number): number { const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2); return z >= 0 ? (1 + y) / 2 : (1 - y) / 2; }
/** Probability mass of N(mu, sd) over bins with the given edges (outer bins open). */
export function binProbs(mu: number, sd: number, edges: number[]): number[] {
  const out: number[] = []; let prev = 0;
  for (let i = 0; i <= edges.length; i++) { const c = i < edges.length ? normCdf((edges[i] - mu) / sd) : 1; out.push(Math.max(c - prev, 1e-12)); prev = c; }
  const s = out.reduce((a, b) => a + b, 0); return out.map((x) => x / s);
}
export const binOf = (x: number, edges: number[]) => { let i = 0; while (i < edges.length && x >= edges[i]) i++; return i; };

// ------------------------------------------------------------------ small MLP (feature learning baseline)
export class MLP {
  W1: number[][]; b1: number[]; W2: number[]; b2 = 0; params: number; flops = 0; nIn: number; nH: number;
  constructor(nIn: number, nH: number, seed: number) {
    this.nIn = nIn; this.nH = nH;
    const r = rng(seed, 77); const s = 1 / Math.sqrt(nIn);
    this.W1 = Array.from({ length: nH }, () => Array.from({ length: nIn }, () => gauss(r) * s)); this.b1 = new Array(nH).fill(0);
    this.W2 = Array.from({ length: nH }, () => gauss(r) / Math.sqrt(nH)); this.params = nH * nIn + nH + nH + 1;
  }
  forward(x: number[]) { const h = this.W1.map((w, j) => Math.tanh(w.reduce((s, v, i) => s + v * x[i], this.b1[j]))); return { h, y: h.reduce((s, v, j) => s + v * this.W2[j], this.b2) }; }
  /** Full-batch Adam on mean squared error for a fixed number of epochs (the compute budget). */
  train(X: number[][], Y: number[], epochs: number, lr = 0.01) {
    const P = () => [...this.W1.flat(), ...this.b1, ...this.W2, this.b2];
    const m = new Array(this.params).fill(0), v = new Array(this.params).fill(0);
    for (let ep = 1; ep <= epochs; ep++) {
      const g = new Array(this.params).fill(0);
      for (let n = 0; n < X.length; n++) {
        const { h, y } = this.forward(X[n]); const d = (2 * (y - Y[n])) / X.length;
        for (let j = 0; j < this.nH; j++) { const dh = d * this.W2[j] * (1 - h[j] * h[j]); for (let i = 0; i < this.nIn; i++) g[j * this.nIn + i] += dh * X[n][i]; g[this.nH * this.nIn + j] += dh; g[this.nH * this.nIn + this.nH + j] += d * h[j]; }
        g[this.params - 1] += d;
      }
      this.flops += X.length * this.nH * this.nIn * 6;
      const p = P();
      for (let i = 0; i < this.params; i++) { m[i] = 0.9 * m[i] + 0.1 * g[i]; v[i] = 0.999 * v[i] + 0.001 * g[i] * g[i]; p[i] -= (lr * (m[i] / (1 - 0.9 ** ep))) / (Math.sqrt(v[i] / (1 - 0.999 ** ep)) + 1e-8); }
      let k = 0; for (const w of this.W1) for (let i = 0; i < this.nIn; i++) w[i] = p[k++]; for (let j = 0; j < this.nH; j++) this.b1[j] = p[k++]; for (let j = 0; j < this.nH; j++) this.W2[j] = p[k++]; this.b2 = p[k];
    }
  }
}

/** Nelder–Mead simplex minimization (standard coefficients 1, 2, 0.5, 0.5). */
export function nelderMead(f: (x: number[]) => number, x0: number[], o: { maxEvals?: number; tol?: number; step?: number } = {}): { x: number[]; f: number; evals: number } {
  const n = x0.length, maxE = o.maxEvals ?? 4000, tol = o.tol ?? 1e-9, st = o.step ?? 0.1; let evals = 0;
  const F = (x: number[]) => { evals++; const v = f(x); return Number.isFinite(v) ? v : 1e12; };
  let S = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + (Math.abs(v) > 1e-9 ? st * Math.abs(v) : st) : v)))].map((x) => ({ x, f: F(x) }));
  while (evals < maxE) {
    S.sort((a, b) => a.f - b.f);
    const size = Math.max(...S.slice(1).map((p) => Math.max(...p.x.map((v, i) => Math.abs(v - S[0].x[i])))));
    if (size < tol) break;
    const c = x0.map((_, i) => S.slice(0, n).reduce((s, p) => s + p.x[i], 0) / n);
    const w = S[n]; const at = (a: number) => c.map((v, i) => v + a * (w.x[i] - v));
    const r = { x: at(-1), f: 0 }; r.f = F(r.x);
    if (r.f < S[0].f) { const e = { x: at(-2), f: 0 }; e.f = F(e.x); S[n] = e.f < r.f ? e : r; }
    else if (r.f < S[n - 1].f) S[n] = r;
    else { const k = { x: at(r.f < w.f ? -0.5 : 0.5), f: 0 }; k.f = F(k.x); if (k.f < Math.min(r.f, w.f)) S[n] = k; else S = S.map((p, i) => (i === 0 ? p : { x: p.x.map((v, j) => S[0].x[j] + 0.5 * (v - S[0].x[j])), f: 0 })).map((p, i) => (i === 0 ? p : { x: p.x, f: F(p.x) })); }
  }
  S.sort((a, b) => a.f - b.f); return { x: S[0].x, f: S[0].f, evals };
}
