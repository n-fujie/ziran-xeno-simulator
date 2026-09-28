// Meta-time: latency is tracked not only for object-level corrections but for sensor revision, description-space
// revision and meta-rule revision. A meta-revision can also be too late (see adaptationRun for variable/grammar
// revision across regimes).
import type { Trace } from '../core/trace.ts';

export interface MetaLatency { kind: string; trigger: number; revised: number; latency: number }

export function metaLatencies(tr: Trace): MetaLatency[] {
  const out: MetaLatency[] = [];
  for (const e of tr.events) if (e.kind === 'note' && e.note === 'observability-revision' && e.data?.latency) out.push({ kind: 'sensor revision', trigger: e.data.latency.aliasingDetectedAt, revised: e.t, latency: e.data.latency.sensorRevisionLatency });
  const firstAlias = tr.events.find((e) => e.kind === 'aliasing');
  const firstC = tr.stateSpaceLineage.find((x) => x.level === 'C' && Object.keys(x.added).some((k) => k === 'channel' || k === 'variable-system'));
  if (firstAlias && firstC && firstC.t >= firstAlias.t) out.push({ kind: 'description-space revision (observation)', trigger: firstAlias.t, revised: firstC.t, latency: firstC.t - firstAlias.t });
  for (const m of tr.metaLineage) out.push({ kind: `meta-rule revision (${m.registry})`, trigger: 0, revised: m.t, latency: m.t });
  return out;
}
