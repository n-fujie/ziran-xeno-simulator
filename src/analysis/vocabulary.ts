// Vocabularies as partial description layers.
// A vocabulary (reason-giving, capability, scientific category, "neural", "trader", "human", …)
// is admitted only in the intervals where it produces a non-redundant difference: where its
// partition of states adds predictive/interventional information about a downstream target
// beyond what the operational base (or another vocabulary) already provides.
import type { State } from './samples.ts';

export interface Vocabulary {
  id: string;
  label?: string;
  /** Where the vocabulary comes from (tradition, author, field). Descriptive. */
  source?: string;
  /** Whether the vocabulary has ignited at all in this state (its conditions of application). */
  applies?: (s: State, t: number) => boolean;
  classify: (s: State, t: number) => string | null;
}

export interface Target { id: string; value: (s: State) => number; lag: number }

type Sample = { t: number; s: State };

function eta2(labels: string[], y: number[]): number {
  const n = y.length; if (n < 3) return 0;
  const m = y.reduce((a, b) => a + b, 0) / n;
  const tot = y.reduce((a, b) => a + (b - m) ** 2, 0);
  if (tot <= 1e-15) return 0;
  const g = new Map<string, number[]>();
  labels.forEach((l, i) => (g.get(l) ?? g.set(l, []).get(l)!).push(y[i]));
  let within = 0;
  for (const v of g.values()) { const mm = v.reduce((a, b) => a + b, 0) / v.length; within += v.reduce((a, b) => a + (b - mm) ** 2, 0); }
  const k = g.size;
  const r2 = 1 - within / tot;
  return n - k > 0 ? 1 - (1 - r2) * (n - 1) / (n - k) : 0; // adjusted for partition size
}

function aligned(samples: Sample[], target: Target, fs: ((s: State, t: number) => string | null)[], applies?: (s: State, t: number) => boolean) {
  const labels: string[][] = fs.map(() => []); const y: number[] = []; const ts: number[] = [];
  for (let i = 0; i + target.lag < samples.length; i++) {
    const { s, t } = samples[i];
    if (applies && !applies(s, t)) continue;
    const ls = fs.map((f) => f(s, t));
    if (ls.some((l) => l === null)) continue;
    ls.forEach((l, j) => labels[j].push(l!));
    y.push(target.value(samples[i + target.lag].s)); ts.push(t);
  }
  return { labels, y, ts };
}

export interface VocabularyEvaluation {
  vocabulary: string; target: string; appliedFraction: number; gain: number; gainBeyondBase: number | null;
  nonRedundant: boolean; intervals: [number, number][]; windows: { t0: number; t1: number; gain: number; applied: number }[];
}

export function evaluateVocabulary(samples: Sample[], v: Vocabulary, target: Target, base?: Vocabulary, eps = 0.02, windows = 6): VocabularyEvaluation {
  const applied = samples.filter((x) => !v.applies || v.applies(x.s, x.t)).length / Math.max(1, samples.length);
  const A = aligned(samples, target, [v.classify], v.applies);
  const gain = eta2(A.labels[0], A.y);
  let beyond: number | null = null;
  if (base) {
    const J = aligned(samples, target, [base.classify, v.classify], v.applies);
    const joint = J.labels[0].map((l, i) => l + '∧' + J.labels[1][i]);
    beyond = eta2(joint, J.y) - eta2(J.labels[0], J.y);
  }
  const wlen = Math.ceil(samples.length / windows);
  const ws: VocabularyEvaluation['windows'] = [];
  for (let w = 0; w < windows; w++) {
    const part = samples.slice(w * wlen, Math.min(samples.length, (w + 1) * wlen + target.lag));
    if (part.length <= target.lag + 2) continue;
    const X = aligned(part, target, [v.classify], v.applies);
    const ap = part.filter((x) => !v.applies || v.applies(x.s, x.t)).length / part.length;
    ws.push({ t0: part[0].t, t1: part[part.length - 1].t, gain: X.y.length > 3 ? eta2(X.labels[0], X.y) : 0, applied: ap });
  }
  const intervals: [number, number][] = ws.filter((w) => w.applied > 0.5 && w.gain > eps).map((w) => [w.t0, w.t1]);
  const nonRedundant = (beyond ?? gain) > eps;
  return { vocabulary: v.id, target: target.id, appliedFraction: applied, gain, gainBeyondBase: beyond, nonRedundant, intervals, windows: ws };
}

function nmi(a: string[], b: string[]): number {
  const n = a.length; if (!n) return 0;
  const c = new Map<string, number>(), ca = new Map<string, number>(), cb = new Map<string, number>();
  a.forEach((x, i) => { const k = x + '\u0000' + b[i]; c.set(k, (c.get(k) ?? 0) + 1); ca.set(x, (ca.get(x) ?? 0) + 1); cb.set(b[i], (cb.get(b[i]) ?? 0) + 1); });
  const H = (m: Map<string, number>) => -[...m.values()].reduce((s, v) => s + (v / n) * Math.log(v / n), 0);
  let I = 0;
  for (const [k, v] of c) { const [x, y] = k.split('\u0000'); I += (v / n) * Math.log((v / n) / ((ca.get(x)! / n) * (cb.get(y)! / n))); }
  const ha = H(ca), hb = H(cb);
  return ha + hb > 0 ? (2 * I) / (ha + hb) : 1;
}

export interface VocabularyComparison {
  a: string; b: string; target: string; agreement: number; gainA: number; gainB: number; aBeyondB: number; bBeyondA: number;
  verdict: 'isolate-same-difference' | 'a-redundant-given-b' | 'b-redundant-given-a' | 'isolate-different-differences' | 'neither-operative';
}

/** Where do two vocabularies isolate the same operational difference, and where does one become redundant? */
export function compareVocabularies(samples: Sample[], A: Vocabulary, B: Vocabulary, target: Target, eps = 0.02): VocabularyComparison {
  const both = (s: State, t: number) => (!A.applies || A.applies(s, t)) && (!B.applies || B.applies(s, t));
  const X = aligned(samples, target, [A.classify, B.classify], both);
  const [la, lb] = X.labels;
  const ga = eta2(la, X.y), gb = eta2(lb, X.y);
  const joint = la.map((l, i) => l + '∧' + lb[i]);
  const gj = eta2(joint, X.y);
  const aB = gj - gb, bA = gj - ga;
  const agreement = nmi(la, lb);
  let verdict: VocabularyComparison['verdict'];
  if (ga <= eps && gb <= eps) verdict = 'neither-operative';
  else if (agreement > 0.8 && aB <= eps && bA <= eps) verdict = 'isolate-same-difference';
  else if (aB <= eps && gb > eps) verdict = 'a-redundant-given-b';
  else if (bA <= eps && ga > eps) verdict = 'b-redundant-given-a';
  else verdict = 'isolate-different-differences';
  return { a: A.id, b: B.id, target: target.id, agreement, gainA: ga, gainB: gb, aBeyondB: aB, bBeyondA: bA, verdict };
}

// ------------------------------------------------------------------ multi-axis non-redundancy profile
//
// Prediction is one form of non-redundancy. A vocabulary may be predictively redundant yet interventionally
// necessary, observationally useful yet causally irrelevant downstream, and so on. Each axis has its own
// operational target computed from the trace; an axis without enough data is reported as not evaluable.

import type { Trace } from '../core/trace.ts';
import { sampleStates } from './samples.ts';

export const AXES = ['predictive', 'interventional', 'reachability', 'observational', 'penetration', 'temporal', 'reorganization'] as const;
export type Axis = (typeof AXES)[number];

export interface AxisResult { evaluable: boolean; gain: number | null; beyondBase: number | null; nonRedundant: boolean | null; n: number; target: string }

export interface VocabularyProfile {
  vocabulary: string;
  axes: Record<Axis, AxisResult>;
  appliedFraction: number;
  /** Derived shorthand only — the profile is the result. */
  summary: string;
}

function eta2Adj(labels: string[], y: number[]): number { return eta2(labels, y); }

export function vocabularyProfile(tr: Trace, v: Vocabulary, o: { base?: Vocabulary; dt?: number; window?: number; predictiveTarget?: Target; eps?: number } = {}): VocabularyProfile {
  const dt = o.dt ?? 1, W = o.window ?? 5, eps = o.eps ?? 0.02;
  const samples = sampleStates(tr, dt);
  const ev = tr.events;
  const inWin = (t: number, kind: (e: any) => boolean) => ev.filter((e) => e.t > t && e.t <= t + W && kind(e));
  const axisTargets: Record<Axis, { name: string; points: { t: number; s: Record<string, number>; y: number }[] }> = {
    predictive: { name: o.predictiveTarget?.id ?? 'storage changes in next window', points: [] },
    interventional: { name: 'downstream effects of interventions', points: [] },
    reachability: { name: 'probe-relative reach fractions', points: [] },
    observational: { name: 'detected fraction of differences in next window', points: [] },
    penetration: { name: 'coupling-mediated effects in next window', points: [] },
    temporal: { name: 'time to next ignition onset', points: [] },
    reorganization: { name: 'reorganizations in next window', points: [] },
  };
  const stateAt = (t: number) => { let best = samples[0]; for (const x of samples) { if (x.t > t) break; best = x; } return best?.s ?? {}; };
  const detectedAny = (seq: number) => Object.values(tr.epistemic).some((m) => m[seq] === 'detected');
  for (let i = 0; i < samples.length; i++) {
    const { t, s } = samples[i];
    if (v.applies && !v.applies(s, t)) continue;
    const pt = o.predictiveTarget;
    axisTargets.predictive.points.push({ t, s, y: pt ? (samples[i + pt.lag] ? pt.value(samples[i + pt.lag].s) : NaN) : inWin(t, (e) => e.kind === 'effect').length });
    const effs = inWin(t, (e) => e.kind === 'effect');
    if (effs.length) axisTargets.observational.points.push({ t, s, y: effs.filter((e) => detectedAny(e.seq)).length / effs.length });
    axisTargets.penetration.points.push({ t, s, y: effs.filter((e) => String(e.via).startsWith('coupling:')).length });
    const nextOnset = ev.find((e) => e.t > t && e.kind === 'ignition' && e.onset);
    if (nextOnset) axisTargets.temporal.points.push({ t, s, y: nextOnset.t - t });
    axisTargets.reorganization.points.push({ t, s, y: inWin(t, (e) => e.kind === 'reorganization').length });
  }
  // interventions: label at the intervention time vs size of its downstream closure
  const fwd = new Map<number, number[]>(); for (const e of ev) for (const c of (e.cause ?? []) as number[]) (fwd.get(c) ?? fwd.set(c, []).get(c)!).push(e.seq);
  const closure = (s0: number) => { const seen = new Set([s0]); const q = [s0]; while (q.length && seen.size < 500) { for (const k of fwd.get(q.shift()!) ?? []) if (!seen.has(k)) { seen.add(k); q.push(k); } } return seen.size - 1; };
  for (const e of ev) if (e.kind === 'intervention') { const s = stateAt(e.t - 1e-9); if (!v.applies || v.applies(s, e.t)) axisTargets.interventional.points.push({ t: e.t, s, y: closure(e.seq) }); }
  for (const r of tr.probeRelativeReachability) { const s = stateAt(r.t); if (!v.applies || v.applies(s, r.t)) axisTargets.reachability.points.push({ t: r.t, s, y: Object.values(r.probes as Record<string, { fraction: number }>).reduce((a, p) => a + p.fraction, 0) }); }
  const axes = {} as Record<Axis, AxisResult>;
  for (const ax of AXES) {
    const pts = axisTargets[ax].points.filter((p) => Number.isFinite(p.y));
    const labs = pts.map((p) => v.classify(p.s, p.t));
    const ok = pts.filter((_, i) => labs[i] !== null);
    const L = labs.filter((l): l is string => l !== null);
    const ys = ok.map((p) => p.y);
    const varY = ys.length > 1 ? ys.reduce((a, b) => a + (b - ys.reduce((x, z) => x + z, 0) / ys.length) ** 2, 0) : 0;
    if (ok.length < 6 || varY < 1e-12 || new Set(L).size < 2) { axes[ax] = { evaluable: false, gain: null, beyondBase: null, nonRedundant: null, n: ok.length, target: axisTargets[ax].name }; continue; }
    const gain = eta2Adj(L, ys);
    let beyond: number | null = null;
    if (o.base) { const bl = ok.map((p) => o.base!.classify(p.s, p.t) ?? '∅'); beyond = eta2Adj(bl.map((b, i) => b + '∧' + L[i]), ys) - eta2Adj(bl, ys); }
    axes[ax] = { evaluable: true, gain, beyondBase: beyond, nonRedundant: (beyond ?? gain) > eps, n: ok.length, target: axisTargets[ax].name };
  }
  const applied = samples.filter((x) => !v.applies || v.applies(x.s, x.t)).length / Math.max(1, samples.length);
  const summary = AXES.map((a) => `${a}: ${axes[a].evaluable ? (axes[a].nonRedundant ? 'non-redundant' : 'redundant') : 'not evaluable'}`).join('; ');
  return { vocabulary: v.id, axes, appliedFraction: applied, summary };
}
