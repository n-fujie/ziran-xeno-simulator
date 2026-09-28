// Counterfactual runner and the generic non-redundancy test.
//
// Non-redundancy is the framework's central test: a distinction / category / dimension /
// medium / address is non-redundant in a configuration iff removing, merging or substituting
// it changes operational outcomes beyond seed-level variability.
import type { WorldSpec, EngineOptionsLike } from './run-types.ts';
import { Engine } from './engine.ts';
import { exportTrace, type Trace, type RunRecord } from './trace.ts';
import { applyPerturbations, type Perturbation } from './perturbations.ts';
import { canonical } from './hash.ts';
import { kindOf } from './values.ts';

export function runSpec(spec: WorldSpec, opts: EngineOptionsLike = {}, run?: RunRecord): Trace {
  const e = new Engine(spec, opts);
  e.run(spec.horizon);
  return exportTrace(e, run);
}

/** Run without trace (fast); returns the final engine for metric extraction. */
export function runLight(spec: WorldSpec): Engine {
  const e = new Engine(spec, { trace: false, reachability: false });
  return e.run(spec.horizon);
}

export interface TraceDiff {
  identical: boolean;
  divergence: { seq: number; t: number; a?: string; b?: string } | null;
  /** Euclidean distance over *scalar* storage only — a convenience, not a universal metric. */
  scalarDistance: number;
  perAddress: Record<string, { a: unknown; b: unknown; d: number | null; kind: string }>;
  /** Description-space differences: final S and the S_t → S_{t+1} lineage signatures. */
  stateSpace: { identical: boolean; finalOnlyA: Record<string, string[]>; finalOnlyB: Record<string, string[]>; lineageOnlyA: string[]; lineageOnlyB: string[] };
  /** Emergent-reachability branch grammars present in one run only. */
  emergent: { grammarOnlyA: string[]; grammarOnlyB: string[] };
  probeIdentical: boolean;
  operationallyDifferent: boolean;
  probes: Record<string, { a: boolean; b: boolean; aFirst: number | null; bFirst: number | null }>;
  ignitions: Record<string, { a: number; b: number }>;
}

const sig = (e: any) => e ? `${e.kind}:${e.rule ?? e.address ?? (e.apparatus ? e.apparatus + '/' + (e.channel ?? '') : e.key ?? '')}@${e.t}` : undefined;

export function diffTraces(a: Trace, b: Trace): TraceDiff {
  let divergence: TraceDiff['divergence'] = null;
  const n = Math.max(a.events.length, b.events.length);
  for (let i = 0; i < n; i++) {
    const x = a.events[i], y = b.events[i];
    const val = (e: any) => (e?.kind === 'effect' ? ':' + canonical(e.after) : e?.kind === 'detection' ? ':' + canonical(e.value) : '');
    const sx = sig(x) + val(x), sy = sig(y) + val(y);
    if (sx !== sy) { divergence = { seq: i, t: Math.min(x?.t ?? Infinity, y?.t ?? Infinity), a: sig(x), b: sig(y) }; break; }
  }
  const keys = new Set([...Object.keys(a.final.state), ...Object.keys(b.final.state)]);
  const perAddress: TraceDiff['perAddress'] = {};
  let d2 = 0;
  for (const k of [...keys].sort()) {
    const x = a.final.state[k], y = b.final.state[k];
    if (typeof x === 'number' && typeof y === 'number') { if (Math.abs(x - y) > 1e-9) { perAddress[k] = { a: x, b: y, d: y - x, kind: 'scalar' }; d2 += (y - x) ** 2; } }
    else if (canonical(x ?? null) !== canonical(y ?? null)) perAddress[k] = { a: x ?? null, b: y ?? null, d: null, kind: kindOf(y ?? x) };
  }
  const probes: TraceDiff['probes'] = {};
  for (const k of new Set([...Object.keys(a.probes), ...Object.keys(b.probes)])) {
    probes[k] = { a: !!a.probes[k]?.first || a.probes[k]?.first === 0, b: !!b.probes[k]?.first || b.probes[k]?.first === 0, aFirst: a.probes[k]?.first ?? null, bFirst: b.probes[k]?.first ?? null };
  }
  const count = (t: Trace) => { const c: Record<string, number> = {}; for (const e of t.events) if (e.kind === 'ignition' && !e.suppressed) c[e.rule] = (c[e.rule] ?? 0) + 1; return c; };
  const ca = count(a), cb = count(b);
  const ignitions: TraceDiff['ignitions'] = {};
  for (const k of new Set([...Object.keys(ca), ...Object.keys(cb)])) if ((ca[k] ?? 0) !== (cb[k] ?? 0)) ignitions[k] = { a: ca[k] ?? 0, b: cb[k] ?? 0 };
  const onlyIn = (p: Record<string, string[]>, q: Record<string, string[]>) => Object.fromEntries(Object.entries(p).map(([c, v]) => [c, v.filter((x) => !(q[c] ?? []).includes(x))]).filter(([, v]) => (v as string[]).length));
  const fa = onlyIn(a.final.space ?? {}, b.final.space ?? {}), fb = onlyIn(b.final.space ?? {}, a.final.space ?? {});
  const la = (a.stateSpaceLineage ?? []).map((x) => x.signature), lb = (b.stateSpaceLineage ?? []).map((x) => x.signature);
  const lineageOnlyA = la.filter((x) => !lb.includes(x)), lineageOnlyB = lb.filter((x) => !la.includes(x));
  const ga = new Set((a.emergentReachability ?? []).flatMap((x: any) => x.branchGrammar)), gb = new Set((b.emergentReachability ?? []).flatMap((x: any) => x.branchGrammar));
  const stateSpace = { identical: !Object.keys(fa).length && !Object.keys(fb).length && canonical(la) === canonical(lb), finalOnlyA: fa, finalOnlyB: fb, lineageOnlyA, lineageOnlyB };
  const emergent = { grammarOnlyA: [...ga].filter((g) => !gb.has(g)) as string[], grammarOnlyB: [...gb].filter((g) => !ga.has(g)) as string[] };
  const probeIdentical = Object.values(probes).every((p) => p.aFirst === p.bFirst);
  const operationallyDifferent = divergence !== null || !stateSpace.identical || emergent.grammarOnlyA.length > 0 || emergent.grammarOnlyB.length > 0 || Object.keys(perAddress).length > 0;
  return { identical: divergence === null, divergence, scalarDistance: Math.sqrt(d2), perAddress, stateSpace, emergent, probeIdentical, operationallyDifferent, probes, ignitions };
}

export type Metric = (e: Engine) => Record<string, number>;

export interface NonRedundancyResult {
  subject: string;
  redundant: boolean;
  /** Per-metric mean difference (variant − base) and seed spread. */
  perMetric: Record<string, { base: number; variant: number; delta: number; spread: number; nonRedundant: boolean }>;
  seeds: number[];
  tolerance: number;
}

/**
 * Is `subject` non-redundant? Compare base vs variant over seeds. A metric counts as changed when
 * |Δmean| exceeds max(tolerance, k·seed-spread).
 */
export function nonRedundancy(o: {
  subject: string; base: WorldSpec; variant: Perturbation[] | ((s: WorldSpec) => WorldSpec); metric: Metric;
  seeds?: number[]; tolerance?: number; k?: number;
}): NonRedundancyResult {
  const seeds = o.seeds ?? [o.base.seed];
  const tol = o.tolerance ?? 1e-6;
  const k = o.k ?? 2;
  const mk = (s: WorldSpec) => (typeof o.variant === 'function' ? o.variant(s) : applyPerturbations(s, o.variant));
  const B: Record<string, number>[] = [], V: Record<string, number>[] = [];
  for (const sd of seeds) {
    const b = { ...o.base, seed: sd };
    B.push(o.metric(runLight(b)));
    V.push(o.metric(runLight(mk(b))));
  }
  const perMetric: NonRedundancyResult['perMetric'] = {};
  for (const m of Object.keys(B[0])) {
    const bs = B.map((x) => x[m]), vs = V.map((x) => x[m] ?? NaN);
    const mb = mean(bs), mv = mean(vs);
    const spread = Math.max(sd(bs), sd(vs));
    const delta = mv - mb;
    perMetric[m] = { base: mb, variant: mv, delta, spread, nonRedundant: !Number.isFinite(delta) || Math.abs(delta) > Math.max(tol, k * spread) };
  }
  return { subject: o.subject, redundant: !Object.values(perMetric).some((x) => x.nonRedundant), perMetric, seeds, tolerance: tol };
}

export const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
export const sd = (xs: number[]) => { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); };
