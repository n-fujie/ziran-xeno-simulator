// Minimal responsibility points.
// A responsibility point is a *location* where an earlier difference changes later possibilities in a
// non-redundant way. It is found by counterfactual variation (presence/absence, timing shift, resource
// change, coupling change, boundary change, observation change). The result is a structured difference
// profile — changed values, probes, reachable branches, timing, observation conditions, resource
// dependencies, penetration, reorganization and fragility location. There is no universal metric: no
// Euclidean distance over heterogeneous state is used. A domain may supply its own metric explicitly.
// The profile is never collapsed into one score, and it is never assigned to the nearest person, agent
// or institution.
import type { WorldSpec, Intervention } from '../core/types.ts';
import type { Trace } from '../core/trace.ts';
import { runSpec } from '../core/counterfactual.ts';
import { canonical } from '../core/hash.ts';
import { kindOf } from '../core/values.ts';
import { fragilityProfile, type Region } from './fragility.ts';

export type VariantKind = 'absence' | 'timing' | 'resource' | 'coupling' | 'boundary' | 'observation';

export interface StructuredDifference {
  applicable: boolean;
  changedValues: { address: string; kind: string; base: unknown; variant: unknown }[];
  /** Kept for compatibility: ids of probes whose first satisfaction changed. */
  probesChanged: string[];
  changedBranches: { probeSignaturesOnlyBase: string[]; probeSignaturesOnlyVariant: string[]; emergentGrammarOnlyBase: string[]; emergentGrammarOnlyVariant: string[]; stateSpace: string[] };
  changedTiming: { probe?: string; rule?: string; base: number | null; variant: number | null }[];
  changedObservation: { apparatus: string; status: string; base: number; variant: number }[];
  changedResourceDependencies: { resource: string; blockedBase: number; blockedVariant: number }[];
  changedPenetration: { onlyBase: string[]; onlyVariant: string[] };
  changedReorganization: { onlyBase: string[]; onlyVariant: string[] };
  changedFragilityLocation: { base: string | null; variant: string | null } | null;
  /** Only present when the domain explicitly declares a metric meaningful. */
  domainMetric?: number;
  /** Categories in which a difference was found (a derived view — not a score). */
  differsIn: string[];
}

export interface ResponsibilityPoint {
  ignition: number; rule: string; occurrence: number; t: number;
  locus: { rule: string; wrote: string[]; read: string[]; couplings: string[]; channels: string[] };
  profile: Record<VariantKind, StructuredDifference>;
  nonRedundant: boolean;
}

export interface ResponsibilityOptions {
  candidates?: { rule: string; occurrence: number }[];
  /** Restrict value comparison to these storage keys (default: all). */
  watch?: string[];
  dt?: number;
  resource?: { address: string; delta: number };
  /** Analysis boundary: only ignitions whose writes fall inside these prefixes are candidate loci. */
  boundary?: string[];
  regions?: Region[];
  /** Optional domain metric, used only because the domain declares it meaningful. */
  domainMetric?: (base: Trace, variant: Trace) => number;
  /** Trace schema projection applied to every trace before comparison (see meta/trace-schema.ts). */
  project?: (t: Trace) => Trace;
}

function sigs(tr: Trace): { probe: string[]; emergent: string[]; space: string[]; reorg: string[]; pen: string[] } {
  return {
    probe: [...new Set(tr.probeRelativeReachability.flatMap((r: any) => r.signatures))],
    emergent: [...new Set(tr.emergentReachability.flatMap((r: any) => r.branchGrammar))],
    space: tr.stateSpaceLineage.map((x) => x.signature),
    reorg: [...new Set(tr.events.filter((e) => e.kind === 'reorganization').map((e) => `${e.target}:${e.op}:${e.key}`))],
    pen: [...new Set(tr.events.filter((e) => e.kind === 'effect' && String(e.via).startsWith('coupling:')).map((e) => `${e.via}→${e.address}`))],
  };
}
const minus = (a: string[], b: string[]) => a.filter((x) => !b.includes(x));

export function structuredDifference(base: Trace, variant: Trace, o: { watch?: string[]; regions?: Region[]; domainMetric?: (a: Trace, b: Trace) => number; selfRule?: string } = {}): StructuredDifference {
  const keys = o.watch ?? [...new Set([...Object.keys(base.final.state), ...Object.keys(variant.final.state)])].sort();
  const changedValues = keys.filter((k) => {
    const a = base.final.state[k], b = variant.final.state[k];
    return typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) > 1e-9 : canonical(a ?? null) !== canonical(b ?? null);
  }).map((k) => ({ address: k, kind: kindOf(variant.final.state[k] ?? base.final.state[k]), base: base.final.state[k] ?? null, variant: variant.final.state[k] ?? null }));
  const probesChanged = Object.keys(base.probes).filter((p) => base.probes[p]?.first !== variant.probes[p]?.first);
  const sb = sigs(base), sv = sigs(variant);
  const firstIgn = (tr: Trace) => { const m: Record<string, number> = {}; for (const e of tr.events) if (e.kind === 'ignition' && !e.suppressed && m[e.rule] === undefined) m[e.rule] = e.t; return m; };
  const fb = firstIgn(base), fv = firstIgn(variant);
  const changedTiming = [
    ...probesChanged.map((p) => ({ probe: p, base: base.probes[p]?.first ?? null, variant: variant.probes[p]?.first ?? null })),
    ...[...new Set([...Object.keys(fb), ...Object.keys(fv)])].sort().filter((r) => r !== o.selfRule && fb[r] !== fv[r]).map((r) => ({ rule: r, base: fb[r] ?? null, variant: fv[r] ?? null })),
  ];
  const changedObservation: StructuredDifference['changedObservation'] = [];
  for (const app of new Set([...Object.keys(base.summary.epistemic), ...Object.keys(variant.summary.epistemic)])) {
    const A = base.summary.epistemic[app] ?? {}, B = variant.summary.epistemic[app] ?? {};
    for (const st of new Set([...Object.keys(A), ...Object.keys(B)])) if ((A[st] ?? 0) !== (B[st] ?? 0)) changedObservation.push({ apparatus: app, status: st, base: A[st] ?? 0, variant: B[st] ?? 0 });
  }
  const blocked = (tr: Trace) => { const m: Record<string, number> = {}; for (const e of tr.events) if (e.kind === 'blocked') m[e.resource] = (m[e.resource] ?? 0) + 1; return m; };
  const bb = blocked(base), bv = blocked(variant);
  const changedResourceDependencies = [...new Set([...Object.keys(bb), ...Object.keys(bv)])].sort().filter((r) => (bb[r] ?? 0) !== (bv[r] ?? 0)).map((r) => ({ resource: r, blockedBase: bb[r] ?? 0, blockedVariant: bv[r] ?? 0 }));
  let changedFragilityLocation: StructuredDifference['changedFragilityLocation'] = null;
  if (o.regions?.length) {
    const lead = (tr: Trace) => { const P = fragilityProfile(tr, o.regions!); const r = Object.entries(P).sort((a, b) => b[1].failures - a[1].failures || b[1].variance - a[1].variance)[0]; return r && (r[1].failures > 0 || r[1].variance > 0) ? r[0] : null; };
    const a = lead(base), b = lead(variant); if (a !== b) changedFragilityLocation = { base: a, variant: b };
  }
  const d: StructuredDifference = {
    applicable: true, changedValues, probesChanged,
    changedBranches: { probeSignaturesOnlyBase: minus(sb.probe, sv.probe), probeSignaturesOnlyVariant: minus(sv.probe, sb.probe), emergentGrammarOnlyBase: minus(sb.emergent, sv.emergent), emergentGrammarOnlyVariant: minus(sv.emergent, sb.emergent), stateSpace: [...minus(sb.space, sv.space), ...minus(sv.space, sb.space)] },
    changedTiming, changedObservation, changedResourceDependencies,
    changedPenetration: { onlyBase: minus(sb.pen, sv.pen), onlyVariant: minus(sv.pen, sb.pen) },
    changedReorganization: { onlyBase: minus(sb.reorg, sv.reorg), onlyVariant: minus(sv.reorg, sb.reorg) },
    changedFragilityLocation, differsIn: [],
  };
  if (o.domainMetric) d.domainMetric = o.domainMetric(base, variant);
  const cb = d.changedBranches;
  d.differsIn = [
    changedValues.length && 'values', probesChanged.length && 'probes',
    (cb.probeSignaturesOnlyBase.length || cb.probeSignaturesOnlyVariant.length || cb.emergentGrammarOnlyBase.length || cb.emergentGrammarOnlyVariant.length || cb.stateSpace.length) && 'branches',
    changedTiming.length && 'timing', changedObservation.length && 'observation', changedResourceDependencies.length && 'resource-dependencies',
    (d.changedPenetration.onlyBase.length || d.changedPenetration.onlyVariant.length) && 'penetration',
    (d.changedReorganization.onlyBase.length || d.changedReorganization.onlyVariant.length) && 'reorganization', changedFragilityLocation && 'fragility-location',
  ].filter(Boolean) as string[];
  return d;
}

const NA: StructuredDifference = {
  applicable: false, changedValues: [], probesChanged: [], changedBranches: { probeSignaturesOnlyBase: [], probeSignaturesOnlyVariant: [], emergentGrammarOnlyBase: [], emergentGrammarOnlyVariant: [], stateSpace: [] },
  changedTiming: [], changedObservation: [], changedResourceDependencies: [], changedPenetration: { onlyBase: [], onlyVariant: [] }, changedReorganization: { onlyBase: [], onlyVariant: [] }, changedFragilityLocation: null, differsIn: [],
};

export function responsibilityPoints(spec: WorldSpec, tr: Trace, o: ResponsibilityOptions = {}): ResponsibilityPoint[] {
  const P = o.project ?? ((t: Trace) => t);
  const trP = P(tr);
  const ev = trP.events;
  const noReach = { reachability: false } as const;
  const baseTr = P(runSpec(spec, noReach));
  const cands = o.candidates ?? pickCandidates(trP);
  const out: ResponsibilityPoint[] = [];
  for (const c of cands) {
    const ign = ev.find((e) => e.kind === 'ignition' && e.rule === c.rule && e.occurrence === c.occurrence && !e.suppressed);
    if (!ign) continue;
    const op = ev.find((e) => e.kind === 'operation' && e.ignition === ign.seq);
    // Under schemas that drop operations, fall back to effects attributed to the rule by `via`.
    const wrote = op ? [...new Set(ev.filter((e) => e.kind === 'effect' && (e.cause as number[]).includes(op.seq)).map((e) => e.address))]
      : [...new Set(ev.filter((e) => e.kind === 'effect' && e.via === 'rule:' + c.rule && e.t >= ign.t && e.t <= ign.t + (spec.rules.find((r) => r.id === c.rule)?.delay ?? 0) + 1e-9).map((e) => e.address))];
    if (o.boundary && !wrote.some((w) => o.boundary!.some((p) => w.startsWith(p)))) continue;
    const read = ((ign.reads ?? []) as string[]);
    const couplings = (tr.initial.couplings as { id: string; from: string }[]).filter((k) => wrote.includes(k.from)).map((k) => k.id);
    const channels = read.filter((k) => k.startsWith('o:') && !k.endsWith('/*')).map((k) => k.slice(2));
    const variants: Record<VariantKind, WorldSpec | null> = {
      absence: withIv(spec, { id: 'rp-absence', kind: 'suppress', rule: c.rule, occurrence: c.occurrence }),
      timing: withIv(spec, { id: 'rp-timing', kind: 'shift', rule: c.rule, occurrence: c.occurrence, dt: o.dt ?? 2 }),
      resource: o.resource ? withIv(spec, { id: 'rp-resource', t: Math.max(0, ign.t - 1e-6), kind: 'add', address: o.resource.address, value: o.resource.delta }) : null,
      coupling: couplings.length ? { ...spec, couplings: (spec.couplings ?? []).map((k) => (couplings.includes(k.id) ? { ...k, enabled: false } : k)) } : null,
      boundary: channels.length ? mapChannels(spec, channels, (ch) => ({ ...ch, boundary: ['∅/'] })) : null,
      observation: channels.length ? mapChannels(spec, channels, (ch) => ({ ...ch, resolution: Math.max(1e-3, (ch.resolution ?? 0) * 4 || 1) })) : null,
    };
    const profile = {} as ResponsibilityPoint['profile'];
    let nr = false;
    for (const [k, s] of Object.entries(variants) as [VariantKind, WorldSpec | null][]) {
      if (!s) { profile[k] = NA; continue; }
      const d = structuredDifference(baseTr, P(runSpec(s, noReach)), { watch: o.watch, regions: o.regions, domainMetric: o.domainMetric, selfRule: c.rule });
      profile[k] = d;
      if (d.differsIn.length) nr = true;
    }
    out.push({ ignition: ign.seq, rule: c.rule, occurrence: c.occurrence, t: ign.t, locus: { rule: c.rule, wrote, read, couplings, channels }, profile, nonRedundant: nr });
  }
  return out;
}

function withIv(s: WorldSpec, iv: Intervention): WorldSpec { return { ...s, interventions: [...(s.interventions ?? []), iv] }; }
function mapChannels(s: WorldSpec, ids: string[], f: (c: any) => any): WorldSpec {
  return { ...s, apparatus: (s.apparatus ?? []).map((a) => ({ ...a, channels: a.channels.map((c) => (ids.includes(a.id + '/' + c.id) ? f(c) : c)) })) };
}

/** Default candidates: the first two onset ignitions of each rule. */
function pickCandidates(tr: Trace): { rule: string; occurrence: number }[] {
  const seen: Record<string, number> = {};
  const out: { rule: string; occurrence: number }[] = [];
  for (const e of tr.events) if (e.kind === 'ignition' && e.onset && !e.suppressed && (seen[e.rule] = (seen[e.rule] ?? 0) + 1) <= 2) out.push({ rule: e.rule, occurrence: e.occurrence });
  return out.slice(0, 16);
}
