import type { Trace } from '../core/trace.ts';
import { scalarView } from '../core/values.ts';

/** Scalar view of a state (non-scalar values omitted, not converted). */
export type State = Record<string, number>;
export type OpenState = Record<string, unknown>;

/** Replay a trace into open states sampled every `dt` (engine time). */
export function sampleOpenStates(tr: Trace, dt = 1): { t: number; s: OpenState }[] {
  const out: { t: number; s: OpenState }[] = [];
  const st: OpenState = { ...tr.initial.state };
  let i = 0; const ev = tr.events;
  for (let t = 0; t <= tr.meta.horizon + 1e-9; t += dt) {
    while (i < ev.length && ev[i].t <= t) { const e = ev[i]; if (e.kind === 'effect') st[e.address] = e.after; i++; }
    out.push({ t, s: { ...st } });
  }
  return out;
}

/** Replay a trace into scalar-view states sampled every `dt` (engine time). */
export function sampleStates(tr: Trace, dt = 1): { t: number; s: State }[] {
  return sampleOpenStates(tr, dt).map(({ t, s }) => ({ t, s: scalarView(s) }));
}

/** Observation series of one apparatus as aligned arrays (null → NaN). */
export function observationSeries(tr: Trace, app: string, channels?: string[]): Record<string, number[]> {
  const O = tr.observations[app] ?? {};
  const ids = channels ?? Object.keys(O);
  const n = Math.min(...ids.map((id) => O[id]?.length ?? 0));
  return Object.fromEntries(ids.map((id) => [id, O[id].slice(0, n).map((r) => (typeof r[1] === 'number' ? r[1] : NaN))]));
}
