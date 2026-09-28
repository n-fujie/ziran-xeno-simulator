// Every optimization routine must be able to detect Fragility Transfer.
// This coordinate search accepts a step only after computing a fragility-transfer report against the
// previous configuration; the report travels with the step, and `rejectTransfers` can veto steps.
import type { WorldSpec } from '../core/types.ts';
import { runSpec } from '../core/counterfactual.ts';
import type { Trace } from '../core/trace.ts';
import { fragilityTransfer, type Region, type FragilityTransferReport } from './fragility.ts';

export interface Knob { id: string; values: number[]; apply: (s: WorldSpec, v: number) => WorldSpec }

export interface OptimizationStep { knob: string; value: number; objective: number; fragility: FragilityTransferReport; accepted: boolean }

export function optimize(o: { base: WorldSpec; knobs: Knob[]; objective: (tr: Trace) => number; regions: Region[]; target: string; rounds?: number; rejectTransfers?: boolean }) {
  let spec = o.base;
  let tr = runSpec(spec, { reachability: false });
  let best = o.objective(tr);
  const steps: OptimizationStep[] = [];
  const setting: Record<string, number> = {};
  for (let r = 0; r < (o.rounds ?? 2); r++) {
    for (const k of o.knobs) {
      for (const v of k.values) {
        const s = k.apply(spec, v);
        const t = runSpec(s, { reachability: false });
        const obj = o.objective(t);
        if (obj < best - 1e-9) {
          const fr = fragilityTransfer(tr, t, o.regions, o.target);
          const accept = !(o.rejectTransfers && fr.transfers.length);
          steps.push({ knob: k.id, value: v, objective: obj, fragility: fr, accepted: accept });
          if (accept) { spec = s; tr = t; best = obj; setting[k.id] = v; }
        }
      }
    }
  }
  const baseTrace = runSpec(o.base, { reachability: false });
  const overall = fragilityTransfer(baseTrace, tr, o.regions, o.target);
  return { setting, objective: best, steps, overall, transferDetected: steps.some((s) => s.accepted && s.fragility.transfers.length > 0) || overall.transfers.length > 0 };
}
