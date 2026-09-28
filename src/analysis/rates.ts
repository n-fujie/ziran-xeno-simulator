// Operational-shape rate analysis (subordinate module).
// No universal rates. A local rate is reported only when (a) the configuration yields enough events
// and (b) the rate is non-redundant: it varies across windows or configuration states. Every rate is
// indexed by temporal window and by the configuration state (hash of reorganizations so far).
import type { Trace } from '../core/trace.ts';
import type { TraceEvent } from '../core/types.ts';
import { hashOf } from '../core/hash.ts';

export const RATE_KINDS: Record<string, (e: TraceEvent) => boolean> = {
  ignition: (e) => e.kind === 'ignition' && !e.suppressed,
  transition: (e) => e.kind === 'effect',
  penetration: (e) => e.kind === 'effect' && String(e.via).startsWith('coupling:'),
  correction: (e) => e.kind === 'correction',
  reorganization: (e) => e.kind === 'reorganization',
  failure: (e) => e.kind === 'blocked' || (e.kind === 'probe' && /fail|collapse|ruin|crash/.test(e.probe) && e.satisfied),
  repair: (e) => e.kind === 'effect' && /repair/.test(String(e.via)),
  'observation-revision': (e) => e.kind === 'reorganization' && e.target === 'apparatus',
  'resource-depletion': (e) => e.kind === 'effect' && e.delta < 0 && /resource|energy|cash|liquid|fuel|budget/.test(e.address),
  'branch-closure': (e) => e.kind === 'reachability.probe-relative' && (e.changes as any[]).some((c) => c.change === 'became-unreachable'),
};

export interface LocalRate {
  kind: string; available: boolean; why?: string;
  /** What operation the rate counts. */
  operation: string;
  /** Temporal window(s) the rate is indexed to. */
  temporalWindow: { horizon: number; windows: number; width: number };
  /** Configuration the rate is indexed to (spec hash + reorganization-state hashes per window). */
  configuration: { spec: string; states: string[] };
  /** What the rate assumes about observation. */
  observationAssumptions: string;
  windows: { t0: number; t1: number; count: number; rate: number; config: string }[];
  cv: number | null;
}

const OPERATION: Record<string, string> = {
  ignition: 'non-suppressed ignitions of any rule', transition: 'real effects (actual storage differences)', penetration: 'real effects arriving through couplings',
  correction: 'correction records (rules declaring a premise)', reorganization: 'reorganization events (any target)', failure: 'blocked operations and failure-named probe satisfactions',
  repair: 'real effects via rules named *repair*', 'observation-revision': 'apparatus reorganizations', 'resource-depletion': 'negative scalar effects on resource-named storage',
  'branch-closure': 'probe-relative reachability analyses reporting became-unreachable',
};

export function localRate(tr: Trace, kind: string, windows = 5, filter?: (e: TraceEvent) => boolean, minEvents = 3): LocalRate {
  const f = filter ?? RATE_KINDS[kind];
  const H = tr.meta.horizon, w = H / windows;
  const idx = { operation: OPERATION[kind] ?? (filter ? 'custom event class' : 'undefined'), temporalWindow: { horizon: H, windows, width: w },
    observationAssumptions: kind === 'observation-revision' ? 'relative to the apparatus that was revised' : kind === 'branch-closure' ? 'relative to declared probes, option menu, fork horizon and observation configuration' : 'engine-side trace events: not apparatus-relative; an apparatus may detect fewer' };
  if (!f) return { kind, available: false, why: 'no local event class for this rate', ...idx, configuration: { spec: tr.meta.specHash.slice(0, 12), states: [] }, windows: [], cv: null };
  const reorg = tr.events.filter((e) => e.kind === 'reorganization');
  const ws = Array.from({ length: windows }, (_, i) => {
    const t0 = i * w, t1 = (i + 1) * w;
    const count = tr.events.filter((e) => e.t >= t0 && e.t < t1 && f(e)).length;
    const cfg = hashOf(reorg.filter((e) => e.t < t0).map((e) => [e.target, e.op, e.key])).slice(0, 10);
    return { t0, t1, count, rate: count / w, config: cfg };
  });
  const total = ws.reduce((a, b) => a + b.count, 0);
  const configuration = { spec: tr.meta.specHash.slice(0, 12), states: [...new Set(ws.map((x) => x.config))] };
  if (total < minEvents) return { kind, available: false, why: `only ${total} events: this configuration does not make the rate available`, ...idx, configuration, windows: ws, cv: null };
  const m = total / windows / w;
  const cv = Math.sqrt(ws.reduce((a, b) => a + (b.rate - m) ** 2, 0) / windows) / (m || 1);
  const configs = new Set(ws.map((x) => x.config)).size;
  if (cv < 0.05 && configs === 1) return { kind, available: false, why: 'redundant: constant across windows and configuration states (adds no distinction)', ...idx, configuration, windows: ws, cv };
  return { kind, available: true, ...idx, configuration, windows: ws, cv };
}

export function allRates(tr: Trace, windows = 5): LocalRate[] {
  return Object.keys(RATE_KINDS).map((k) => localRate(tr, k, windows));
}
