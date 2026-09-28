// Trace store: everything needed to rerun, replay, compare and cite a run.
import type { TraceEvent, WorldSpec, Intervention } from './types.ts';
import { Engine, ENGINE_VERSION } from './engine.ts';
import { hashOf, canonical } from './hash.ts';
import { NON_DETECTION_STATUSES } from './types.ts';
import { toData, kindOf } from './values.ts';
import { spaceSummary } from './description.ts';

export interface RunRecord {
  presetId?: string;
  params?: Record<string, unknown>;
  perturbations?: unknown[];
}

/** Values in traces are data (JSON); scalars stay numbers. */
export type StateData = Record<string, unknown>;

export interface Trace {
  meta: {
    engine: string; specId: string; title?: string; specHash: string; seed: number; horizon: number;
    runHash: string; run?: RunRecord; createdBy: 'ziran-xeno-simulator';
    /** Evidence label: synthetic unless an external adapter declares otherwise. */
    evidence: 'synthetic' | 'replayed-empirical' | 'live-observational' | 'intervention-derived';
    claimStatus: 'synthetic-world result' | 'replayed empirical result';
  };
  initial: {
    config: unknown; state: StateData; addresses: unknown; clocks: unknown;
    rules: { id: string; clock: string; label?: string; tags?: string[]; delay?: number; correction: boolean; whenHash: string; thenHash: string }[];
    couplings: unknown; apparatus: unknown; probes: { id: string; label?: string; monotone?: boolean }[];
    interventions: unknown[]; reach: unknown; operationalAddresses: unknown; valueKinds: string[];
    space: Record<string, string[]>;
    meta: { registry: string; id: string; origin: string; retired: boolean; description?: string }[];
  };
  events: TraceEvent[];
  epistemic: Record<string, Record<number, string>>;
  observations: Record<string, Record<string, [number, unknown, string][]>>;
  loops: unknown[];
  interactions: unknown[];
  probes: Record<string, { satisfied: boolean; first: number | null; flips: number }>;
  /** Reachability relative to the declared probes, option menu, horizon and observation configuration. */
  probeRelativeReachability: any[];
  /** Description-space expansion/contraction in the same forks; independent of probes. */
  emergentReachability: any[];
  /** S_t → S_{t+1}: changes of the operational description space, with lineage. */
  stateSpaceLineage: { t: number; seq: number; from: string; to: string; added: Record<string, string[]>; removed: Record<string, string[]>; facetsAdded: string[]; facetsRemoved: string[]; signature: string; cause: number[]; level: 'C' | 'D' }[];
  /** M_t → M_{t+1}: changes of the meta-configuration during the run (Level D). */
  metaLineage: { t: number; seq: number; op: string; registry: string; id: string; origin: string; from: string; to: string; via?: string }[];
  final: { t: number; state: StateData; config: unknown; apparatus: unknown; rules: Record<string, boolean>; couplings: unknown; clocks: unknown; operationalAddresses: unknown; space: Record<string, string[]>; meta: { registry: string; id: string; origin: string; retired: boolean; description?: string }[] };
  summary: Record<string, any>;
}

function ivView(iv: Intervention): unknown {
  return iv.kind === 'emit' ? { id: iv.id, t: iv.t, kind: iv.kind, label: iv.label, code: iv.apply.toString() } : iv;
}

const dataState = (s: Record<string, unknown>, e?: Engine): StateData => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, e ? e.serialize(v) : toData(v)]));

export function exportTrace(e: Engine, run?: RunRecord): Trace {
  const s: WorldSpec = e.spec;
  const events = e.events;
  const loops = [...e.loops.values()].map((l) => ({ ...l, meanLatency: l.latencySum / l.count }));
  const counts: Record<string, number> = {};
  for (const ev of events) counts[ev.kind] = (counts[ev.kind] ?? 0) + 1;
  const penetrating = events.filter((ev) => ev.kind === 'effect' && String(ev.via).startsWith('coupling:')).length;
  const epistemicCounts: Record<string, Record<string, number>> = {};
  for (const [app, m] of Object.entries(e.epistemic)) {
    const c: Record<string, number> = {};
    for (const st of Object.values(m)) c[st] = (c[st] ?? 0) + 1;
    epistemicCounts[app] = c;
  }
  const closure = horizonRelativeClosure(e.reachHistory, s.probes?.filter((p) => p.monotone).map((p) => p.id) ?? [], e.probeState);
  const finalSpace = e.currentSpace();
  const levels = {
    A: counts['effect'] ?? 0,
    B: events.filter((ev) => ev.kind === 'reorganization' && (ev.level === 'B' || ev.level === undefined)).length,
    C: events.filter((ev) => ev.kind === 'state-space' && ev.level !== 'D').length,
    D: (counts['meta-configuration'] ?? 0) + events.filter((ev) => ev.kind === 'state-space' && ev.level === 'D').length,
  };
  const contraction = events.filter((ev) => ev.kind === 'state-space').reduce((a, ev) => a + (ev.contraction ?? 0), 0);
  const expansion = events.filter((ev) => ev.kind === 'state-space').reduce((a, ev) => a + (ev.expansion ?? 0), 0);
  const evidence = ((s.params as Record<string, unknown> | undefined)?.evidence as Trace['meta']['evidence']) ?? 'synthetic';
  return {
    meta: { engine: ENGINE_VERSION, specId: s.id, title: s.title, specHash: e.specHash, seed: s.seed, horizon: s.horizon, runHash: runHash(events), run, createdBy: 'ziran-xeno-simulator',
      evidence, claimStatus: evidence === 'synthetic' ? 'synthetic-world result' : 'replayed empirical result' },
    initial: {
      config: s.config ?? [], state: dataState(s.state, e), addresses: s.addresses ?? {}, clocks: s.clocks,
      rules: s.rules.map((r) => ({ id: r.id, clock: r.clock, label: r.label, tags: r.tags, delay: r.delay, correction: !!r.correction, whenHash: hashOf(r.when).slice(0, 16), thenHash: hashOf(r.then).slice(0, 16) })),
      couplings: s.couplings ?? [], apparatus: s.apparatus ?? [], probes: (s.probes ?? []).map((p) => ({ id: p.id, label: p.label, monotone: p.monotone })),
      interventions: (s.interventions ?? []).map(ivView), reach: s.reach ? { ...s.reach, options: s.reach.options?.map((o) => ({ ...o, interventions: o.interventions?.map(ivView) })) } : null,
      operationalAddresses: s.operationalAddresses ?? [], valueKinds: [...new Set(Object.values(s.state).map(kindOf))].sort(),
      space: e.initialSpace,
      meta: new Engine(s, { trace: false, reachability: false }).metaConfig.snapshot(),
    },
    events,
    epistemic: e.epistemic,
    observations: e.observations,
    loops,
    interactions: [...e.interactions.values()],
    probes: e.probeState,
    probeRelativeReachability: e.reachHistory,
    emergentReachability: e.emergentHistory,
    stateSpaceLineage: e.spaceLineage,
    metaLineage: e.metaLineage,
    final: {
      t: e.t, state: dataState(e.state, e), config: Object.values(e.dims), apparatus: Object.values(e.apparatus),
      rules: Object.fromEntries(Object.entries(e.rules).map(([k, r]) => [k, r.enabled])), couplings: Object.values(e.couplings),
      clocks: Object.values(e.clocks).map((c) => ({ ...c.spec, ticks: c.tick })), operationalAddresses: Object.values(e.opAddr),
      space: Object.fromEntries(Object.entries(finalSpace).map(([k, v]) => [k, [...v].sort()])),
      meta: e.metaConfig.snapshot(),
    },
    summary: {
      counts, penetrating, epistemic: epistemicCounts, loops: loops.length, horizonRelativeClosure: closure, aliasing: counts['aliasing'] ?? 0,
      levels, spaceChange: { expansion, contraction }, spaceSize: spaceSummary(finalSpace), valueKinds: [...new Set(Object.values(e.state).map(kindOf))].sort(),
    },
  };
}

/** Hash of the event log only; equal across exact reruns of a deterministic configuration. */
export function runHash(events: TraceEvent[]): string {
  return hashOf(events);
}

/**
 * Horizon-relative closure: probes that became probe-relatively unreachable and never reopened within the
 * run (a claim relative to probes, option menu and fork horizon), plus monotone probes that occurred
 * (monotonicity is a property declared by the probe, not demonstrated irreversibility).
 */
function horizonRelativeClosure(hist: any[], monotone: string[], ps: Record<string, { satisfied: boolean }>): { probe: string; kind: string; t?: number }[] {
  const out: { probe: string; kind: string; t?: number }[] = [];
  const ids = hist.length ? Object.keys(hist[0].probes) : [];
  for (const id of ids) {
    let closedAt: number | null = null; let everOpen = false;
    for (const h of hist) {
      const f = h.probes[id].fraction;
      if (f > 0) { everOpen = true; closedAt = null; } else if (everOpen && closedAt === null) closedAt = h.t;
    }
    if (closedAt !== null) out.push({ probe: id, kind: 'horizon-relative-closure', t: closedAt });
  }
  for (const id of monotone) if (ps[id]?.satisfied) out.push({ probe: id, kind: 'monotone-occurrence' });
  return out;
}

/** Reconstruct storage after event `upto` from the initial state and recorded effects (replay). */
export function replayState(tr: Trace, upto: number): StateData {
  const st: StateData = { ...tr.initial.state };
  for (const ev of tr.events) {
    if (ev.seq > upto) break;
    if (ev.kind === 'effect') st[ev.address] = ev.after;
    else if (ev.kind === 'reorganization' && ev.target === 'address' && ev.op === 'remove') {
      for (const a of Object.keys(st)) if (a.startsWith(ev.key)) delete st[a];
    } else if (ev.kind === 'reorganization' && ev.target === 'address' && ev.op === 'reassign') {
      const [from, to] = String(ev.key).split('→');
      for (const a of Object.keys(st)) if (a.startsWith(from)) { st[to + a.slice(from.length)] = st[a]; delete st[a]; }
    }
  }
  return st;
}

const sameData = (a: unknown, b: unknown, tol = 1e-12) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= tol : canonical(a) === canonical(b));

/**
 * Anti-regression validator. Returns violations; empty means the trace respects the core commitments:
 *  - no epistemic status claims absence,
 *  - every real effect records an actual difference,
 *  - non-scalar effects are not converted to numeric placeholders,
 *  - replay reproduces the final state.
 */
export function validateTrace(tr: Trace): string[] {
  const v: string[] = [];
  const allowed = new Set<string>(['detected', 'pending', ...NON_DETECTION_STATUSES]);
  for (const [app, m] of Object.entries(tr.epistemic)) for (const [seq, st] of Object.entries(m)) {
    if (!allowed.has(st)) v.push(`epistemic ${app}#${seq}: illegal status ${st}`);
  }
  if (/"absent"/.test(canonical(tr.epistemic))) v.push('epistemic map contains "absent"');
  for (const e of tr.events) {
    if (e.kind === 'effect' && sameData(e.before, e.after) && !e.appeared) v.push(`effect #${e.seq} records no difference`);
    if (e.kind === 'effect' && e.valueKind && e.valueKind !== 'scalar' && typeof e.after === 'number') v.push(`effect #${e.seq}: ${e.valueKind} value collapsed to a number`);
    if (e.kind === 'undetermined' && Object.keys(e.statuses ?? {}).some((r) => r === 'absent')) v.push(`undetermined #${e.seq} claims absence`);
  }
  const rs = replayState(tr, Infinity);
  for (const [a, x] of Object.entries(tr.final.state)) if (!sameData(rs[a] ?? 0, x, 1e-9)) { v.push(`replay mismatch at ${a}`); break; }
  return v;
}
