// Provisional operational bundle recovery from unlabeled traces.
// Claims take one form only: provisional operational bundles recovered under specified trace schemas, feature constructions, temporal windows, and grouping procedures.
//
// Input: a raw operational trace, under some trace schema. Rule ids are replaced by opaque tokens, so no
// human / AI / trader / body / institution label is available. Recurring operational bundles are searched
// for with *registered feature constructors* (not one fixed feature set): node features (timing, ignition
// rate, feedback, penetration, reorganization, reachability effects, observation / resource dependence,
// temporal scale) and edge features (storage coupling, ignition co-occurrence, shared observation, shared
// resources). Constructors can be added or removed; discovery can be run under several feature subsets and
// trace schemas, and bundles are classified as stable / feature-sensitive / schema-sensitive / unstable.
// Discovered bundles are provisional: they carry their source schema, features, window, procedure,
// resampling and perturbation stability and a downstream profile, and get neutral ids only.
import type { Trace } from '../core/trace.ts';
import { sha256 } from '../core/hash.ts';
import type { MetaEntry } from '../core/meta.ts';

export interface FeatureContext {
  tr: Trace; rules: string[]; idx: Map<string, number>; n: number;
  reads: Set<string>[]; writes: Set<string>[]; ignitionTimes: number[][]; clockOf: string[];
  consumes: Set<string>[]; stats: Record<string, number>[];
}

export interface FeatureConstructor {
  id: string; kind: 'node' | 'edge'; origin: MetaEntry['origin']; description: string;
  /** node: one number per rule; edge: n×n non-negative weights. */
  compute(ctx: FeatureContext): number[] | number[][];
}

function context(tr: Trace): FeatureContext {
  const ev = tr.events;
  const rules = [...new Set(ev.filter((e) => e.kind === 'ignition').map((e) => e.rule as string))].sort();
  const idx = new Map(rules.map((r, i) => [r, i]));
  const n = rules.length;
  const reads = rules.map(() => new Set<string>()), writes = rules.map(() => new Set<string>()), consumes = rules.map(() => new Set<string>());
  const ignitionTimes: number[][] = rules.map(() => []);
  const clockOf = rules.map((r) => tr.initial.rules.find((x) => x.id === r)?.clock ?? '?');
  const stats = rules.map(() => ({ ignitions: 0, onsets: 0, delay: 0, obsReads: 0, feedback: 0, penetration: 0, reorganizations: 0, reach: 0, blocked: 0 }) as Record<string, number>);
  const opRule = new Map<number, number>();
  for (const e of ev) {
    if (e.kind === 'ignition' && !e.suppressed) { const i = idx.get(e.rule)!; stats[i].ignitions++; if (e.onset) stats[i].onsets++; ignitionTimes[i].push(e.t); for (const k of [...(e.reads ?? []), ...(e.opReads ?? [])] as string[]) { reads[i].add(k); if (k.startsWith('o:')) stats[i].obsReads++; } }
    if (e.kind === 'operation') { const i = idx.get(e.rule); if (i !== undefined) { opRule.set(e.seq, i); stats[i].delay += e.delay ?? 0; } }
    if (e.kind === 'effect') {
      // attribute via the operation if the schema kept it, otherwise via the effect's `via` field
      let i: number | undefined; for (const c of e.cause ?? []) if (opRule.has(c)) i = opRule.get(c);
      if (i === undefined && String(e.via ?? '').startsWith('rule:')) i = idx.get(String(e.via).slice(5));
      if (i !== undefined) { writes[i].add('a:' + e.address); if (typeof e.delta === 'number' && e.delta < 0 && /energy|budget|cash|pool|resource|attention/.test(e.address)) consumes[i].add(e.address); }
    }
    if (e.kind === 'reorganization') { let i: number | undefined; for (const c of e.cause ?? []) if (opRule.has(c)) i = opRule.get(c); if (i === undefined && String(e.via ?? '').startsWith('rule:')) i = idx.get(String(e.via).slice(5)); if (i !== undefined) stats[i].reorganizations++; }
    if (e.kind === 'feedback') { const i = idx.get(e.originRule); if (i !== undefined) stats[i].feedback++; }
    if (e.kind === 'blocked') { const i = idx.get(e.rule); if (i !== undefined) { stats[i].blocked++; consumes[i].add(e.resource); } }
    if (e.kind === 'effect' && String(e.via).startsWith('coupling:')) for (const c of e.cause ?? []) { const p = ev[c]; if (p?.kind === 'effect' && String(p.via).startsWith('rule:')) { const i = idx.get(String(p.via).slice(5)); if (i !== undefined) stats[i].penetration++; } }
    if (String(e.kind).startsWith('reachability') && typeof e.trigger === 'number') { const ig = ev[e.trigger]; const i = ig ? idx.get(ig.rule) : undefined; if (i !== undefined) stats[i].reach++; }
  }
  return { tr, rules, idx, n, reads, writes, ignitionTimes, clockOf, consumes, stats };
}

const node = (id: string, description: string, f: (c: FeatureContext, i: number) => number): FeatureConstructor => ({ id, kind: 'node', origin: 'supplied', description, compute: (c) => c.rules.map((_, i) => f(c, i)) });

function idfEdges(c: FeatureContext, sets: (i: number) => Set<string>, sets2: (j: number) => Set<string>, filter: (k: string) => boolean = () => true): number[][] {
  const pop = new Map<string, number>(); for (let i = 0; i < c.n; i++) for (const k of new Set([...sets(i), ...sets2(i)])) if (filter(k)) pop.set(k, (pop.get(k) ?? 0) + 1);
  const W = Array.from({ length: c.n }, () => new Array(c.n).fill(0));
  for (let i = 0; i < c.n; i++) for (let j = 0; j < c.n; j++) if (i !== j) for (const k of sets(i)) if (filter(k) && sets2(j).has(k)) { const w = Math.log((c.n + 1) / (pop.get(k) ?? 1)); W[i][j] += w; W[j][i] += w; }
  return W;
}

export const FEATURE_CONSTRUCTORS: FeatureConstructor[] = [
  node('timing', 'mean inter-ignition interval', (c, i) => { const t = c.ignitionTimes[i]; return t.length > 1 ? (t[t.length - 1] - t[0]) / (t.length - 1) : c.tr.meta.horizon; }),
  node('ignition-rate', 'ignitions per unit time', (c, i) => c.stats[i].ignitions / Math.max(1, c.tr.meta.horizon)),
  node('onset-pattern', 'fraction of ignitions that are onsets', (c, i) => c.stats[i].ignitions ? c.stats[i].onsets / c.stats[i].ignitions : 0),
  node('feedback-dependence', 'feedback loops originating in the rule', (c, i) => c.stats[i].feedback),
  node('reachability-effects', 'reachability analyses triggered', (c, i) => c.stats[i].reach),
  node('penetration', 'coupling-mediated downstream effects', (c, i) => c.stats[i].penetration),
  node('reorganization', 'reorganizations caused', (c, i) => c.stats[i].reorganizations),
  node('observation-dependence', 'observation reads per ignition', (c, i) => (c.stats[i].ignitions ? c.stats[i].obsReads / c.stats[i].ignitions : 0)),
  node('resource-dependence', 'resources consumed or blocking', (c, i) => c.consumes[i].size + c.stats[i].blocked),
  node('temporal-scale', 'period of the rule clock', (c, i) => Number((c.tr.final.clocks as { id: string; period: number }[]).find((k) => k.id === c.clockOf[i])?.period ?? 1)),
  { id: 'coupling', kind: 'edge', origin: 'supplied', description: 'storage written by one rule and read or written by another (inverse-popularity weighted)', compute: (c) => idfEdges(c, (i) => c.writes[i], (j) => new Set([...c.reads[j], ...c.writes[j]])) },
  { id: 'observation-sharing', kind: 'edge', origin: 'supplied', description: 'shared observation channels (inverse-popularity weighted)', compute: (c) => idfEdges(c, (i) => c.reads[i], (j) => c.reads[j], (k) => k.startsWith('o:')).map((r) => r.map((x) => 0.5 * x)) },
  { id: 'resource-sharing', kind: 'edge', origin: 'supplied', description: 'shared resource dependencies', compute: (c) => idfEdges(c, (i) => c.consumes[i], (j) => c.consumes[j]) },
  { id: 'ignition-co-occurrence', kind: 'edge', origin: 'supplied', description: 'ignitions at the same engine time (Jaccard of ignition-time sets)', compute: (c) => {
    const S = c.ignitionTimes.map((t) => new Set(t.map((x) => Math.round(x * 1e3))));
    return S.map((a, i) => S.map((b, j) => { if (i === j || !a.size || !b.size) return 0; let inter = 0; for (const x of a) if (b.has(x)) inter++; return inter / (a.size + b.size - inter); }));
  } },
];

export const DEFAULT_FEATURES = ['coupling', 'observation-sharing', 'ignition-rate', 'onset-pattern', 'timing', 'observation-dependence', 'feedback-dependence', 'penetration', 'reorganization', 'reachability-effects'];

export interface Bundle {
  id: string; members: string[]; features: Record<string, number>;
  provisional: {
    sourceSchema: string; featureConstructors: string[]; temporalWindow: [number, number]; procedure: string;
    stabilityResampling: number | null; stabilityPerturbation: number | null;
    downstreamProfile: { penetration: number; reorganization: number; ruleLevelPenetration: number; ruleLevelReorganization: number } | null;
  };
}

export interface EmergenceResult { tokens: number; bundles: Bundle[]; key: Record<string, string>; method: string; features: string[]; schema: string }

const PROCEDURE = 'opaque tokens; weighted graph = Σ edge constructors + 0.3·(node-feature similarity); weighted label propagation (deterministic order, threshold minWeight)';

function group(ctx: FeatureContext, registry: FeatureConstructor[], features: string[], minW: number): number[][] {
  const n = ctx.n;
  const W = Array.from({ length: n }, () => new Array(n).fill(0));
  const nodeVecs: number[][] = [];
  for (const id of features) {
    const f = registry.find((x) => x.id === id); if (!f) continue;
    const out = f.compute(ctx);
    if (f.kind === 'edge') (out as number[][]).forEach((r, i) => r.forEach((w, j) => (W[i][j] += w)));
    else nodeVecs.push(out as number[]);
  }
  if (nodeVecs.length) {
    const norm = nodeVecs.map((v) => Math.max(1e-9, ...v.map(Math.abs)));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const d = Math.sqrt(nodeVecs.reduce((s, v, q) => s + ((v[i] - v[j]) / norm[q]) ** 2, 0));
      const sim = Math.max(0, 1 - d / Math.sqrt(nodeVecs.length)) * 0.3; W[i][j] += sim; W[j][i] += sim;
    }
  }
  const lab = Array.from({ length: n }, (_, i) => i);
  for (let it = 0; it < 30; it++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      const score = new Map<number, number>();
      for (let j = 0; j < n; j++) if (W[i][j] > minW) score.set(lab[j], (score.get(lab[j]) ?? 0) + W[i][j]);
      if (!score.size) continue;
      const best = [...score.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
      if (best !== lab[i] && score.get(best)! > (score.get(lab[i]) ?? 0)) { lab[i] = best; changed = true; }
    }
    if (!changed) break;
  }
  const g = new Map<number, number[]>(); lab.forEach((l, i) => (g.get(l) ?? g.set(l, []).get(l)!).push(i));
  return [...g.values()];
}

const tok = (r: string) => 'u' + sha256('opaque|' + r).slice(0, 8);
const jacc = (a: string[], b: string[]) => { const B = new Set(b); const i = a.filter((x) => B.has(x)).length; return i / (a.length + b.length - i || 1); };
const matchIn = (m: string[], bs: { members: string[] }[], th = 0.8) => bs.some((b) => jacc(m, b.members) >= th);

function restrictTime(tr: Trace, keep: (t: number) => boolean): Trace {
  const map = new Map<number, number>(); const evs = [];
  for (const e of tr.events) if (keep(e.t)) { map.set(e.seq, evs.length); evs.push(e); }
  return { ...tr, events: evs.map((e, i) => ({ ...e, seq: i, cause: ((e.cause ?? []) as number[]).filter((c) => map.has(c)).map((c) => map.get(c)!) })) };
}

export function discoverBundles(tr: Trace, o: { features?: string[]; registry?: FeatureConstructor[]; minWeight?: number; resamples?: number; stability?: boolean } = {}): EmergenceResult {
  const registry = o.registry ?? FEATURE_CONSTRUCTORS;
  const features = (o.features ?? DEFAULT_FEATURES).filter((f) => registry.some((r) => r.id === f));
  const ctx = context(tr);
  const minW = o.minWeight ?? 0.35;
  const T = ctx.rules.map(tok);
  const key = Object.fromEntries(ctx.rules.map((r) => [tok(r), r]));
  const groups = group(ctx, registry, features, minW);
  const schema = String((tr.meta.run as any)?.traceSchema ?? 'engine-full');
  let bundles: Bundle[] = groups.map((m) => ({
    id: '', members: m.map((i) => T[i]).sort(),
    features: Object.fromEntries(Object.keys(ctx.stats[0] ?? {}).map((k) => [k, m.reduce((s, i) => s + ctx.stats[i][k], 0) / m.length])),
    provisional: { sourceSchema: schema, featureConstructors: features, temporalWindow: [0, tr.meta.horizon] as [number, number], procedure: PROCEDURE, stabilityResampling: null, stabilityPerturbation: null, downstreamProfile: null },
  })).sort((a, b) => b.members.length - a.members.length || a.members[0].localeCompare(b.members[0])).map((b, i) => ({ ...b, id: `B${i + 1}` }));
  if (o.stability !== false && ctx.n > 1) {
    // resampling: drop alternating time blocks (deterministic), rediscover, check presence
    const H = tr.meta.horizon, R = o.resamples ?? 4;
    const reps = Array.from({ length: R }, (_, r) => { const sub = restrictTime(tr, (t) => Math.floor((t / H) * 10) % R !== r); const c2 = context(sub); return group(c2, registry, features, minW).map((m) => m.map((i) => tok(c2.rules[i])).sort()); });
    // perturbation: drop each feature constructor in turn
    const perts = features.length > 1 ? features.map((f) => group(ctx, registry, features.filter((x) => x !== f), minW).map((m) => m.map((i) => T[i]).sort())) : [];
    const bundleOf = new Map(bundles.flatMap((b) => b.members.map((m) => [m, b.id] as const)));
    const fwd = new Map<number, number[]>(); for (const e of tr.events) for (const c of (e.cause ?? []) as number[]) (fwd.get(c) ?? fwd.set(c, []).get(c)!).push(e.seq);
    const closure = (s0: number) => { const seen = new Set([s0]); let fr = [s0]; for (let d = 0; d < 4 && fr.length; d++) { const nx: number[] = []; for (const s of fr) for (const k of fwd.get(s) ?? []) if (!seen.has(k)) { seen.add(k); nx.push(k); } fr = nx; } return seen.size - 1; };
    const igs = tr.events.filter((e) => e.kind === 'ignition' && !e.suppressed).slice(0, 3000);
    const pen = igs.map((e) => closure(e.seq)), reo = igs.map((e) => tr.events.some((x) => x.kind === 'reorganization' && x.t >= e.t && x.t <= e.t + 5) ? 1 : 0);
    const bl = igs.map((e) => bundleOf.get(tok(e.rule)) ?? '∅'), rl = igs.map((e) => e.rule as string);
    const prof = { penetration: eta(bl, pen), reorganization: eta(bl, reo), ruleLevelPenetration: eta(rl, pen), ruleLevelReorganization: eta(rl, reo) };
    bundles = bundles.map((b) => ({ ...b, provisional: { ...b.provisional,
      stabilityResampling: reps.filter((rs) => matchIn(b.members, rs.map((m) => ({ members: m })))).length / R,
      stabilityPerturbation: perts.length ? perts.filter((ps) => matchIn(b.members, ps.map((m) => ({ members: m })))).length / perts.length : null,
      downstreamProfile: prof } }));
  }
  return { tokens: ctx.n, bundles, key, method: PROCEDURE, features, schema };
}

function eta(labels: string[], y: number[]): number {
  const n = y.length; if (n < 4) return 0; const m = y.reduce((a, b) => a + b, 0) / n; const tot = y.reduce((a, b) => a + (b - m) ** 2, 0); if (tot < 1e-12) return 0;
  const g = new Map<string, number[]>(); labels.forEach((l, i) => (g.get(l) ?? g.set(l, []).get(l)!).push(y[i]));
  let w = 0; for (const v of g.values()) { const mm = v.reduce((a, b) => a + b, 0) / v.length; w += v.reduce((a, b) => a + (b - mm) ** 2, 0); }
  return 1 - w / tot;
}

export interface LabelComparison { label: string; members: number; bestBundle: string | null; jaccard: number; isolatesBundle: boolean; addsBeyondBundles: boolean; verdict: string }

/**
 * Compare a later labelling (e.g. 'trader', 'human', 'body') with the discovered bundles.
 * isolatesBundle: some bundle coincides with the label class (Jaccard ≥ 0.8).
 * addsBeyondBundles: the label partition explains operational features beyond the bundle partition.
 */
export function compareLabels(res: EmergenceResult, tr: Trace, label: (ruleId: string) => string | null, eps = 0.05): LabelComparison[] {
  const tokens = Object.keys(res.key);
  const labOf = new Map(tokens.map((t) => [t, label(res.key[t])]));
  const bundleOf = new Map(res.bundles.flatMap((b) => b.members.map((m) => [m, b.id] as const)));
  const classes = [...new Set([...labOf.values()].filter((x): x is string => x !== null))].sort();
  const feat = new Map<string, number[]>(); for (const t of tokens) feat.set(t, [0, 0, 0]);
  const tokOf = new Map(tokens.map((t) => [res.key[t], t]));
  for (const e of tr.events) if (e.kind === 'ignition' && !e.suppressed) { const f = feat.get(tokOf.get(e.rule)!); if (f) { f[0]++; f[1] += ((e.reads ?? []) as string[]).filter((k) => k.startsWith('o:')).length; f[2] += e.onset ? 1 : 0; } }
  const labelled = tokens.filter((t) => labOf.get(t) !== null);
  const adds = [0, 1, 2].some((k) => { const y = labelled.map((t) => Math.log1p(feat.get(t)![k])); const b = labelled.map((t) => bundleOf.get(t) ?? '∅'); return eta(b.map((x, i) => x + '∧' + labOf.get(labelled[i])), y) - eta(b, y) > eps; });
  return classes.map((c) => {
    const mem = tokens.filter((t) => labOf.get(t) === c);
    let best: string | null = null, bj = 0;
    for (const b of res.bundles) { const j = jacc(mem, b.members); if (j > bj) { bj = j; best = b.id; } }
    const iso = bj >= 0.8;
    return { label: c, members: mem.length, bestBundle: best, jaccard: bj, isolatesBundle: iso, addsBeyondBundles: adds,
      verdict: iso ? (adds ? 'label isolates a recovered provisional bundle and adds operational difference beyond the bundle partition' : 'label isolates a recovered provisional bundle (redundant as extra vocabulary given the bundles)')
        : 'no recovered provisional bundle corresponds to this label' };
  });
}

// ------------------------------------------------------------------ stability across feature subsets and trace schemas

export type BundleStability = 'stable' | 'feature-sensitive' | 'schema-sensitive' | 'unstable';

export interface MultiEmergence {
  runs: { schema: string; features: string[]; bundles: string[][] }[];
  bundles: { members: string[]; labelsLater?: string[]; stability: BundleStability; presentInFeatureRuns: number; presentInSchemaRuns: number; totalFeatureRuns: number; totalSchemaRuns: number }[];
  canonical: null;
  note: string;
}

/**
 * Run discovery under several feature subsets (on the reference schema) and several trace projections
 * (with the default features). No clustering is treated as canonical.
 */
export function multiEmergence(traces: { schema: string; tr: Trace }[], featureSubsets: string[][], o: { th?: number } = {}): MultiEmergence {
  const th = o.th ?? 0.8;
  const ref = traces[0];
  const fr = featureSubsets.map((fs) => ({ schema: ref.schema, features: fs, bundles: discoverBundles(ref.tr, { features: fs, stability: false }).bundles.map((b) => b.members) }));
  const sr = traces.map((x) => ({ schema: x.schema, features: DEFAULT_FEATURES, bundles: discoverBundles(x.tr, { stability: false }).bundles.map((b) => b.members) }));
  const all = [...fr, ...sr];
  const uniq: string[][] = [];
  for (const r of all) for (const b of r.bundles) if (!uniq.some((u) => jacc(u, b) >= th)) uniq.push(b);
  const inR = (m: string[], rs: typeof all) => rs.filter((r) => r.bundles.some((b) => jacc(m, b) >= th)).length;
  const bundles = uniq.map((m) => {
    const f = inR(m, fr), s = inR(m, sr);
    const stability: BundleStability = f === fr.length && s === sr.length ? 'stable' : s === sr.length ? 'feature-sensitive' : f === fr.length ? 'schema-sensitive' : 'unstable';
    return { members: m, stability, presentInFeatureRuns: f, presentInSchemaRuns: s, totalFeatureRuns: fr.length, totalSchemaRuns: sr.length };
  }).sort((a, b) => b.members.length - a.members.length);
  return { runs: all, bundles, canonical: null, note: 'no grouping is canonical; a bundle present under only one schema or feature subset is not robustly emergent' };
}
