// TraceSchema — the trace is not neutral. What counts as a trace event, which fields are kept, which causal
// edges survive, whether time is aggregated, whether values are discarded and relations flattened: these are
// meta-configuration choices. Several schemas can be projected from the same underlying run, and analyses
// can be compared across them (TraceSchemaSensitivity).
import type { Trace } from '../core/trace.ts';
import type { TraceEvent } from '../core/types.ts';
import type { MetaEntry } from '../core/meta.ts';

export interface TraceSchema {
  id: string;
  origin: MetaEntry['origin'];
  description: string;
  /** Event kinds kept ('*' = all). */
  eventKinds: string[] | '*';
  /** Per event kind, fields kept (seq/t/kind are always kept). Missing kind → all fields. */
  fields?: Record<string, string[]>;
  /** Temporal aggregation: event times floored to bins of this width (0 = none). */
  temporalAggregation: number;
  /** Which causal edges survive. */
  causalEdges: 'all' | 'none' | 'within-kept' | 'coupling-only';
  /** Drop value payloads (before/after/value/difference/inputs). */
  discardValues: boolean;
  /** Replace relation values by their edge count. */
  flattenRelations: boolean;
}

export const TRACE_SCHEMAS: TraceSchema[] = [
  { id: 'full', origin: 'supplied', description: 'engine-full: every event kind and field, all cause edges, no aggregation', eventKinds: '*', temporalAggregation: 0, causalEdges: 'all', discardValues: false, flattenRelations: false },
  { id: 'A-ignition-effect', origin: 'supplied', description: 'Schema A: ignition and effect only; cause edges only between kept events', eventKinds: ['ignition', 'effect'], temporalAggregation: 0, causalEdges: 'within-kept', discardValues: false, flattenRelations: false },
  { id: 'B-plus-observation-revision', origin: 'supplied', description: 'Schema B: A + detections, reorganizations and revision notes', eventKinds: ['ignition', 'effect', 'detection', 'undetermined', 'reorganization', 'note', 'aliasing'], temporalAggregation: 0, causalEdges: 'within-kept', discardValues: false, flattenRelations: false },
  { id: 'C-plus-coupling-lineage', origin: 'supplied', description: 'Schema C: B + operations, losses and full coupling lineage', eventKinds: ['ignition', 'effect', 'detection', 'undetermined', 'reorganization', 'note', 'aliasing', 'operation', 'loss', 'feedback'], temporalAggregation: 0, causalEdges: 'within-kept', discardValues: false, flattenRelations: false },
  { id: 'A0-no-read-sets', origin: 'supplied', description: 'Schema A without read sets: ignitions keep only rule/clock/onset; effects keep address/via/delta', eventKinds: ['ignition', 'effect'], fields: { ignition: ['rule', 'clock', 'onset', 'occurrence'], effect: ['address', 'via', 'delta'] }, temporalAggregation: 0, causalEdges: 'none', discardValues: false, flattenRelations: false },
  { id: 'coarse-5', origin: 'supplied', description: 'full event kinds, times aggregated to bins of 5, values discarded, relations flattened', eventKinds: '*', temporalAggregation: 5, causalEdges: 'within-kept', discardValues: true, flattenRelations: true },
];

const VALUE_FIELDS = ['before', 'after', 'value', 'prev', 'difference', 'inputs', 'rendered'];

/** Project a trace under a schema. Events are renumbered; causes are remapped (dropped when their target is not kept). */
export function projectTrace(tr: Trace, schema: TraceSchema): Trace & { schema: TraceSchema; dropped: { events: number; causeEdges: number } } {
  const keep = (e: TraceEvent) => schema.eventKinds === '*' || schema.eventKinds.includes(e.kind);
  const map = new Map<number, number>();
  const kept: TraceEvent[] = [];
  for (const e of tr.events) if (keep(e)) { map.set(e.seq, kept.length); kept.push(e); }
  let droppedEdges = 0;
  const events = kept.map((e, i) => {
    let o: TraceEvent = { ...e, seq: i };
    if (schema.fields?.[e.kind]) { const f = new Set(['seq', 't', 'kind', 'cause', ...schema.fields[e.kind]]); o = Object.fromEntries(Object.entries(o).filter(([k]) => f.has(k))) as TraceEvent; }
    if (schema.temporalAggregation > 0) o.t = Math.floor(o.t / schema.temporalAggregation) * schema.temporalAggregation;
    if (schema.discardValues) for (const k of VALUE_FIELDS) if (k in o && !(o.kind === 'effect' && k === 'delta')) delete (o as any)[k];
    if (schema.flattenRelations) for (const k of ['before', 'after']) { const v = (o as any)[k]; if (v && typeof v === 'object' && v.kind === 'relation') (o as any)[k] = { flattened: 'relation', edges: v.edges.length }; }
    const cause = (e.cause ?? []) as number[];
    let nc: number[] = [];
    if (schema.causalEdges === 'all' || schema.causalEdges === 'within-kept') nc = cause.filter((c) => map.has(c)).map((c) => map.get(c)!);
    else if (schema.causalEdges === 'coupling-only') nc = String(e.via ?? '').startsWith('coupling:') ? cause.filter((c) => map.has(c)).map((c) => map.get(c)!) : [];
    droppedEdges += cause.length - nc.length;
    o.cause = nc;
    for (const f of ['ignition', 'operation', 'origin', 'returning']) if (typeof (o as any)[f] === 'number') (o as any)[f] = map.get((o as any)[f]) ?? -1;
    return o;
  });
  const epistemic: Trace['epistemic'] = {};
  for (const [app, m] of Object.entries(tr.epistemic)) { epistemic[app] = {}; for (const [s, st] of Object.entries(m)) { const n = map.get(Number(s)); if (n !== undefined) epistemic[app][n] = st; } }
  const keepsKind = (k: string) => schema.eventKinds === '*' || schema.eventKinds.includes(k);
  return {
    ...tr, events, epistemic, schema, dropped: { events: tr.events.length - events.length, causeEdges: droppedEdges },
    meta: { ...tr.meta, run: { ...(tr.meta.run ?? {}), traceSchema: schema.id } as any },
    loops: keepsKind('feedback') ? tr.loops : [],
    probeRelativeReachability: keepsKind('reachability.probe-relative') ? tr.probeRelativeReachability : [],
    emergentReachability: keepsKind('reachability.emergent') ? tr.emergentReachability : [],
    stateSpaceLineage: keepsKind('state-space') ? tr.stateSpaceLineage : [],
    metaLineage: keepsKind('meta-configuration') ? tr.metaLineage : [],
    observations: schema.discardValues ? {} : tr.observations,
  };
}

export function schemaDetail(s: TraceSchema): { kinds: number | 'all'; fields: 'all' | 'restricted'; aggregation: number; edges: string; values: boolean; relations: boolean } {
  return { kinds: s.eventKinds === '*' ? 'all' : s.eventKinds.length, fields: s.fields ? 'restricted' : 'all', aggregation: s.temporalAggregation, edges: s.causalEdges, values: !s.discardValues, relations: !s.flattenRelations };
}

/** Distinctions a schema cannot record relative to another (trace-schema contraction). */
export function schemaLoss(from: TraceSchema, to: TraceSchema, observedKinds: string[]): string[] {
  const lost: string[] = [];
  const has = (s: TraceSchema, k: string) => s.eventKinds === '*' || s.eventKinds.includes(k);
  for (const k of observedKinds) if (has(from, k) && !has(to, k)) lost.push(`event kind ${k}`);
  if (!from.discardValues && to.discardValues) lost.push('value payloads');
  if (!from.flattenRelations && to.flattenRelations) lost.push('relation structure');
  if (to.temporalAggregation > from.temporalAggregation) lost.push(`timing finer than ${to.temporalAggregation}`);
  if (from.causalEdges === 'all' && to.causalEdges !== 'all') lost.push('cause edges to dropped events');
  return lost;
}
