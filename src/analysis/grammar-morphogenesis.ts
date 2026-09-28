// Operator-grammar morphogenesis (experimental layer).
//
// The variable-construction grammar G is itself revisable: G_t → G_{t+1}. Grammar changes are proposed by
// meta-operations — compose operators into reusable operators, propose temporal/delayed/windowed operators
// whose parameters are derived from residual structure (not from a fixed list), change arity (binary →
// relational n-ary aggregators), replace continuous with discrete representations and back, mutate and
// split parameterized operators, and drop operators that no longer contribute. A change is retained only
// if a variable it makes constructible improves at least one operational criterion; the criterion is
// recorded. Prediction is one criterion among: discrimination, intervention, robustness to configuration
// change, branch discovery, reachability differentiation (compression only as a tie-breaker).
//
// Mutation operators are data (GrammarMutationRegistry): each declares applicability, transformation,
// expected retained information, possible information loss, evaluation hooks, provenance and status.
// With meta-grammar morphogenesis enabled, recurring successful mutation *sequences* are composed into
// higher-order mutation operators (status 'composed'), abstracted variants are generated ('generated'), and
// meta-operators that stop contributing are retired ('retired'). This is meta-grammar morphogenesis, not
// unrestricted grammar generation: the step templates, the registry interface and the evaluation code
// remain fixed.
import { lsq } from './grammar-bounded.ts';

export type Criterion = 'prediction' | 'discrimination' | 'intervention' | 'robustness' | 'branch-discovery' | 'reachability-differentiation' | 'compression';
export type Series = Record<string, number[]>;

export interface Op {
  id: string;
  arity: 1 | 2 | 'n';
  family: 'arithmetic' | 'temporal' | 'delayed' | 'windowed' | 'relational' | 'discrete' | 'continuous' | 'composite';
  origin: 'supplied' | 'composed' | 'proposed' | 'arity-change' | 'representation-change' | 'param-mutation' | 'split' | 'composed-by-meta-operator';
  params?: Record<string, number>;
  parents?: string[];
  discrete?: boolean;
  /** Mutation operator that produced this operator, and its step template (for recipe tracking). */
  mutation?: string;
  step?: string;
  apply: (xs: number[][]) => number[];
}

export interface Var { id: string; expr: string; values: number[]; ops: string[]; discrete: boolean; grammarVersion: number }

export interface GrammarChange {
  version: number; change: string; op: string; family: string; origin: string;
  retained: boolean; retainedBecause: Criterion[]; bestExpr: string | null; scores: Partial<Record<Criterion, number>>; why?: string;
  mutation?: string;
  /** Representation changes record what becomes (in)distinguishable. */
  distinctions?: { retained: string[]; lost: string[]; new: string[]; unknown: string[] };
}

export interface MorphContext {
  /** Sample indices where interventions happened. */
  interventions?: number[];
  /** Sample index where the configuration changed (e.g. a hidden-law switch). */
  changeAt?: number;
  /** Optional per-sample labels for reachability differentiation (e.g. probe outcome ahead). */
  labels?: (number | string)[];
  /** Only rows before this index may be used for selection (online / held-out use). */
  trainUntil?: number;
  /** Only rows from this index on (default 0). */
  trainFrom?: number;
}

const lagged = (v: number[], k: number) => v.map((_, i) => (i - k >= 0 ? v[i - k] : NaN));
const safe = (x: number) => (Number.isFinite(x) ? x : NaN);

function suppliedOps(): Op[] {
  const U = (id: string, f: (x: number, p: number) => number): Op => ({ id, arity: 1, family: 'arithmetic', origin: 'supplied', apply: ([v]) => v.map((x, i) => safe(f(x, i ? v[i - 1] : NaN))) });
  const B = (id: string, f: (a: number, b: number) => number): Op => ({ id, arity: 2, family: 'arithmetic', origin: 'supplied', apply: ([a, b]) => a.map((x, i) => safe(f(x, b[i]))) });
  return [
    U('diff', (x, p) => x - p), U('inv', (x) => 1 / x), U('inv_sq', (x) => Math.sign(x) / (x * x)), U('sq', (x) => x * x), U('abs', (x) => Math.abs(x)), U('log', (x) => Math.log(Math.abs(x) + 1e-9)),
    B('sub', (a, b) => a - b), B('mul', (a, b) => a * b), B('ratio', (a, b) => a / b),
  ];
}

// ------------------------------------------------------------------ scoring

interface Scorer { N: number; base: string[]; baseVals: number[][]; targets: number[][]; ctx: MorphContext; aliased: [number, number][] }

function makeScorer(series: Series, ctx: MorphContext): Scorer {
  const base = Object.keys(series).sort();
  const N = Math.min(...base.map((k) => series[k].length));
  const baseVals = base.map((k) => series[k].slice(0, N));
  const targets = baseVals.map((v) => v.map((_, i) => (i + 1 < N ? v[i + 1] : NaN)));
  const q = (x: number) => Math.round(x * 1e3);
  const key = (t: number) => baseVals.map((v) => q(v[t])).join('|');
  const groups = new Map<string, number[]>();
  for (let t = Math.max(1, ctx.trainFrom ?? 0); t < Math.min(N - 1, ctx.trainUntil ?? N - 1); t++) (groups.get(key(t)) ?? groups.set(key(t), []).get(key(t))!).push(t);
  const aliased: [number, number][] = [];
  for (const ts of groups.values()) for (let i = 0; i < ts.length && aliased.length < 300; i++) for (let j = i + 1; j < ts.length; j++) if (key(ts[i] + 1) !== key(ts[j] + 1)) aliased.push([ts[i], ts[j]]);
  return { N, base, baseVals, targets, ctx, aliased };
}

function rowsWhere(S: Scorer, feats: number[][], pick: (t: number) => boolean): number[] {
  const out: number[] = [];
  const lo = S.ctx.trainFrom ?? 0, hi = Math.min(S.N - 1, S.ctx.trainUntil ?? S.N - 1);
  for (let t = lo; t < hi; t++) if (pick(t) && feats.every((f) => Number.isFinite(f[t])) && S.targets.every((y) => Number.isFinite(y[t]))) out.push(t);
  return out;
}

function err(S: Scorer, feats: number[][], rows: number[]): number {
  if (rows.length < feats.length + 5) return Infinity;
  let tot = 0;
  for (const y of S.targets) {
    const ys = rows.map((t) => y[t]); const m = ys.reduce((a, b) => a + b, 0) / ys.length;
    const v = ys.reduce((a, b) => a + (b - m) ** 2, 0) / ys.length || 1;
    tot += lsq(rows.map((t) => [1, ...feats.map((f) => f[t])]), ys) / rows.length / v;
  }
  return tot;
}

function eta2(labels: (string | number)[], y: number[]): number {
  const n = y.length; if (n < 5) return 0;
  const m = y.reduce((a, b) => a + b, 0) / n; const tot = y.reduce((a, b) => a + (b - m) ** 2, 0); if (tot < 1e-15) return 0;
  const g = new Map<string, number[]>(); labels.forEach((l, i) => (g.get(String(l)) ?? g.set(String(l), []).get(String(l))!).push(y[i]));
  let w = 0; for (const v of g.values()) { const mm = v.reduce((a, b) => a + b, 0) / v.length; w += v.reduce((a, b) => a + (b - mm) ** 2, 0); }
  const k = g.size; const r2 = 1 - w / tot; return n - k > 0 ? 1 - (1 - r2) * (n - 1) / (n - k) : 0;
}

const isDiscrete = (v: number[]) => new Set(v.filter(Number.isFinite).map((x) => Math.round(x * 1e6))).size <= 4;
const bins = (v: number[]) => { const f = v.filter(Number.isFinite).sort((a, b) => a - b); const qs = [0.25, 0.5, 0.75].map((p) => f[Math.floor(p * (f.length - 1))]); return v.map((x) => (Number.isFinite(x) ? qs.filter((q) => x > q).length : NaN)); };

/** Criterion gains of adding `cand` to the held variable set. */
export function criterionGains(S: Scorer, held: number[][], cand: number[]): Partial<Record<Criterion, number>> {
  const all = [...held, cand];
  const rel = (a: number, b: number) => (Number.isFinite(a) && Number.isFinite(b) && a > 0 ? (a - b) / a : 0);
  const rowsAll = rowsWhere(S, all, () => true);
  // Predictive criteria are evaluated out of sample (block cross-validation), so a variable cannot be retained by overfitting.
  const g: Partial<Record<Criterion, number>> = { prediction: rel(cvErr(S, held, rowsAll, rowsAll), cvErr(S, all, rowsAll, rowsAll)) };
  if (S.ctx.changeAt !== undefined) { const r = rowsAll.filter((t) => t >= S.ctx.changeAt!); g.robustness = rel(cvErr(S, held, rowsAll, r), cvErr(S, all, rowsAll, r)); }
  if (S.ctx.interventions?.length) { const r = rowsAll.filter((t) => S.ctx.interventions!.some((k) => t >= k && t <= k + 6)); if (r.length >= 20) g.intervention = rel(cvErr(S, held, rowsAll, r), cvErr(S, all, rowsAll, r)); }
  if (S.aliased.length) {
    const sep = (vs: number[][], a: number, b: number) => vs.some((v) => Number.isFinite(v[a]) && Number.isFinite(v[b]) && Math.abs(v[a] - v[b]) > 1e-9);
    const open = S.aliased.filter(([a, b]) => !sep(held, a, b));
    g.discrimination = open.length ? open.filter(([a, b]) => sep([cand], a, b)).length / S.aliased.length : 0;
  }
  if (isDiscrete(cand)) {
    const r = rowsAll.filter((t) => t > 0);
    const dy = r.map((t) => S.targets.reduce((s, y, i) => s + (y[t] - S.baseVals[i][t]), 0));
    const heldDiscrete = held.filter(isDiscrete);
    const before = heldDiscrete.length ? Math.max(...heldDiscrete.map((h) => eta2(r.map((t) => h[t]), dy))) : 0;
    g['branch-discovery'] = Math.max(0, eta2(r.map((t) => cand[t]), dy) - before);
  }
  if (S.ctx.labels) {
    const lab = S.ctx.labels; const r = rowsAll.filter((t) => lab[t] !== undefined);
    const ynum = r.map((t) => (typeof lab[t] === 'number' ? lab[t] as number : String(lab[t]).length));
    const bc = bins(cand); const before = held.length ? Math.max(...held.map((h) => { const bh = bins(h); return eta2(r.map((t) => bh[t]), ynum); })) : 0;
    g['reachability-differentiation'] = Math.max(0, eta2(r.map((t) => bc[t]), ynum) - before);
  }
  return g;
}

const THRESH: Record<Criterion, number> = { prediction: 0.03, discrimination: 0.05, intervention: 0.15, robustness: 0.05, 'branch-discovery': 0.15, 'reachability-differentiation': 0.05, compression: 0 };
/** Harm guard: a change that makes out-of-sample prediction worse is not retained for any other criterion. */
const HARM = -0.01;
const improves = (g: Partial<Record<Criterion, number>>) => ((g.prediction ?? 0) < HARM ? [] : (Object.entries(g) as [Criterion, number][]).filter(([c, v]) => v > THRESH[c]).map(([c]) => c));
const score = (g: Partial<Record<Criterion, number>>) => (Object.entries(g) as [Criterion, number][]).reduce((s, [c, v]) => s + Math.max(0, v - THRESH[c]), 0);

// ------------------------------------------------------------------ construction

interface Pool { id: string; expr: string; values: number[]; ops: string[] }

function constructWith(op: Op, pool: Pool[], base: Pool[]): { expr: string; values: number[]; ops: string[] }[] {
  const out: { expr: string; values: number[]; ops: string[] }[] = [];
  if (op.arity === 1) for (const p of pool) out.push({ expr: `${op.id}(${p.expr})`, values: op.apply([p.values]), ops: [...p.ops, op.id] });
  else if (op.arity === 2) for (const a of pool) for (const b of pool) { if (a.id === b.id) continue; out.push({ expr: `${op.id}(${a.expr},${b.expr})`, values: op.apply([a.values, b.values]), ops: [...a.ops, ...b.ops, op.id] }); }
  else if (base.length >= 3) for (let i = 0; i < base.length; i++) out.push({ expr: `${op.id}(${base[i].expr}|others)`, values: op.apply([base[i].values, ...base.filter((_, j) => j !== i).map((b) => b.values)]), ops: [op.id] });
  return out.filter((c) => c.values.filter(Number.isFinite).length > c.values.length * 0.6 && new Set(c.values.filter(Number.isFinite).map((x) => Math.round(x * 1e9))).size > 1);
}

function residual(S: Scorer, held: number[][]): number[] {
  const rows = rowsWhere(S, held, () => true);
  const y = S.targets[0];
  // plain least-squares residual for the first target, via normal equations on held features
  const X = rows.map((t) => [1, ...held.map((f) => f[t])]);
  const k = X[0]?.length ?? 1;
  const A = Array.from({ length: k }, () => new Array(k).fill(0)); const b = new Array(k).fill(0);
  rows.forEach((t, i) => { for (let p = 0; p < k; p++) { b[p] += X[i][p] * y[t]; for (let q = 0; q < k; q++) A[p][q] += X[i][p] * X[i][q]; } });
  for (let p = 0; p < k; p++) A[p][p] += 1e-9 * (A[p][p] + 1);
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < k; c++) { let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; if (Math.abs(M[c][c]) < 1e-14) continue; for (let r = 0; r < k; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let q = c; q <= k; q++) M[r][q] -= f * M[c][q]; } }
  const w = M.map((r, i) => (Math.abs(r[i]) < 1e-14 ? 0 : r[k] / r[i]));
  const res = new Array(S.N).fill(NaN);
  rows.forEach((t, i) => { res[t] = y[t] - X[i].reduce((s, x, j) => s + x * w[j], 0); });
  return res;
}

function corr(a: number[], b: number[]): number {
  const idx = a.map((_, i) => i).filter((i) => Number.isFinite(a[i]) && Number.isFinite(b[i]));
  if (idx.length < 8) return 0;
  const ma = idx.reduce((s, i) => s + a[i], 0) / idx.length, mb = idx.reduce((s, i) => s + b[i], 0) / idx.length;
  let n = 0, da = 0, db = 0; for (const i of idx) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? n / Math.sqrt(da * db) : 0;
}

const windowMean = (v: number[], w: number) => v.map((_, i) => { if (i - w + 1 < 0) return NaN; let s = 0; for (let j = i - w + 1; j <= i; j++) s += v[j]; return s / w; });

// ------------------------------------------------------------------ GrammarMutationRegistry

export interface MutationEnv { S: Scorer; G: Op[]; held: Pool[]; accepted: Var[]; residual: number[]; base: Pool[] }

export interface MutationOperator {
  id: string;
  status: 'supplied' | 'composed' | 'generated' | 'retired';
  provenance: string;
  /** When the operator can apply. */
  applicability: string;
  /** What it does to the grammar. */
  transformation: string;
  expectedRetained: string;
  possibleLoss: string;
  /** Criteria by which proposals are evaluated. */
  hooks: Criterion[];
  /** Step templates, for composed / generated meta-operators. */
  recipe?: string[];
  propose(env: MutationEnv): { change: string; op: Op }[];
}

const ALL_HOOKS: Criterion[] = ['prediction', 'discrimination', 'intervention', 'robustness', 'branch-discovery', 'reachability-differentiation'];
const kGrid = (N: number) => Array.from({ length: Math.max(0, Math.min(24, Math.floor(N / 6)) - 1) }, (_, i) => i + 2);
const W_GRID = [3, 4, 5, 6, 8, 10, 13, 16, 21];

function bestLag(S: Scorer, r: number[]): [number, number] { let bk = 0, bc = 0; for (const bv of S.baseVals) for (const k of kGrid(S.N)) { const c = Math.abs(corr(r, lagged(bv, k))); if (c > bc) { bc = c; bk = k; } } return [bk, bc]; }
function bestWindow(S: Scorer, r: number[]): [number, number] { let bw = 0, bc = 0; for (const bv of S.baseVals) for (const w of W_GRID) { const c = Math.abs(corr(r, windowMean(bv, w))); if (c > bc) { bc = c; bw = w; } } return [bw, bc]; }
const median = (v: number[]) => { const f = v.filter(Number.isFinite).sort((a, b) => a - b); return f[Math.floor(f.length / 2)] ?? 0; };

/** Step templates usable inside composed meta-operators (parameters are searched jointly at use). */
export const STEP_TEMPLATES: Record<string, { params: (S: Scorer) => number[]; make: (p: number) => (v: number[]) => number[]; label: (p: number) => string; discrete?: boolean }> = {
  delay: { params: (S) => kGrid(S.N), make: (k) => (v) => lagged(v, k), label: (k) => `lag${k}` },
  window: { params: () => W_GRID, make: (w) => (v) => windowMean(v, w), label: (w) => `wmean${w}` },
  tdiff: { params: (S) => kGrid(S.N), make: (k) => (v) => v.map((x, i) => x - (i - k >= 0 ? v[i - k] : NaN)), label: (k) => `dlag${k}` },
  discretize: { params: () => [0], make: () => (v) => { const th = median(v); return v.map((z) => (Number.isFinite(z) ? (z > th ? 1 : 0) : NaN)); }, label: () => 'step', discrete: true },
  sign: { params: () => [0], make: () => (v) => v.map((z) => (Number.isFinite(z) ? Math.sign(z) : NaN)), label: () => 'sign', discrete: true },
  smooth: { params: () => [5], make: (w) => (v) => windowMean(v, w), label: (w) => `smooth${w}` },
};

const DISCRETE_LOSS = { retained: ['side of the threshold'], lost: ['magnitude within each side of the threshold'], new: ['categorical regime label'], unknown: ['whether the lost magnitude matters under other configurations'] };

export const MUTATION_REGISTRY: MutationOperator[] = [
  { id: 'delay', status: 'supplied', provenance: 'core baseline', applicability: 'residual correlates with a lagged base channel (|r| > 0.1)', transformation: 'add lag_k with k derived from residual structure', expectedRetained: 'all past values', possibleLoss: 'none (adds an operator)', hooks: ALL_HOOKS,
    propose: ({ S, residual }) => { const [k, c] = bestLag(S, residual); return k && c > 0.1 ? [{ change: 'introduce-delayed-operator', op: { id: `lag${k}`, arity: 1, family: 'delayed', origin: 'proposed', params: { k }, mutation: 'delay', step: 'delay', apply: ([v]) => lagged(v, k) } }] : []; } },
  { id: 'window', status: 'supplied', provenance: 'core baseline', applicability: 'residual correlates with a windowed mean (|r| > 0.1)', transformation: 'add wmean_w with w derived from residual structure', expectedRetained: 'low-frequency content', possibleLoss: 'variation within the window', hooks: ALL_HOOKS,
    propose: ({ S, residual }) => { const [w, c] = bestWindow(S, residual); return w && c > 0.1 ? [{ change: 'introduce-windowed-operator', op: { id: `wmean${w}`, arity: 1, family: 'windowed', origin: 'proposed', params: { w }, mutation: 'window', step: 'window', apply: ([v]) => windowMean(v, w) } }] : []; } },
  { id: 'temporal-diff', status: 'supplied', provenance: 'core baseline', applicability: 'a lag was found in residual structure', transformation: 'add dlag_k (difference at lag k)', expectedRetained: 'change over k steps', possibleLoss: 'level information', hooks: ALL_HOOKS,
    propose: ({ S, residual }) => { const [k] = bestLag(S, residual); return k ? [{ change: 'introduce-temporal-operator', op: { id: `dlag${k}`, arity: 1, family: 'temporal', origin: 'proposed', params: { k }, mutation: 'temporal-diff', step: 'tdiff', apply: ([v]) => v.map((x, i) => x - (i - k >= 0 ? v[i - k] : NaN)) } }] : []; } },
  { id: 'discretize', status: 'supplied', provenance: 'core baseline', applicability: 'a continuous held variable exists', transformation: 'threshold a held variable at its own median (continuous → discrete)', expectedRetained: 'side of threshold', possibleLoss: 'magnitude within each side', hooks: ALL_HOOKS,
    propose: ({ accepted }) => accepted.filter((a) => !a.discrete).slice(-2).map((v) => { const th = median(v.values); return { change: 'continuous→discrete', op: { id: `step@${v.id}`, arity: 1, family: 'discrete', origin: 'representation-change', params: { threshold: th }, parents: v.ops, discrete: true, mutation: 'discretize', step: 'discretize', apply: ([x]: number[][]) => x.map((z) => (Number.isFinite(z) ? (z > th ? 1 : 0) : NaN)) } as Op }; }) },
  { id: 'sign', status: 'supplied', provenance: 'core baseline', applicability: 'always', transformation: 'add sign (continuous → discrete)', expectedRetained: 'sign', possibleLoss: 'magnitude', hooks: ALL_HOOKS,
    propose: () => [{ change: 'continuous→discrete', op: { id: 'sign', arity: 1, family: 'discrete', origin: 'representation-change', discrete: true, mutation: 'sign', step: 'sign', apply: ([x]) => x.map((z) => (Number.isFinite(z) ? Math.sign(z) : NaN)) } }] },
  { id: 'continuize', status: 'supplied', provenance: 'core baseline', applicability: 'a discrete held variable exists', transformation: 'smooth a discrete variable (discrete → continuous)', expectedRetained: 'local frequency of each label', possibleLoss: 'exact switching times', hooks: ALL_HOOKS,
    propose: ({ accepted }) => (accepted.some((a) => a.discrete) ? [{ change: 'discrete→continuous', op: { id: 'smooth5', arity: 1, family: 'continuous', origin: 'representation-change', params: { w: 5 }, mutation: 'continuize', step: 'smooth', apply: ([v]) => windowMean(v, 5) } }] : []) },
  { id: 'compose', status: 'supplied', provenance: 'core baseline', applicability: 'a held variable uses ≥ 2 unary operators', transformation: 'make the operator chain a reusable operator', expectedRetained: 'the chain output', possibleLoss: 'none', hooks: ALL_HOOKS,
    propose: ({ G, accepted }) => accepted.filter((v) => v.ops.length >= 2).flatMap((v) => { const ops = v.ops.map((id) => G.find((o) => o.id === id)).filter((o): o is Op => !!o && o.arity === 1); return ops.length === v.ops.length ? [{ change: 'compose', op: { id: v.ops.join('∘'), arity: 1 as const, family: 'composite' as const, origin: 'composed' as const, parents: [...v.ops], mutation: 'compose', apply: ([x]: number[][]) => ops.reduce((acc, o) => o.apply([acc]), x) } }] : []; }) },
  { id: 'arity-change', status: 'supplied', provenance: 'core baseline', applicability: '≥ 3 base channels', transformation: 'binary → relational n-ary aggregators', expectedRetained: 'relations among channels', possibleLoss: 'identity of the partner channel', hooks: ALL_HOOKS,
    propose: ({ S }) => (S.base.length >= 3 ? [
      { change: 'arity-change', op: { id: 'nearest-other', arity: 'n', family: 'relational', origin: 'arity-change', parents: ['sub'], mutation: 'arity-change', apply: ([x, ...others]) => x.map((z, i) => Math.min(...others.map((o) => Math.abs(z - o[i])))) } },
      { change: 'arity-change', op: { id: 'rank-among', arity: 'n', family: 'relational', origin: 'arity-change', mutation: 'arity-change', apply: ([x, ...others]) => x.map((z, i) => others.filter((o) => o[i] < z).length) } },
    ] : []) },
  { id: 'param-mutation', status: 'supplied', provenance: 'core baseline', applicability: 'a parameterized operator is in G', transformation: 'mutate k±1 or w×2, w/2 (retained mutations of a used operator are splits)', expectedRetained: 'the operator family', possibleLoss: 'none', hooks: ALL_HOOKS,
    propose: ({ G }) => G.filter((g) => g.params?.k || g.params?.w).flatMap((o) => {
      const out: { change: string; op: Op }[] = []; const k = o.params!.k, w = o.params!.w;
      if (k) for (const kk of [k - 1, k + 1]) if (kk >= 2) out.push({ change: 'param-mutation', op: { id: `lag${kk}`, arity: 1, family: 'delayed', origin: 'param-mutation', params: { k: kk }, parents: [o.id], mutation: 'param-mutation', step: 'delay', apply: ([v]) => lagged(v, kk) } });
      if (w) for (const ww of [Math.max(2, Math.round(w / 2)), w * 2]) out.push({ change: 'param-mutation', op: { id: `wmean${ww}`, arity: 1, family: 'windowed', origin: 'param-mutation', params: { w: ww }, parents: [o.id], mutation: 'param-mutation', step: 'window', apply: ([v]) => windowMean(v, ww) } });
      return out;
    }) },
];

/** A composed meta-operator: applies a recurring step sequence in one mutation, searching its parameters jointly. */
export function composeMetaOperator(recipe: string[], status: 'composed' | 'generated', provenance: string, alternatives?: string[][]): MutationOperator {
  const variants = alternatives ?? [recipe];
  const id = `meta:${status === 'generated' ? variants.map((v) => v.join('→')).join('|') : recipe.join('→')}`;
  return {
    id, status, provenance, recipe, applicability: 'always (joint parameter search over base channels)', transformation: `one-step application of the sequence ${variants.map((v) => v.join('→')).join(' or ')}`,
    expectedRetained: 'what the final step retains', possibleLoss: variants.some((v) => v.some((x) => STEP_TEMPLATES[x]?.discrete)) ? 'magnitude within thresholded regions' : 'none beyond the steps', hooks: ALL_HOOKS,
    propose: ({ S, held, base }) => {
      let best: { op: Op; g: number } | null = null;
      for (const rec of variants) {
        const grids = rec.map((st) => STEP_TEMPLATES[st].params(S));
        const combos: number[][] = [[]]; for (const g of grids) { const nx: number[][] = []; for (const c of combos) for (const x of g) nx.push([...c, x]); combos.splice(0, combos.length, ...nx.slice(0, 400)); }
        for (const b of base) for (const combo of combos) {
          const fns = rec.map((st, i) => STEP_TEMPLATES[st].make(combo[i]));
          const vals = fns.reduce((acc, f) => f(acc), b.values);
          if (vals.filter(Number.isFinite).length < vals.length * 0.6) continue;
          const g = criterionGains(S, held.map((h) => h.values), vals);
          const sc = score(g);
          if (!best || sc > best.g) best = { g: sc, op: { id: `${rec.map((st, i) => STEP_TEMPLATES[st].label(combo[i])).join('∘')}`, arity: 1, family: 'composite', origin: 'composed-by-meta-operator', params: Object.fromEntries(combo.map((x, i) => [`p${i}`, x])), discrete: STEP_TEMPLATES[rec[rec.length - 1]].discrete, mutation: id, apply: ([v]) => fns.reduce((acc, f) => f(acc), v) } };
        }
      }
      return best ? [{ change: 'meta-operator-application', op: best.op }] : [];
    },
  };
}

/** Recipe of a variable: step templates of the generated operators it uses, in construction order. */
function recipeOf(v: Var, G: Op[]): string[] { const r = v.ops.map((id) => G.find((o) => o.id === id)?.step).filter((x): x is string => !!x); return r.filter((x, i) => i === 0 || x !== r[i - 1]); }

const FAMILY_OF: Record<string, string> = { discretize: 'threshold', sign: 'threshold', delay: 'delay', tdiff: 'delay-diff', window: 'window', smooth: 'smooth' };

export interface MetaGrammarChange { round: number; op: 'compose-meta-operator' | 'generate-meta-operator' | 'retire-meta-operator'; id: string; recipe: string[]; provenance: string; level: 'D' }

export interface MorphogenesisResult {
  mode: 'grammar-morphogenesis' | 'meta-grammar-morphogenesis';
  mutationRegistry: { id: string; status: string; provenance: string; applicability: string; transformation: string; expectedRetained: string; possibleLoss: string; hooks: Criterion[]; recipe?: string[] }[];
  metaLineage: MetaGrammarChange[];
  roundLog: { round: number; retainedChanges: string[]; held: number }[];
  recipeHistory: Record<string, number>;
  /** Live objects for continuation (e.g. across regimes); not serialized. */
  live?: { grammar: Op[]; registry: MutationOperator[] };
  grammarLineage: { version: number; operators: { id: string; family: string; origin: string }[] }[];
  changes: GrammarChange[];
  accepted: (Omit<Var, 'values'> & { operatorOrigins: Record<string, string>; retainedBecause: Criterion[] })[];
  finalGrammar: { id: string; family: string; origin: string; params?: Record<string, number> }[];
  representationChanged: boolean;
  claim: string;
  values: Record<string, number[]>;
}

export interface MorphogenesisOptions {
  rounds?: number; initial?: Op[]; maxAcceptPerRound?: number; maxHeld?: number;
  /** Mutation operators in force (default: the supplied registry). Remove entries to ablate. */
  registry?: MutationOperator[];
  /** Enable meta-grammar morphogenesis (compose / generate / retire mutation operators). */
  metaGrammar?: boolean;
  /** How often a step sequence must recur among retained variables before it is composed. */
  minRecurrence?: number;
  /** Recipes already seen (e.g. from an earlier regime). */
  recipeHistory?: Record<string, number>;
}

export function grammarMorphogenesis(series: Series, ctx: MorphContext = {}, o: MorphogenesisOptions = {}): MorphogenesisResult {
  const S = makeScorer(series, ctx);
  let G: Op[] = o.initial ?? suppliedOps();
  let registry: MutationOperator[] = [...(o.registry ?? MUTATION_REGISTRY)];
  const metaLineage: MetaGrammarChange[] = [];
  const recipes: Record<string, number> = { ...(o.recipeHistory ?? {}) };
  const macroUse = new Map<string, number>();
  const roundLog: MorphogenesisResult['roundLog'] = [];
  const origin = new Map(G.map((g) => [g.id, g.origin] as const));
  const base: Pool[] = S.base.map((k, i) => ({ id: k, expr: k, values: S.baseVals[i], ops: [] }));
  const accepted: (Var & { retainedBecause: Criterion[] })[] = [];
  const changes: GrammarChange[] = [];
  const lineage: MorphogenesisResult['grammarLineage'] = [{ version: 0, operators: G.map((g) => ({ id: g.id, family: g.family, origin: g.origin })) }];
  const lastUse = new Map<string, number>();
  let version = 0;
  let nextId = 1;
  const held = () => [...base, ...accepted.map((a) => ({ id: a.id, expr: a.id, values: a.values, ops: a.ops }))];
  const accept = (c: { expr: string; values: number[]; ops: string[] }, why: Criterion[]) => {
    const id = `v${nextId++}`;
    accepted.push({ id, expr: c.expr, values: c.values, ops: [...new Set(c.ops)], discrete: isDiscrete(c.values), grammarVersion: version, retainedBecause: why });
    for (const op of c.ops) lastUse.set(op, version);
  };
  for (let round = 0; round < (o.rounds ?? 4); round++) {
    const retainedThisRound: string[] = [];
    // (a) construct with the current grammar
    const H = held();
    const cands = G.flatMap((op) => constructWith(op, H, base)).filter((c) => !accepted.some((a) => a.expr === c.expr));
    const scored = cands.map((c) => ({ c, g: criterionGains(S, H.map((h) => h.values), c.values) })).filter((x) => improves(x.g).length);
    scored.sort((a, b) => score(b.g) - score(a.g) || a.c.ops.length - b.c.ops.length);
    for (const x of scored.slice(0, o.maxAcceptPerRound ?? 1)) accept(x.c, improves(x.g));
    // (b) propose grammar changes
    const env = (): MutationEnv => ({ S, G, held: held(), accepted, residual: residual(S, held().map((h) => h.values)), base });
    const proposed: { change: string; op: Op }[] = [];
    const seenIds = new Set(G.map((g) => g.id));
    for (const m of registry.filter((x) => x.status !== 'retired')) for (const pr of m.propose(env())) if (!seenIds.has(pr.op.id)) { seenIds.add(pr.op.id); proposed.push(pr); }
    for (const p of proposed) {
      if (accepted.length >= (o.maxHeld ?? 8)) { changes.push({ version: version + 1, change: p.change, op: p.op.id, family: p.op.family, origin: p.op.origin, retained: false, retainedBecause: [], bestExpr: null, scores: {}, why: 'held-variable budget reached' }); continue; }
      const Hh = held();
      const cs = constructWith(p.op, Hh, base);
      const sc2 = cs.map((c) => ({ c, g: criterionGains(S, Hh.map((h) => h.values), c.values) })).sort((a, b) => score(b.g) - score(a.g));
      const best = sc2[0];
      const why = best ? improves(best.g) : [];
      const rec: GrammarChange = { version: version + 1, change: p.change, op: p.op.id, family: p.op.family, origin: p.op.origin, retained: why.length > 0, retainedBecause: why, bestExpr: best?.c.expr ?? null, scores: best?.g ?? {}, mutation: p.op.mutation,
        distinctions: p.op.discrete ? DISCRETE_LOSS : p.op.family === 'windowed' ? { retained: ['low-frequency content'], lost: ['variation within the window'], new: ['smoothed level'], unknown: [] } : undefined };
      if (why.length) {
        version++; G = [...G, p.op]; origin.set(p.op.id, p.op.origin);
        accept(best.c, why);
        retainedThisRound.push(`${p.change}:${p.op.id}`);
        if (p.op.mutation?.startsWith('meta:')) macroUse.set(p.op.mutation, round);
        lineage.push({ version, operators: G.map((g) => ({ id: g.id, family: g.family, origin: g.origin })) });
        if (p.change === 'param-mutation' && p.op.parents?.some((pid) => accepted.some((a) => a.ops.includes(pid)))) rec.change = 'split';
      } else rec.why = best ? 'no operational criterion improved beyond threshold' : 'constructs nothing admissible';
      changes.push(rec);
    }
    // (c) drop: variables whose contribution is superseded, then operators with no remaining use
    for (let i = accepted.length - 1; i >= 0; i--) {
      const others = held().filter((h) => h.id !== accepted[i].id);
      const g = criterionGains(S, others.map((h) => h.values), accepted[i].values);
      if (!improves(g).length) {
        const [gone] = accepted.splice(i, 1);
        changes.push({ version: version + 1, change: 'drop-variable (superseded)', op: gone.expr, family: '-', origin: '-', retained: false, retainedBecause: [], bestExpr: null, scores: g, why: 'no longer contributes given the other held variables' });
      }
    }
    // (d) meta-grammar: compose recurring step sequences, generate abstractions, retire idle meta-operators
    if (o.metaGrammar) {
      for (const v of accepted) { const r = recipeOf(v, G); if (r.length >= 2) { const k = r.join('→'); if (!(v as any).counted) { recipes[k] = (recipes[k] ?? 0) + 1; (v as any).counted = true; } } }
      for (const [k, n] of Object.entries(recipes)) {
        const id = `meta:${k}`;
        if (n >= (o.minRecurrence ?? 2) && !registry.some((m) => m.id === id)) {
          const mo = composeMetaOperator(k.split('→'), 'composed', `recurring retained sequence ${k} (×${n})`);
          registry = [...registry, mo]; macroUse.set(mo.id, round);
          metaLineage.push({ round, op: 'compose-meta-operator', id: mo.id, recipe: mo.recipe!, provenance: mo.provenance, level: 'D' });
        }
      }
      // abstraction: composed meta-operators that differ in one step of the same family → generated variant trying both
      const comp = registry.filter((m) => m.status === 'composed' && m.recipe);
      for (let a = 0; a < comp.length; a++) for (let b = a + 1; b < comp.length; b++) {
        const ra = comp[a].recipe!, rb = comp[b].recipe!;
        if (ra.length !== rb.length) continue;
        const diff = ra.map((x, i): number => (x === rb[i] ? 0 : FAMILY_OF[x] && FAMILY_OF[x] === FAMILY_OF[rb[i]] ? 1 : 9)).reduce((s2: number, x: number) => s2 + x, 0);
        if (diff === 1) { const g = composeMetaOperator(ra, 'generated', `abstraction of ${comp[a].id} and ${comp[b].id}`, [ra, rb]); if (!registry.some((m) => m.id === g.id)) { registry = [...registry, g]; macroUse.set(g.id, round); metaLineage.push({ round, op: 'generate-meta-operator', id: g.id, recipe: ra, provenance: g.provenance, level: 'D' }); } }
      }
      for (const m of registry) if ((m.status === 'composed' || m.status === 'generated') && round - (macroUse.get(m.id) ?? round) >= 2) {
        m.status = 'retired'; metaLineage.push({ round, op: 'retire-meta-operator', id: m.id, recipe: m.recipe ?? [], provenance: 'no retained proposal for 2 rounds', level: 'D' });
      }
    }
    roundLog.push({ round, retainedChanges: retainedThisRound, held: accepted.length });
    const used = new Set(accepted.flatMap((a) => a.ops));
    const drop = G.filter((g) => g.origin !== 'supplied' && !used.has(g.id) && version - (lastUse.get(g.id) ?? version) >= 1);
    if (drop.length) {
      version++; G = G.filter((g) => !drop.includes(g));
      for (const d of drop) changes.push({ version, change: 'drop-operator', op: d.id, family: d.family, origin: d.origin, retained: false, retainedBecause: [], bestExpr: null, scores: {}, why: 'no operational contribution in the current variable system' });
      lineage.push({ version, operators: G.map((g) => ({ id: g.id, family: g.family, origin: g.origin })) });
    }
  }
  const generatedOps = G.filter((g) => g.origin !== 'supplied');
  const representationChanged = changes.some((c) => c.retained);
  return {
    mode: o.metaGrammar ? 'meta-grammar-morphogenesis' : 'grammar-morphogenesis', grammarLineage: lineage, changes,
    mutationRegistry: registry.map(({ propose, ...m }) => ({ ...m })), metaLineage, roundLog, recipeHistory: recipes, live: { grammar: G, registry },
    accepted: accepted.map(({ values, ...a }) => ({ ...a, operatorOrigins: Object.fromEntries(a.ops.map((id) => [id, origin.get(id) ?? 'unknown'])) })),
    finalGrammar: G.map((g) => ({ id: g.id, family: g.family, origin: g.origin, params: g.params })),
    representationChanged,
    claim: representationChanged
      ? `the construction grammar changed (${generatedOps.map((g) => g.id).join(', ') || 'operators later dropped'}); retained variables use operators that were not in G_0`
      : 'no grammar change was retained; results are grammar-bounded',
    values: Object.fromEntries(accepted.map((a) => [a.id, a.values])),
  };
}

// ------------------------------------------------------------------ model-class comparison (theory benchmark B)

export interface ModelClassReport {
  modelClass: string; variables: string[];
  predictiveRecovery: number; interventionRecovery: number | null; novelDistinctions: number; representationChange: number; overallError: number; evaluation: string;
}

function fitWeights(X: number[][], y: number[]): number[] {
  const k = X[0]?.length ?? 1;
  const A = Array.from({ length: k }, () => new Array(k).fill(0)); const b = new Array(k).fill(0);
  X.forEach((r, i) => { for (let p = 0; p < k; p++) { b[p] += r[p] * y[i]; for (let q = 0; q < k; q++) A[p][q] += r[p] * r[q]; } });
  for (let p = 0; p < k; p++) A[p][p] += 1e-6 * (A[p][p] + 1);
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < k; c++) { let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; if (Math.abs(M[c][c]) < 1e-14) continue; for (let r = 0; r < k; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let q = c; q <= k; q++) M[r][q] -= f * M[c][q]; } }
  return M.map((r, i) => (Math.abs(r[i]) < 1e-14 ? 0 : r[k] / r[i]));
}

/** Out-of-sample error: fit on alternating 20-row blocks, evaluate the held-out blocks restricted to `evalRows`. */
function cvErr(S: Scorer, feats: number[][], rows: number[], evalRows: number[]): number {
  const ev = new Set(evalRows);
  let tot = 0, cnt = 0;
  for (const fold of [0, 1]) {
    const train = rows.filter((t) => Math.floor(t / 20) % 2 === fold);
    const test = rows.filter((t) => Math.floor(t / 20) % 2 !== fold && ev.has(t));
    if (train.length < feats.length + 10 || !test.length) continue;
    for (const y of S.targets) {
      const w = fitWeights(train.map((t) => [1, ...feats.map((f) => f[t])]), train.map((t) => y[t]));
      const ys = test.map((t) => y[t]); const m = ys.reduce((a, b) => a + b, 0) / ys.length;
      const v = ys.reduce((a, b) => a + (b - m) ** 2, 0) / ys.length || 1;
      const e = test.reduce((a, t) => { const yh = [1, ...feats.map((f) => f[t])].reduce((s, x, j) => s + x * w[j], 0); return a + (y[t] - yh) ** 2; }, 0) / test.length;
      tot += e / v; cnt++;
    }
  }
  return cnt ? tot / cnt : Infinity;
}

/** Compare model classes out of sample (block cross-validation), so held variable count cannot buy the result. */
export function evaluateModelClass(modelClass: string, series: Series, extra: Record<string, number[]>, ctx: MorphContext, novel: number, repChange: number): ModelClassReport {
  const S = makeScorer(series, ctx);
  const feats = [...S.baseVals, ...Object.values(extra)];
  const rows = rowsWhere(S, feats, () => true);
  const post = ctx.changeAt !== undefined ? rows.filter((t) => t >= ctx.changeAt!) : rows;
  const rel = (a: number, b: number) => (a > 0 && Number.isFinite(a) && Number.isFinite(b) ? (a - b) / a : 0);
  const predictiveRecovery = rel(cvErr(S, S.baseVals, rows, post), cvErr(S, feats, rows, post));
  let ivRec: number | null = null;
  if (ctx.interventions?.length) {
    const iv = rows.filter((t) => ctx.interventions!.some((k) => t >= k && t <= k + 6));
    ivRec = rel(cvErr(S, S.baseVals, rows, iv), cvErr(S, feats, rows, iv));
  }
  return { modelClass, variables: Object.keys(extra), predictiveRecovery, interventionRecovery: ivRec, novelDistinctions: novel, representationChange: repChange, overallError: cvErr(S, feats, rows, rows), evaluation: 'out-of-sample (alternating 20-row blocks)' };
}

// ------------------------------------------------------------------ online adaptation across regimes (meta-time)

export type AdaptationMode = 'fixed' | 'grammar-morphogenesis' | 'meta-grammar-morphogenesis';

export interface RegimeReport {
  regime: number; start: number; end: number;
  latencyRounds: number | null; latencyTime: number | null;
  /** in-time: adequate variables found with most of the regime left; too-late: found only after the regime had largely passed; never. */
  timing: 'in-time' | 'too-late' | 'never';
  heldOutRecovery: number[];
  final: { prediction: number; intervention: number | null; observability: number; reachabilityDifferentiation: number; representationChanges: number; metaChanges: number };
  variables: string[];
}

function heldOut(S: Scorer, feats: number[][], train: number[], test: number[]): number {
  const ok = (t: number) => feats.every((f) => Number.isFinite(f[t])) && S.targets.every((y) => Number.isFinite(y[t]));
  const tr = train.filter(ok), te = test.filter(ok);
  if (tr.length < feats.length + 10 || te.length < 5) return Infinity;
  let tot = 0;
  for (const y of S.targets) {
    const w = fitWeights(tr.map((t) => [1, ...feats.map((f) => f[t])]), tr.map((t) => y[t]));
    const ys = te.map((t) => y[t]); const m = ys.reduce((a, b) => a + b, 0) / ys.length; const v = ys.reduce((a, b) => a + (b - m) ** 2, 0) / ys.length || 1;
    tot += te.reduce((a, t) => { const yh = [1, ...feats.map((f) => f[t])].reduce((s2, x, j) => s2 + x * w[j], 0); return a + (y[t] - yh) ** 2; }, 0) / te.length / v;
  }
  return tot / S.targets.length;
}

/**
 * Run a model class online through consecutive regimes. In round r of a regime, selection may only use rows
 * [start, start + r·window); evaluation uses the remaining rows of the regime with weights fitted on the training
 * rows. Grammar (and, for meta-grammar, the mutation registry and recipe history) carries over between regimes.
 */
export function adaptationRun(series: Series, regimes: [number, number][], mode: AdaptationMode, o: { window?: number; tau?: number; maxRounds?: number; interventions?: number[]; lateFraction?: number } = {}): { mode: AdaptationMode; regimes: RegimeReport[]; metaLineage: MetaGrammarChange[]; evaluation: string } {
  const win = o.window ?? 30, tau = o.tau ?? 0.25, maxR = o.maxRounds ?? 6, late = o.lateFraction ?? 0.5;
  let G: Op[] = suppliedOps(); let registry: MutationOperator[] = [...MUTATION_REGISTRY]; let recipes: Record<string, number> = {};
  const metaAll: MetaGrammarChange[] = [];
  const reports: RegimeReport[] = [];
  regimes.forEach(([start, end], ri) => {
    const rec: number[] = []; let lat: number | null = null, latT: number | null = null; let last: MorphogenesisResult | null = null; let lastFeats: number[][] = [];
    const S0 = makeScorer(series, {});
    for (let r = 1; r <= maxR; r++) {
      const until = start + r * win; if (until >= end - 10) break;
      let extra: number[][] = [];
      if (mode !== 'fixed') {
        const res = grammarMorphogenesis(series, { trainFrom: start, trainUntil: until, interventions: (o.interventions ?? []).filter((k) => k >= start && k < until) }, { rounds: 1, initial: G, registry, metaGrammar: mode === 'meta-grammar-morphogenesis', recipeHistory: recipes });
        G = res.live!.grammar; registry = res.live!.registry; recipes = res.recipeHistory; metaAll.push(...res.metaLineage.map((m) => ({ ...m, round: ri * 100 + r })));
        extra = Object.values(res.values); last = res;
      }
      const train = Array.from({ length: until - start }, (_, i) => start + i), test = Array.from({ length: end - 1 - until }, (_, i) => until + i);
      const eb = heldOut(S0, S0.baseVals, train, test), ef = heldOut(S0, [...S0.baseVals, ...extra], train, test);
      const recovery = Number.isFinite(eb) && Number.isFinite(ef) && eb > 0 ? 1 - ef / eb : 0;
      rec.push(recovery); lastFeats = extra;
      if (lat === null && recovery >= tau) { lat = r; latT = until; }
    }
    const len = end - start;
    const timing: RegimeReport['timing'] = lat === null ? 'never' : (latT! - start) / len <= late ? 'in-time' : 'too-late';
    // final-round characteristics on held-out rows
    const finalUntil = start + Math.max(1, rec.length) * win;
    const test = Array.from({ length: Math.max(0, end - 1 - finalUntil) }, (_, i) => finalUntil + i);
    const iv = test.filter((t) => (o.interventions ?? []).some((k) => t >= k && t <= k + 6));
    const train = Array.from({ length: finalUntil - start }, (_, i) => start + i);
    const eb = heldOut(S0, S0.baseVals, train, iv), ef = heldOut(S0, [...S0.baseVals, ...lastFeats], train, iv);
    const q = (x: number) => Math.round(x * 1e3);
    const key = (t: number) => S0.baseVals.map((v) => q(v[t])).join('|');
    const groups = new Map<string, number[]>(); for (const t of test) (groups.get(key(t)) ?? groups.set(key(t), []).get(key(t))!).push(t);
    const pairs: [number, number][] = []; for (const ts of groups.values()) for (let a = 0; a < ts.length && pairs.length < 200; a++) for (let b2 = a + 1; b2 < ts.length; b2++) if (key(ts[a] + 1) !== key(ts[b2] + 1)) pairs.push([ts[a], ts[b2]]);
    const sep = pairs.filter(([a, b2]) => lastFeats.some((f) => Math.abs(f[a] - f[b2]) > 1e-9)).length;
    const lab = test.map((t) => (S0.baseVals.some((v) => { for (let k = 1; k <= 5; k++) if (Math.abs(v[t + k] ?? 0) > 1.5) return true; return false; }) ? 1 : 0));
    const rd = lastFeats.length ? Math.max(0, ...lastFeats.map((f) => { const bn = bins(f); return eta2(test.map((t) => bn[t]), lab); })) : 0;
    reports.push({ regime: ri, start, end, latencyRounds: lat, latencyTime: latT, timing, heldOutRecovery: rec,
      final: { prediction: rec.at(-1) ?? 0, intervention: iv.length >= 8 && Number.isFinite(eb) && Number.isFinite(ef) && eb > 0 ? 1 - ef / eb : null, observability: pairs.length ? sep / pairs.length : 0, reachabilityDifferentiation: rd,
        representationChanges: last ? last.changes.filter((c) => c.retained).length : 0, metaChanges: metaAll.filter((m) => Math.floor(m.round / 100) === ri).length },
      variables: last ? last.accepted.map((a) => a.expr) : [] });
  });
  return { mode, regimes: reports, metaLineage: metaAll, evaluation: `online: selection uses only rows before the round boundary; recovery = 1 − heldOutErr(base+variables)/heldOutErr(base) on the rest of the regime (weights fitted on training rows); adequate when ≥ ${tau}` };
}
