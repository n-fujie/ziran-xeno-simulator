// Experiment registry: presets are world builders; an experiment = preset + params + seed + perturbations.
// Every run preserves everything needed for an exact rerun.
import type { WorldSpec } from './types.ts';
import { applyPerturbations, describePerturbation, type Perturbation } from './perturbations.ts';
import { runSpec } from './counterfactual.ts';
import type { Trace } from './trace.ts';

export interface Preset {
  id: string;
  title: string;
  /** Descriptive grouping only; presets are not ontological partitions. */
  area: string;
  layer?: number;
  summary: string;
  /** What this preset lets you ask, phrased operationally. */
  questions?: string[];
  defaults: Record<string, unknown>;
  /** Allowed values for list/enum parameters (interface hint). */
  options?: Record<string, readonly string[]>;
  build: (params: Record<string, unknown>) => WorldSpec;
  /** Suggested perturbations for the interface. */
  perturbations?: { label: string; list: Perturbation[] }[];
}

export interface Experiment {
  preset: string;
  params?: Record<string, unknown>;
  seed?: number;
  horizon?: number;
  perturbations?: Perturbation[];
  label?: string;
}

const registry = new Map<string, Preset>();

export function registerPreset(p: Preset): void {
  if (registry.has(p.id)) throw new Error('duplicate preset ' + p.id);
  registry.set(p.id, p);
}
export function getPreset(id: string): Preset {
  const p = registry.get(id);
  if (!p) throw new Error('unknown preset ' + id);
  return p;
}
export function listPresets(): Preset[] { return [...registry.values()]; }

export function buildExperiment(x: Experiment): WorldSpec {
  const p = getPreset(x.preset);
  const params = { ...p.defaults, ...(x.params ?? {}) };
  let spec = p.build(params);
  spec = { ...spec, params: { ...(spec.params ?? {}), ...params } };
  if (x.seed !== undefined) spec.seed = x.seed;
  if (x.horizon !== undefined) spec.horizon = x.horizon;
  return applyPerturbations(spec, x.perturbations ?? []);
}

export function runExperiment(x: Experiment): Trace {
  const spec = buildExperiment(x);
  return runSpec(spec, {}, { presetId: x.preset, params: spec.params, perturbations: (x.perturbations ?? []).map(describePerturbation) });
}

/** Exact rerun: rebuild from the recorded experiment and compare run hashes. */
export function rerun(x: Experiment, tr: Trace): { equal: boolean; a: string; b: string } {
  const again = runExperiment(x);
  return { equal: again.meta.runHash === tr.meta.runHash, a: tr.meta.runHash, b: again.meta.runHash };
}
