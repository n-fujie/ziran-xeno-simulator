// GrammarBoundedVariableDiscovery (baseline).
//
// Variables are constructed from observation channels by a *supplied, fixed* operator grammar
// (diff, inv, inv_sq, sq, abs, log, sub, mul, ratio) at depth ≤ 2 and kept only if they improve next-step
// prediction beyond the variables already held. This is a baseline symbolic-regression experiment: every
// variable it can produce was expressible in the supplied grammar. It is NOT unrestricted Xenoscience
// variable generation — see grammar-morphogenesis.ts for experiments in which the grammar itself changes.
// Comparison with inherited human categories is a separate, optional report — never the success criterion.

export type Series = Record<string, number[]>;

export interface GenVar { id: string; expr: string; values: number[]; predictionGain: number; discrimination: number | null; intervention: number | null; operators: string[]; operatorOrigin: 'supplied'; variableOrigin: 'constructed-from-supplied-grammar' }

export const SUPPLIED_GRAMMAR = { id: 'G-supplied', fixed: true, unary: ['diff', 'inv', 'inv_sq', 'sq', 'abs', 'log'], binary: ['sub', 'mul', 'ratio'], maxDepth: 2 } as const;

const UN: Record<string, (x: number, prev: number) => number> = {
  diff: (x, p) => x - p, inv: (x) => 1 / x, inv_sq: (x) => Math.sign(x) / (x * x), sq: (x) => x * x, abs: (x) => Math.abs(x), log: (x) => Math.log(Math.abs(x) + 1e-9),
};
const BIN: Record<string, (a: number, b: number) => number> = { sub: (a, b) => a - b, mul: (a, b) => a * b, ratio: (a, b) => a / b };

function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length; const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/** Least squares with small ridge. Returns residual sum of squares. */
export function lsq(X: number[][], y: number[], ridge = 1e-9): number {
  const n = y.length, k = X[0].length;
  const A = Array.from({ length: k }, () => new Array(k).fill(0)); const b = new Array(k).fill(0);
  for (let i = 0; i < n; i++) for (let p = 0; p < k; p++) { b[p] += X[i][p] * y[i]; for (let q = 0; q < k; q++) A[p][q] += X[i][p] * X[i][q]; }
  for (let p = 0; p < k; p++) A[p][p] += ridge * (A[p][p] + 1);
  const w = solve(A, b); if (!w) return Infinity;
  let sse = 0; for (let i = 0; i < n; i++) { let yh = 0; for (let p = 0; p < k; p++) yh += X[i][p] * w[p]; sse += (y[i] - yh) ** 2; }
  return sse;
}

function standardize(v: number[]): number[] {
  const m = v.reduce((a, b) => a + b, 0) / v.length; const s = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1;
  return v.map((x) => (x - m) / s);
}

export interface GenerateOptions { minGain?: number; maxAccept?: number; resolution?: number; interventions?: number[]; start?: number }

export function grammarBoundedDiscovery(series: Series, o: GenerateOptions = {}) {
  const names = Object.keys(series).sort();
  const N = Math.min(...names.map((k) => series[k].length));
  const s0 = o.start ?? 2;
  const rows = N - 1 - s0; // predict t+1 from t for t in [s0, N-2]
  const at = (v: number[], t: number) => v[t];
  const base: { id: string; expr: string; full: number[] }[] = names.map((n) => ({ id: n, expr: n, full: series[n].slice(0, N) }));
  const targets = names.map((n) => standardize(series[n].slice(s0 + 1, N)));
  const cols = (vs: number[][]) => Array.from({ length: rows }, (_, i) => [1, ...vs.map((v) => at(v, s0 + i))]);
  const score = (feats: number[][]) => {
    let tot = 0; const X = cols(feats);
    for (const y of targets) tot += lsq(X, y) / rows;
    return tot;
  };
  const accepted: GenVar[] = [];
  const held = () => [...base.map((b) => b.full), ...accepted.map((a) => a.values)];
  let cur = score(held());
  const baseline = cur;
  const tried = new Set<string>(names);
  const candidates = () => {
    const pool = [...base.map((b) => ({ expr: b.expr, v: b.full })), ...accepted.map((a) => ({ expr: a.id, v: a.values }))];
    const out: { expr: string; v: number[] }[] = [];
    const unary = (p: { expr: string; v: number[] }) => Object.entries(UN).map(([k, f]) => ({ expr: `${k}(${p.expr})`, v: p.v.map((x, i) => f(x, i ? p.v[i - 1] : NaN)) }));
    const bins: { expr: string; v: number[] }[] = [];
    for (const a of pool) for (const b of pool) { if (a.expr === b.expr) continue; for (const [k, f] of Object.entries(BIN)) { if (k !== 'ratio' && a.expr > b.expr) continue; bins.push({ expr: `${k}(${a.expr},${b.expr})`, v: a.v.map((x, i) => f(x, b.v[i])) }); } }
    for (const p of pool) out.push(...unary(p));
    for (const b of bins) { out.push(b); out.push(...unary(b)); }
    return out.filter((c) => !tried.has(c.expr));
  };
  const minGain = o.minGain ?? 0.05, maxAccept = o.maxAccept ?? 5;
  const log: { round: number; best: string; relGain: number; accepted: boolean }[] = [];
  for (let round = 0; round < maxAccept; round++) {
    let best: { expr: string; v: number[]; s: number } | null = null;
    for (const c of candidates()) {
      const seg = c.v.slice(s0, N - 1);
      if (seg.some((x) => !Number.isFinite(x))) continue;
      if (Math.max(...seg) - Math.min(...seg) < 1e-12) continue;
      const s = score([...held(), c.v]);
      if (!best || s < best.s - 1e-12) best = { ...c, s };
    }
    if (!best) break;
    const rel = (cur - best.s) / (cur || 1);
    log.push({ round, best: best.expr, relGain: rel, accepted: rel > minGain });
    if (rel <= minGain) break;
    tried.add(best.expr);
    const id = `g${accepted.length + 1}`;
    accepted.push({ id, expr: best.expr, values: best.v, predictionGain: rel, discrimination: null, intervention: null, operators: [...new Set(best.expr.match(/[a-z_]+(?=\()/g) ?? [])], operatorOrigin: 'supplied', variableOrigin: 'constructed-from-supplied-grammar' });
    cur = best.s;
  }
  // discrimination: aliased pairs in the base observation that the variable separates
  const res = o.resolution ?? 0;
  const q = (x: number) => (res ? Math.round(x / res) : Math.round(x * 1e6));
  const key = (t: number) => names.map((n) => q(series[n][t])).join('|');
  const groups = new Map<string, number[]>();
  for (let t = s0; t < N - 1; t++) (groups.get(key(t)) ?? groups.set(key(t), []).get(key(t))!).push(t);
  const aliased: [number, number][] = [];
  for (const ts of groups.values()) for (let i = 0; i < ts.length && aliased.length < 400; i++) for (let j = i + 1; j < ts.length; j++) if (key(ts[i] + 1) !== key(ts[j] + 1)) aliased.push([ts[i], ts[j]]);
  for (const g of accepted) {
    g.discrimination = aliased.length ? aliased.filter(([a, b]) => Math.abs(g.values[a] - g.values[b]) > 1e-9).length / aliased.length : null;
    if (o.interventions?.length) {
      const resp = o.interventions.map((t) => (t > 0 && t < N - 1 ? Math.abs(g.values[t + 1] - g.values[t - 1]) : 0));
      const sd = Math.sqrt(g.values.slice(s0).filter(Number.isFinite).reduce((a, b, _i, arr) => a + (b - arr.reduce((x, y) => x + y, 0) / arr.length) ** 2, 0) / N) || 1;
      g.intervention = resp.reduce((a, b) => a + b, 0) / resp.length / sd;
    }
  }
  return { mode: 'grammar-bounded' as const, grammar: SUPPLIED_GRAMMAR, accepted, baselineError: baseline, finalError: cur, relativeImprovement: (baseline - cur) / (baseline || 1), aliasedPairs: aliased.length, log,
    claim: 'variables were selected from the supplied construction grammar; no operator, variable type or representation was generated' };
}

export function correlation(a: number[], b: number[]): number {
  const idx = a.map((_, i) => i).filter((i) => Number.isFinite(a[i]) && Number.isFinite(b[i]));
  if (idx.length < 3) return 0;
  const ma = idx.reduce((s, i) => s + a[i], 0) / idx.length, mb = idx.reduce((s, i) => s + b[i], 0) / idx.length;
  let num = 0, da = 0, db = 0; for (const i of idx) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Optional: where does a generated variable isolate the same difference as an inherited human variable? */
export function compareToInherited(gen: GenVar[], inherited: Record<string, number[]>) {
  return Object.entries(inherited).map(([name, v]) => {
    let best = { id: '', expr: '', r: 0 };
    for (const g of gen) { const r = correlation(g.values, v); if (Math.abs(r) > Math.abs(best.r)) best = { id: g.id, expr: g.expr, r }; }
    return { inherited: name, closestGenerated: best.id || null, expr: best.expr || null, correlation: best.r, sameDifference: Math.abs(best.r) > 0.95 };
  });
}
