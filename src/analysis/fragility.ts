// Fragility Transfer: local improvement ≠ global improvement.
// Compare a baseline and a strengthened configuration per region and detect whether the
// strengthening moved risk, created dependencies, moved resource burden, reduced observability
// elsewhere, created delayed instability, or concentrated/distributed failure.
import type { Trace } from '../core/trace.ts';
import { sc } from '../core/values.ts';

export interface Region {
  id: string;
  prefixes: string[];
  /** Addresses whose depletion is a resource burden for this region. */
  resources?: string[];
  /** Safety limits: margin = distance to limit (in `dir`). */
  limits?: { address: string; limit: number; dir: 'above' | 'below' }[];
  /** Probes whose satisfaction counts as failure in this region. */
  failureProbes?: string[];
}

export interface FragilityProfile {
  variance: number; lateVariance: number; earlyVariance: number; margin: number | null; dependency: number;
  resourceBurden: number; observability: number | null; failures: number;
}

const inRegion = (r: Region, a: string) => r.prefixes.some((p) => a.startsWith(p));

export function fragilityProfile(tr: Trace, regions: Region[]): Record<string, FragilityProfile> {
  const H = tr.meta.horizon;
  const out: Record<string, FragilityProfile> = {};
  for (const r of regions) {
    const vals: number[] = [], early: number[] = [], late: number[] = [];
    let margin: number | null = null, burden = 0, detected = 0, total = 0, failures = 0;
    const writers = new Set<string>(), readers = new Set<string>();
    for (const e of tr.events) {
      if (e.kind === 'effect' && inRegion(r, e.address)) {
        const x = typeof e.after === 'number' ? e.after : NaN;
        if (Number.isFinite(x)) { vals.push(x); (e.t < H / 3 ? early : e.t > (2 * H) / 3 ? late : []).push(x); }
        if (r.resources?.includes(e.address) && typeof e.delta === 'number' && e.delta < 0) burden -= e.delta;
        for (const l of r.limits ?? []) if (l.address === e.address && Number.isFinite(x)) {
          const m = l.dir === 'above' ? l.limit - x : x - l.limit;
          margin = margin === null ? m : Math.min(margin, m);
        }
        writers.add(e.via);
        total++;
        if (Object.values(tr.epistemic).some((m) => m[e.seq] === 'detected')) detected++;
      }
      if (e.kind === 'ignition' && (e.reads as string[]).some((k) => k.startsWith('a:') && inRegion(r, k.slice(2)))) readers.add(e.rule);
      if (e.kind === 'blocked' && inRegion(r, e.resource)) failures++;
    }
    for (const p of r.failureProbes ?? []) if (tr.probes[p]?.first !== null && tr.probes[p]?.first !== undefined) failures++;
    const inbound = (tr.final.couplings as { from: string; to: string; enabled?: boolean }[]).filter((c) => c.enabled !== false && inRegion(r, c.to) && !inRegion(r, c.from)).length;
    out[r.id] = {
      variance: variance(vals), earlyVariance: variance(early), lateVariance: variance(late), margin,
      dependency: inbound + [...writers].filter((w) => !r.prefixes.some((p) => w.includes(p))).length + readers.size,
      resourceBurden: burden, observability: total ? detected / total : null, failures,
    };
  }
  return out;
}

export interface Transfer { region: string; kind: string; base: number | null; variant: number | null }

// ------------------------------------------------------------------ dependency profile

export const DEPENDENCY_CATEGORIES = ['resource', 'observation', 'coupling', 'temporal', 'physical', 'institutional', 'address'] as const;
export type DependencyCategory = (typeof DEPENDENCY_CATEGORIES)[number];

/**
 * What a region depends on, by category (sets of descriptors). Institutional dependencies are only those
 * declared by tags/clock labels in the configuration — the core has no notion of institution.
 */
export function dependencyProfile(tr: Trace, r: Region): Record<DependencyCategory, string[]> {
  const D = Object.fromEntries(DEPENDENCY_CATEGORIES.map((c) => [c, new Set<string>()])) as Record<DependencyCategory, Set<string>>;
  const ev = tr.events;
  const rules = new Map(tr.initial.rules.map((x) => [x.id, x]));
  const clocks = new Map(((tr.final.clocks as { id: string; label?: string }[]) ?? []).map((c) => [c.id, c]));
  const meta = (tr.initial.addresses ?? {}) as Record<string, { medium?: string; tags?: string[] }>;
  const opsWriting = new Set<number>();
  const writers = new Set<string>();
  for (const e of ev) if (e.kind === 'effect' && inRegion(r, e.address)) {
    for (const c of e.cause ?? []) if (ev[c]?.kind === 'operation') { opsWriting.add(c); writers.add(ev[c].rule); }
    if (String(e.via).startsWith('coupling:')) { D.coupling.add(String(e.via).slice(9)); if (e.medium) D.physical.add(e.medium); }
    if (meta[e.address]?.medium) D.physical.add(meta[e.address].medium!);
  }
  for (const e of ev) if (e.kind === 'effect' && typeof e.delta === 'number' && e.delta < 0 && (e.cause ?? []).some((c: number) => opsWriting.has(c)) && !inRegion(r, e.address) && (meta[e.address]?.tags?.includes('resource') || /energy|budget|cash|pool|resource/.test(e.address))) D.resource.add(e.address);
  for (const e of ev) if (e.kind === 'blocked' && writers.has(e.rule)) D.resource.add(e.resource);
  for (const app of (tr.final.apparatus as { id: string; channels: { id: string; reads: string[]; cost?: { address: string } }[] }[]) ?? []) for (const ch of app.channels)
    if (ch.reads.some((x) => r.prefixes.some((p) => x.startsWith(p) || (x.endsWith('*') && p.startsWith(x.slice(0, -1)))))) { D.observation.add(`${app.id}/${ch.id}`); if (ch.cost) D.resource.add(ch.cost.address); }
  for (const w of writers) {
    const rule = rules.get(w); if (!rule) continue;
    const ck = clocks.get(rule.clock); D.temporal.add(`${rule.clock}${ck?.label ? ' (' + ck.label + ')' : ''}${rule.delay ? ' +delay ' + rule.delay : ''}`);
    if (rule.tags?.some((t) => /institution|procedure|policy|law|permission/.test(t)) || /institution|office|policy|procedure/.test(ck?.label ?? '')) D.institutional.add(w);
  }
  for (const e of ev) if (e.kind === 'ignition' && writers.has(e.rule)) for (const k of e.reads as string[]) if (k.startsWith('a:') && !inRegion(r, k.slice(2))) D.address.add(k.slice(2));
  return Object.fromEntries(DEPENDENCY_CATEGORIES.map((c) => [c, [...D[c]].sort()])) as Record<DependencyCategory, string[]>;
}

export type FragilityFate = 'disappears' | 'moves' | 'concentrates' | 'distributes' | 'delays' | 'becomes-unobservable' | 'stays';

export interface FragilityTransferReport {
  target: string;
  targetImproved: boolean;
  targetChange: Record<string, { base: number | null; variant: number | null }>;
  transfers: Transfer[];
  failureConcentration: { base: number; variant: number; change: 'concentrated' | 'distributed' | 'unchanged' };
  verdict: 'local-improvement-with-fragility-transfer' | 'local-improvement-no-transfer-detected' | 'no-local-improvement';
  profiles: { base: Record<string, FragilityProfile>; variant: Record<string, FragilityProfile> };
  /** Per region and dependency category: descriptors added / removed by the change. */
  dependencyChanges: Record<string, Partial<Record<DependencyCategory, { added: string[]; removed: string[] }>>>;
  /** What happened to fragility (several may hold at once). */
  fates: FragilityFate[];
}

/** `improved(base, variant)` decides local improvement of the target region (default: less variance or larger margin or fewer failures). */
export function fragilityTransfer(base: Trace, variant: Trace, regions: Region[], target: string,
  improved?: (b: FragilityProfile, v: FragilityProfile) => boolean): FragilityTransferReport {
  const B = fragilityProfile(base, regions), V = fragilityProfile(variant, regions);
  const tb = B[target], tv = V[target];
  const imp = improved ? improved(tb, tv)
    : tv.failures < tb.failures || tv.variance < tb.variance * 0.95 || (tb.margin !== null && tv.margin !== null && tv.margin > tb.margin + 1e-9);
  const transfers: Transfer[] = [];
  const rel = (a: number, b: number, f = 1.1) => b > a * f + 1e-9;
  for (const r of regions) {
    if (r.id === target) continue;
    const b = B[r.id], v = V[r.id];
    if (rel(b.variance, v.variance)) transfers.push({ region: r.id, kind: 'risk-moved', base: b.variance, variant: v.variance });
    if (b.margin !== null && v.margin !== null && v.margin < b.margin - 1e-9) transfers.push({ region: r.id, kind: 'margin-reduced', base: b.margin, variant: v.margin });
    if (v.dependency > b.dependency) transfers.push({ region: r.id, kind: 'new-dependency', base: b.dependency, variant: v.dependency });
    if (rel(b.resourceBurden, v.resourceBurden)) transfers.push({ region: r.id, kind: 'resource-burden-moved', base: b.resourceBurden, variant: v.resourceBurden });
    if (b.observability !== null && v.observability !== null && v.observability < b.observability - 0.05) transfers.push({ region: r.id, kind: 'observability-reduced', base: b.observability, variant: v.observability });
    if (rel(b.lateVariance, v.lateVariance, 1.25) && !rel(b.earlyVariance, v.earlyVariance, 1.25)) transfers.push({ region: r.id, kind: 'delayed-instability', base: b.lateVariance, variant: v.lateVariance });
    if (v.failures > b.failures) transfers.push({ region: r.id, kind: 'failure-moved', base: b.failures, variant: v.failures });
  }
  const gb = gini(regions.map((r) => B[r.id].failures)), gv = gini(regions.map((r) => V[r.id].failures));
  const change = gv > gb + 0.05 ? 'concentrated' : gv < gb - 0.05 ? 'distributed' : 'unchanged';
  if (imp && change === 'concentrated') transfers.push({ region: '*', kind: 'failure-concentrated', base: gb, variant: gv });
  const targetChange: FragilityTransferReport['targetChange'] = {};
  for (const k of Object.keys(tb) as (keyof FragilityProfile)[]) targetChange[k] = { base: tb[k], variant: tv[k] };
  const dependencyChanges: FragilityTransferReport['dependencyChanges'] = {};
  for (const r of regions) {
    const a = dependencyProfile(base, r), b = dependencyProfile(variant, r);
    const ch: Partial<Record<DependencyCategory, { added: string[]; removed: string[] }>> = {};
    for (const c of DEPENDENCY_CATEGORIES) { const added = b[c].filter((x) => !a[c].includes(x)), removed = a[c].filter((x) => !b[c].includes(x)); if (added.length || removed.length) ch[c] = { added, removed }; }
    if (Object.keys(ch).length) dependencyChanges[r.id] = ch;
    for (const [c, d] of Object.entries(ch)) if (r.id !== target && d.added.length) transfers.push({ region: r.id, kind: `new-${c}-dependency`, base: a[c as DependencyCategory].length, variant: b[c as DependencyCategory].length });
  }
  const fates: FragilityFate[] = [];
  const totFail = (P: Record<string, FragilityProfile>) => Object.values(P).reduce((s, x) => s + x.failures, 0);
  const worsened = transfers.filter((t) => t.region !== '*' && t.region !== target);
  if (imp && !worsened.length && totFail(V) <= totFail(B)) fates.push('disappears');
  if (imp && worsened.length) fates.push('moves');
  if (change === 'concentrated') fates.push('concentrates');
  if (change === 'distributed') fates.push('distributes');
  if (transfers.some((t) => t.kind === 'delayed-instability')) fates.push('delays');
  if (worsened.some((t) => { const vb = B[t.region].observability, vv = V[t.region].observability; return vv !== null && (vv < 0.5 || (vb !== null && vv < vb - 0.05)); })) fates.push('becomes-unobservable');
  if (!fates.length) fates.push('stays');
  return {
    dependencyChanges, fates,
    target, targetImproved: imp, targetChange, transfers, failureConcentration: { base: gb, variant: gv, change },
    verdict: !imp ? 'no-local-improvement' : transfers.length ? 'local-improvement-with-fragility-transfer' : 'local-improvement-no-transfer-detected',
    profiles: { base: B, variant: V },
  };
}

export function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
}

export function gini(xs: number[]): number {
  const s = xs.reduce((a, b) => a + b, 0);
  if (!s) return 0;
  let acc = 0;
  for (const a of xs) for (const b of xs) acc += Math.abs(a - b);
  return acc / (2 * xs.length * s);
}
