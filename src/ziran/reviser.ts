// Ziran self-revision / autonomous sensor morphogenesis.
//
// If the current observation configuration cannot distinguish states that later diverge under the
// same intervention, the system may revise its own apparatus. Candidate revisions are generated from
// the apparatus's own morphology — resolution, boundary, disaggregation (scale), constructed variables,
// external memory, sampling regime, and placement *grown along the physical coupling graph* (a sensor
// can only extend to where the world is physically connected to what it already touches). Candidates
// are tested on retained physical snapshots of the aliased pair (re-measurement).
//
// Resolving the alias is not enough. A revision may hide another difference, raise resource burden,
// reduce temporal resolution elsewhere, add coupling fragility or new dependencies, or move risk. Each
// candidate is therefore also evaluated by counterfactual lookahead along several downstream dimensions,
// and the default research behaviour exposes the Pareto set rather than silently picking the cheapest.
// Selection policy is configurable (including no selection). Every revision records the three Ziran
// questions and the full trade-off table.
import type { ApparatusSpec, ChannelSpec, Ctx, Emit, RuleSpec, AliasingRecord, LookaheadResult } from '../core/types.ts';
import { quantize } from '../core/engine.ts';
import { canonical } from '../core/hash.ts';

type Snap = Record<string, unknown>;

function readOn(ch: ChannelSpec, snap: Snap | null): number | string | null {
  if (!snap) return null;
  const addrs = ch.reads.flatMap((r) => (r.endsWith('*') ? Object.keys(snap).filter((a) => a.startsWith(r.slice(0, -1))).sort() : [r]))
    .filter((a) => !ch.boundary || ch.boundary.some((p) => a.startsWith(p)));
  if (!addrs.length) return null;
  const raw = addrs.map((a) => snap[a]);
  if (raw.some((v) => v !== undefined && typeof v !== 'number')) return canonical(raw);
  const vals = raw.map((v) => (v as number | undefined) ?? 0);
  const agg = ch.aggregate ?? 'mean';
  const v = agg === 'sum' ? vals.reduce((a, b) => a + b, 0) : agg === 'max' ? Math.max(...vals) : agg === 'min' ? Math.min(...vals)
    : agg === 'first' ? vals[0] : agg === 'spread' ? Math.max(...vals) - Math.min(...vals) : vals.reduce((a, b) => a + b, 0) / vals.length;
  if (ch.range && (v < ch.range[0] || v > ch.range[1])) return null;
  return quantize(v, ch.resolution ?? 0);
}

const differs = (a: number | string | null, b: number | string | null) => a !== null && b !== null && (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) > 1e-9 : a !== b);

export interface Candidate {
  kind: 'resolution' | 'boundary' | 'disaggregate' | 'construct-diff' | 'memory' | 'placement' | 'relocate' | 'sampling';
  cost: number;
  description: string;
  resolves: boolean | null;
  apply: (e: Emit) => void;
}

export function candidatesFor(app: ApparatusSpec, rec: AliasingRecord, c: Ctx, maxGrowth = 6): Candidate[] {
  const [A, B] = rec.snapshots; const [pA, pB] = rec.previous;
  const out: Candidate[] = [];
  const reads = new Set<string>();
  for (const ch of app.channels) {
    if (ch.construct || ch.enabled === false) continue;
    for (const r of ch.reads) for (const a of r.endsWith('*') ? Object.keys(A).filter((x) => x.startsWith(r.slice(0, -1))) : [r]) reads.add(a);
    const res = ch.resolution ?? 0;
    if (res > 0) {
      const t = { ...ch, resolution: res / 4 };
      out.push({ kind: 'resolution', cost: 1, description: `${ch.id}: resolution ${res} → ${res / 4}`, resolves: differs(readOn(t, A), readOn(t, B)), apply: (e) => e.apparatus.patchChannel(app.id, ch.id, { resolution: res / 4 }) });
    }
    if (ch.boundary) {
      const t = { ...ch, boundary: undefined };
      out.push({ kind: 'boundary', cost: 1, description: `${ch.id}: boundary ${ch.boundary.join(',')} → open`, resolves: differs(readOn(t, A), readOn(t, B)), apply: (e) => e.apparatus.patchChannel(app.id, ch.id, { boundary: undefined }) });
    }
    const placed = ch.reads.flatMap((r) => (r.endsWith('*') ? Object.keys(A).filter((x) => x.startsWith(r.slice(0, -1))).sort() : [r]));
    if (placed.length > 1) {
      const subs = placed.map((a, i) => ({ ...ch, id: `${ch.id}~${i}`, reads: [a], aggregate: 'first' as const }));
      out.push({ kind: 'disaggregate', cost: 2 + placed.length * 0.1, description: `${ch.id}: split aggregate over ${placed.length} addresses`, resolves: subs.some((s) => differs(readOn(s, A), readOn(s, B))), apply: (e) => subs.forEach((s) => e.apparatus.addChannel(app.id, s)) });
    }
    const dA = readOn(ch, A), dB = readOn(ch, B), qA = readOn(ch, pA), qB = readOn(ch, pB);
    const num4 = [dA, dB, qA, qB].every((x) => typeof x === 'number');
    out.push({
      kind: 'construct-diff', cost: 1.5, description: `construct Δ${ch.id}`,
      resolves: num4 ? Math.abs(((dA as number) - (qA as number)) - ((dB as number) - (qB as number))) > 1e-9 : null,
      apply: (e) => e.apparatus.addChannel(app.id, { id: `${ch.id}_d`, clock: ch.clock, reads: [], construct: { op: 'diff', of: [ch.id] } }),
    });
    out.push({ kind: 'sampling', cost: 3, description: `${ch.id}: sampling regime densified (untestable on snapshots)`, resolves: null, apply: (e) => e.apparatus.patchChannel(app.id, ch.id, { window: 0 }) });
  }
  const prevDiff = app.channels.some((ch) => !ch.construct && differs(readOn(ch, pA), readOn(ch, pB)));
  out.push({ kind: 'memory', cost: 2.5, description: `external memory ${app.memory ?? 0} → ${(app.memory ?? 0) + 1} frames`, resolves: pA && pB ? prevDiff : null, apply: (e) => e.apparatus.patch(app.id, { memory: (app.memory ?? 0) + 1 }) });
  // Placement grown along the physical coupling graph.
  const neighbors = new Set<string>();
  for (const a of reads) {
    for (const k of c.couplingsFrom(a)) if (!reads.has(k.to)) neighbors.add(k.to);
    for (const k of c.couplingsTo(a)) if (!reads.has(k.from)) neighbors.add(k.from);
  }
  const src = app.channels.find((x) => !x.construct);
  const clock = src?.clock ?? 'default';
  const res = src?.resolution ?? 0;
  for (const n of [...neighbors].sort().slice(0, maxGrowth)) {
    // A grown sensor is physical: it inherits the sensing cost of the tissue it grows from.
    const ch: ChannelSpec = { id: `grow:${n}`, clock, reads: [n], resolution: res, modality: 'grown', ...(src?.cost ? { cost: { ...src.cost } } : {}) };
    out.push({ kind: 'placement', cost: 2, description: `grow sensor to ${n} (coupled to current placement)`, resolves: differs(readOn(ch, A), readOn(ch, B)), apply: (e) => e.apparatus.addChannel(app.id, ch) });
    // Relocation: move an existing sensor instead of adding one (no extra sensing cost, but the old placement is lost).
    if (src && !src.construct) {
      const moved: ChannelSpec = { ...src, reads: [n], modality: 'relocated' };
      out.push({ kind: 'relocate', cost: 1.2, description: `relocate ${src.id} from ${src.reads.join(',')} to ${n}`, resolves: differs(readOn(moved, A), readOn(moved, B)), apply: (e) => e.apparatus.patchChannel(app.id, src.id, { reads: [n], modality: 'relocated' }) });
    }
  }
  return out.sort((x, y) => x.cost - y.cost || x.description.localeCompare(y.description));
}

export type SelectionPolicy = 'pareto-min-loss' | 'pareto-all' | 'cheapest' | 'lexicographic' | 'none';
export type PolicyOrigin = 'external' | 'domain-supplied' | 'historically-inherited' | 'generated-through-prior-feedback' | 'unknown';

/**
 * A Pareto evaluation axis is a meta-object, not a neutral fact: it declares what it measures, under which
 * assumptions and window, when two candidates are comparable on it, which direction is preferred, and where
 * that preference comes from.
 */
export interface ParetoAxis {
  id: string;
  prefer: 'min' | 'max';
  measure(p: CandidateProfile): number;
  assumptions: string;
  window: string;
  configuration: string;
  comparability: string;
  preferenceOrigin: PolicyOrigin | 'locally-generated';
  origin: 'supplied' | 'domain-registered' | 'generated';
}

const LA = 'counterfactual lookahead fork of the current configuration';
export const PARETO_AXES: ParetoAxis[] = [
  { id: 'alias-resolution', prefer: 'max', measure: (p) => (p.resolves === true ? 1 : p.resolves === null ? 0.5 : 0), assumptions: 'aliased pair re-measured on retained physical snapshots; untestable counts 0.5', window: 'the aliased pair', configuration: 'current apparatus', comparability: 'same aliasing record', preferenceOrigin: 'external', origin: 'supplied' },
  { id: 'aliases-resolved', prefer: 'max', measure: (p) => p.aliasesResolved, assumptions: 'fraction of all open aliasing records separated', window: 'open aliasing records', configuration: 'current apparatus', comparability: 'same set of open records', preferenceOrigin: 'external', origin: 'supplied' },
  { id: 'new-observability', prefer: 'max', measure: (p) => p.newObservability.length, assumptions: 'address counts where detected fraction rises by > 0.2', window: 'lookahead horizon', configuration: LA, comparability: 'same horizon and seed', preferenceOrigin: 'external', origin: 'supplied' },
  { id: 'lost-observability', prefer: 'min', measure: (p) => p.lostObservability.length, assumptions: 'address counts where detected fraction falls by > 0.2', window: 'lookahead horizon', configuration: LA, comparability: 'same horizon and seed', preferenceOrigin: 'external', origin: 'supplied' },
  { id: 'observability-net', prefer: 'max', measure: (p) => p.newObservability.length - p.lostObservability.length, assumptions: 'gained minus lost addresses (treats all addresses as commensurable — a strong assumption)', window: 'lookahead horizon', configuration: LA, comparability: 'same horizon and seed', preferenceOrigin: 'external', origin: 'supplied' },
  { id: 'resource-cost', prefer: 'min', measure: (p) => p.resourceCost, assumptions: 'static candidate cost + extra consumption of tagged resources and sensing budgets', window: 'lookahead horizon', configuration: LA, comparability: 'same resource units', preferenceOrigin: 'external', origin: 'supplied' },
  { id: 'fragility', prefer: 'min', measure: (p) => p.fragility.blockedDelta + p.fragility.resourcesDepleted.length, assumptions: 'extra blocked operations + resources falling below half of the no-change baseline', window: 'lookahead horizon', configuration: LA, comparability: 'same horizon', preferenceOrigin: 'external', origin: 'supplied' },
  { id: 'delay', prefer: 'min', measure: (p) => p.delayedConsequences.length, assumptions: 'consequences appearing only in the second half of the lookahead', window: 'second half of lookahead', configuration: LA, comparability: 'same horizon', preferenceOrigin: 'external', origin: 'supplied' },
  { id: 'dependency-creation', prefer: 'min', measure: (p) => (p.kind === 'placement' || p.kind === 'disaggregate' || p.kind === 'construct-diff' ? 1 : 0) + p.fragility.resourcesDepleted.length, assumptions: 'new channels or constructions create new dependencies', window: 'structural', configuration: 'apparatus', comparability: 'always', preferenceOrigin: 'external', origin: 'supplied' },
  { id: 'future-reachability', prefer: 'max', measure: (p) => p.probesStillReachable ?? 0, assumptions: 'number of declared probes still reached within the lookahead — assumes keeping declared possibilities open is desirable', window: 'lookahead horizon', configuration: `${LA}; declared probes`, comparability: 'same probe vocabulary', preferenceOrigin: 'external', origin: 'supplied' },
];

/** The axis set the reviser used before axes became explicit (kept as a default, not a privileged choice). */
export const DEFAULT_AXES = ['alias-resolution', 'aliases-resolved', 'new-observability', 'lost-observability', 'resource-cost', 'fragility', 'delay'];

export interface ReviserOptions {
  id?: string; apparatus: string; clock: string; budget?: number; allowed?: Candidate['kind'][]; maxGrowth?: number;
  /** Default 'pareto-min-loss'. 'none' records the trade-off without revising (comparison mode). */
  policy?: SelectionPolicy;
  /** Lookahead horizon for downstream evaluation. */
  lookahead?: number;
  /** Pareto axes (ids from PARETO_AXES or custom axis objects). */
  axes?: (string | ParetoAxis)[];
  /** Where the selection policy comes from (recorded; default 'external'). */
  policyOrigin?: PolicyOrigin;
}

export interface CandidateProfile {
  kind: string; description: string; cost: number;
  resolves: boolean | null;
  /** Fraction of all currently unresolved aliasing records this candidate separates. */
  aliasesResolved: number;
  lostObservability: string[];
  newObservability: string[];
  resourceCost: number;
  fragility: { blockedDelta: number; resourcesDepleted: string[] };
  reachabilityChange: string[];
  delayedConsequences: string[];
  descriptionSpaceChange: string[];
  pareto: boolean;
  selected: boolean;
  evaluated: 'lookahead' | 'static-only';
  probesStillReachable?: number;
  /** Axis values under the axis set in force. */
  axisValues?: Record<string, number>;
  /** Distinctions retained / lost / new / unknown under this revision. */
  distinctions?: { retained: string[]; lost: string[]; new: string[]; unknown: string[] };
}

function lossesAndGains(base: LookaheadResult, la: LookaheadResult) {
  const lost: string[] = [], gained: string[] = [], lostLate: string[] = [];
  for (const a of new Set([...Object.keys(base.detected), ...Object.keys(la.detected)])) {
    const b = base.detected[a], v = la.detected[a];
    if (b !== undefined && (v === undefined || v < b - 0.2)) lost.push(a);
    if (v !== undefined && (b === undefined || v > b + 0.2)) gained.push(a);
    const bl = base.detectedLate[a], vl = la.detectedLate[a];
    if (!lost.includes(a) && bl !== undefined && (vl === undefined || vl < bl - 0.2)) lostLate.push(a);
  }
  return { lost: lost.sort(), gained: gained.sort(), lostLate: lostLate.sort() };
}

export function resolveAxes(axes?: (string | ParetoAxis)[]): ParetoAxis[] {
  return (axes ?? DEFAULT_AXES).map((a) => (typeof a === 'string' ? PARETO_AXES.find((x) => x.id === a) : a)).filter((a): a is ParetoAxis => !!a);
}

/** Pareto filtering is descriptive: it marks the non-dominated set under the given axes and selects nothing. */
export function paretoFront(ps: CandidateProfile[], axes: ParetoAxis[] = resolveAxes()): CandidateProfile[] {
  const vec = (p: CandidateProfile) => axes.map((ax) => (ax.prefer === 'max' ? 1 : -1) * ax.measure(p));
  for (const p of ps) { p.axisValues = Object.fromEntries(axes.map((ax) => [ax.id, ax.measure(p)])); }
  for (const p of ps) {
    const a = vec(p);
    p.pareto = !ps.some((q) => q !== p && (() => { const b = vec(q); return b.every((x, i) => x >= a[i] - 1e-12) && b.some((x, i) => x > a[i] + 1e-12); })());
  }
  return ps.filter((p) => p.pareto);
}

/** Selection is a separate operation over the Pareto set; the policy and its origin are recorded. */
export function selectFrom(profiles: CandidateProfile[], policy: SelectionPolicy, axes: ParetoAxis[]): CandidateProfile[] {
  const viable = profiles.filter((p) => p.resolves === true);
  if (policy === 'none') return [];
  if (policy === 'cheapest') return viable.sort((a, b) => a.cost - b.cost).slice(0, 1);
  const front = viable.filter((p) => p.pareto);
  if (policy === 'pareto-all') return front.filter((p) => p.kind !== 'relocate');
  if (policy === 'lexicographic') {
    const ord = [...front].sort((a, b) => { for (const ax of axes) { const d = (ax.prefer === 'max' ? -1 : 1) * (ax.measure(a) - ax.measure(b)); if (Math.abs(d) > 1e-12) return d; } return a.description.localeCompare(b.description); });
    return ord.slice(0, 1);
  }
  return front.sort((a, b) => (a.lostObservability.length + a.delayedConsequences.length) - (b.lostObservability.length + b.delayedConsequences.length) || (a.fragility.blockedDelta - b.fragility.blockedDelta) || a.resourceCost - b.resourceCost).slice(0, 1);
}

/** A Ziran reviser is an ordinary rule: its ignition condition is an unresolved aliasing record. */
export function ziranReviser(o: ReviserOptions): RuleSpec {
  const id = o.id ?? `ziran.revise.${o.apparatus}`;
  const seen = `ziran/${o.apparatus}/seen`, count = `ziran/${o.apparatus}/revisions`;
  const policy = o.policy ?? 'pareto-min-loss';
  const policyOrigin = o.policyOrigin ?? 'external';
  const axes = resolveAxes(o.axes);
  const H = o.lookahead ?? 12;
  return {
    id, clock: o.clock, label: 'Ziran observation self-revision', tags: ['ziran', 'observability'], analyze: true,
    when: (c) => c.aliasing(o.apparatus).length > c.get(seen) && c.get(count) < (o.budget ?? 6),
    then: (c, e) => {
      const recs = c.aliasing(o.apparatus);
      const rec = recs[c.get(seen)];
      const app = c.apparatus(o.apparatus)!;
      const cands = candidatesFor(app, rec, c, o.maxGrowth).filter((k) => !o.allowed || o.allowed.includes(k.kind));
      const open = recs.slice(c.get(seen));
      const base = c.lookahead(() => {}, H);
      const profiles: CandidateProfile[] = [];
      for (const k of cands.filter((x) => x.resolves !== false).slice(0, 10)) {
        const others = open.map((r) => candidatesFor(app, r, c, o.maxGrowth).find((x) => x.description === k.description)?.resolves === true ? 1 : 0);
        const aliasesResolved = others.reduce((a: number, b: number) => a + b, 0) / Math.max(1, open.length);
        const la = base ? c.lookahead((ee) => k.apply(ee), H) : null;
        let prof: CandidateProfile = { kind: k.kind, description: k.description, cost: k.cost, resolves: k.resolves, aliasesResolved, lostObservability: [], newObservability: [], resourceCost: k.cost, fragility: { blockedDelta: 0, resourcesDepleted: [] }, reachabilityChange: [], delayedConsequences: [], descriptionSpaceChange: [], pareto: false, selected: false, evaluated: 'static-only' };
        if (base && la) {
          const lg = lossesAndGains(base, la);
          const used = Object.keys(base.resources).map((r) => (base.resources[r] - (la.resources[r] ?? base.resources[r]))).reduce((a, b) => a + Math.max(0, b), 0);
          const blocked = (x: Record<string, number>) => Object.values(x).reduce((a, b) => a + b, 0);
          const depleted = Object.keys(la.resources).filter((r) => (base.resources[r] ?? 0) > 1e-9 && la.resources[r] < 0.5 * base.resources[r]);
          prof = { ...prof, evaluated: 'lookahead', lostObservability: lg.lost, newObservability: lg.gained, resourceCost: k.cost + used,
            probesStillReachable: Object.values(la.probes).filter((x) => x !== null).length,
            distinctions: { retained: [], lost: lg.lost.map((a) => `readings of ${a}`), new: lg.gained.map((a) => `readings of ${a}`), unknown: k.resolves === null ? ['whether the aliased pair is separated (untestable on snapshots)'] : [] },
            fragility: { blockedDelta: blocked(la.blocked) - blocked(base.blocked), resourcesDepleted: depleted },
            reachabilityChange: Object.keys(base.probes).filter((p) => base.probes[p] !== la.probes[p]).map((p) => `${p}: ${base.probes[p] ?? '—'} → ${la.probes[p] ?? '—'}`),
            delayedConsequences: [...lg.lostLate.map((a) => `late loss of ${a}`), ...(blocked(la.blockedLate) > blocked(base.blockedLate) ? ['late blocked operations'] : [])],
            descriptionSpaceChange: [...Object.keys(la.spaceChange.added).map((x) => '+' + x), ...Object.keys(la.spaceChange.removed).map((x) => '−' + x)] };
        }
        profiles.push(prof);
      }
      // stages: generation → evaluation → Pareto filtering (descriptive) → selection (policy) → execution
      const front = paretoFront(profiles, axes);
      const chosen = selectFrom(profiles, policy, axes);
      for (const p of chosen) p.selected = true;
      const pick = chosen[0];
      const question = {
        previouslyUnavailable: { observationKey: rec.key, underIntervention: rec.sig, divergedInto: rec.next, at: rec.t },
        apparatusChange: pick ? { kind: pick.kind, description: pick.description, cost: pick.cost } : null,
        evaluation: 'retained physical snapshots re-measured with candidate apparatus; downstream consequences by counterfactual lookahead',
        policy, policyOrigin, lookaheadHorizon: H,
        axes: axes.map((a) => ({ id: a.id, prefer: a.prefer, assumptions: a.assumptions, window: a.window, configuration: a.configuration, comparability: a.comparability, preferenceOrigin: a.preferenceOrigin, origin: a.origin })),
        stages: { generated: cands.length, evaluated: profiles.length, paretoSet: front.map((p) => p.description), selected: chosen.map((p) => p.description), executed: chosen.length > 0 },
        latency: { aliasingDetectedAt: rec.t[1], revisedAt: c.t, sensorRevisionLatency: c.t - rec.t[1] },
        tradeoff: profiles,
        candidatesTested: cands.map((k) => ({ kind: k.kind, description: k.description, resolves: k.resolves })),
        altersLaterReachability: pick ? (pick.reachabilityChange.length ? pick.reachabilityChange : 'no probe-relative change within the lookahead horizon') : null,
      };
      if (chosen.length) {
        for (const p of chosen) cands.find((k) => k.description === p.description)!.apply(e);
        e.set(seen, 0); e.add(count, 1); e.note('observability-revision', question);
      } else { e.set(seen, recs.length); e.note(policy === 'none' ? 'observability-revision.tradeoff-only' : 'observability-revision.unresolved', question); }
    },
  };
}
