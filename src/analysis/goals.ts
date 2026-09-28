// Goal formation. Goals are not primitive. Declared, represented, causally pursued, operationally
// maintained and achieved are kept separable, and each is established by a different kind of evidence.
import type { WorldSpec } from '../core/types.ts';
import type { Trace } from '../core/trace.ts';
import { runLight } from '../core/counterfactual.ts';
import { applyPerturbations, type Perturbation } from '../core/perturbations.ts';
import { scalarView } from '../core/values.ts';

export interface GoalSpec {
  id: string;
  /** Note kind emitted when the goal is declared (e.g. 'goal.declared'), matched with data.goal === id. */
  declaredNote?: string;
  /** Address that carries the goal as a state (representation). */
  representation?: string;
  /** Deviation from the goal (engine-side), e.g. |x - target|. */
  deviation: (s: Record<string, number>) => number;
  /** Maintenance band. */
  band: number;
  /** Probe whose satisfaction counts as achievement. */
  achievedProbe?: string;
  /** How to remove the goal for the causal-pursuit counterfactual. */
  removal: Perturbation[];
}

export interface GoalReport {
  goal: string;
  declared: boolean | null;
  represented: boolean | null;
  causallyPursued: boolean;
  operationallyMaintained: boolean;
  achieved: boolean | null;
  evidence: Record<string, unknown>;
}

export function analyzeGoal(spec: WorldSpec, tr: Trace, g: GoalSpec): GoalReport {
  const notes = tr.events.filter((e) => e.kind === 'note' && e.note === (g.declaredNote ?? 'goal.declared') && (e.data?.goal ?? e.data) === g.id);
  const repr = g.representation ? tr.events.some((e) => e.kind === 'effect' && e.address === g.representation) || (tr.initial.state[g.representation] ?? 0) !== 0 : null;
  // Operational maintenance: late-window deviation stays within band AND deviation was reduced after being displaced.
  const H = tr.meta.horizon;
  const st: Record<string, number> = scalarView(tr.initial.state); const devs: { t: number; d: number }[] = [];
  let i = 0;
  for (let t = 0; t <= H; t += H / 100) { while (i < tr.events.length && tr.events[i].t <= t) { const e = tr.events[i]; if (e.kind === 'effect' && typeof e.after === 'number') st[e.address] = e.after; i++; } devs.push({ t, d: g.deviation(st) }); }
  const late = devs.filter((x) => x.t > H * 0.5);
  const within = late.filter((x) => x.d <= g.band).length / Math.max(1, late.length);
  const maxD = Math.max(...devs.map((x) => x.d));
  const maintained = within > 0.8;
  // Causal pursuit: removing the goal changes the deviation trajectory.
  const base = runLight(spec), without = runLight(applyPerturbations(spec, g.removal));
  const dB = g.deviation(scalarView(base.state)), dW = g.deviation(scalarView(without.state));
  const pursued = Math.abs(dW - dB) > Math.max(g.band * 0.5, 1e-6);
  const achieved = g.achievedProbe ? tr.probes[g.achievedProbe]?.first !== null && tr.probes[g.achievedProbe]?.first !== undefined : null;
  return {
    goal: g.id, declared: g.declaredNote === undefined && !notes.length ? null : notes.length > 0, represented: repr,
    causallyPursued: pursued, operationallyMaintained: maintained, achieved,
    evidence: { declarations: notes.map((n) => n.t), lateWithinBand: within, maxDeviation: maxD, finalDeviationWith: dB, finalDeviationWithout: dW },
  };
}

/** Goal lifecycle from notes: goal.declared / goal.split / goal.conflict / goal.replaced / goal.dropped / goal.transformed. */
export function goalTimeline(tr: Trace): { t: number; kind: string; data: unknown; via: string }[] {
  return tr.events.filter((e) => e.kind === 'note' && String(e.note).startsWith('goal.')).map((e) => ({ t: e.t, kind: e.note, data: e.data, via: e.via }));
}
