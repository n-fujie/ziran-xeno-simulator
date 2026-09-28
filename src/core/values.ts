// Open operational values.
//
// The core stores opaque values. It needs only enough structure to decide (a) whether an operational
// difference occurred and (b) what, if anything, penetrates along a coupling. Those decisions are
// delegated to value semantics, looked up by the value's kind. Numbers are handled by the *scalar
// adapter*; they are one kind among others, not the ontology of the world.
//
// Built-in kinds: scalar (JS numbers), vector, relation, event, opaque (anything else), unknown.
// Domains may register further kinds. Distance/magnitude are optional and only exist where a kind
// declares them meaningful — the core never assumes commensurability across kinds.
import { canonical } from './hash.ts';

export type OperationalValue = unknown;

export interface ValueSemantics {
  kind: string;
  /** Did an operational difference occur between a and b? */
  equals(a: unknown, b: unknown): boolean;
  /** Structured description of the difference (recorded in the trace). */
  difference?(before: unknown, after: unknown): unknown;
  /** What a coupling carries when this value changes; null means nothing penetrates. */
  transmit?(before: unknown, after: unknown): unknown | null;
  /** How a carried difference of this kind lands on a target value. Default: replace. */
  receive?(target: unknown, carried: unknown): unknown;
  /** Size of a carried difference, only where meaningful (used for loss thresholds). */
  magnitude?(carried: unknown): number;
  /** Distance between two values, only where a domain declares it meaningful. */
  distance?(a: unknown, b: unknown): number;
  /** Serialization for traces (default: JSON). */
  serialize?(v: unknown): unknown;
  /** Short rendering for trace views. */
  render?(v: unknown): string;
  /** What distinctions are retained / lost / new / unknown when a value of this kind is replaced by `after`. */
  distinctions?(before: unknown, after: unknown): Distinctions;
}

export interface Distinctions { retained: string[]; lost: string[]; new: string[]; unknown: string[] }

export interface RelationValue { kind: 'relation'; edges: [string, string, string?][] }
export interface EventValue { kind: 'event'; type: string; payload?: unknown; id?: string }
export interface VectorValue { kind: 'vector'; v: number[] }
export interface UnknownValue { kind: 'unknown'; about?: string }

const EPS = 1e-12;

export function kindOf(v: unknown): string {
  if (typeof v === 'number') return 'scalar';
  if (v === undefined) return 'none';
  if (v && typeof v === 'object' && typeof (v as { kind?: unknown }).kind === 'string') return (v as { kind: string }).kind;
  return 'opaque';
}

const edgeKey = (e: [string, string, string?]) => `${e[0]}→${e[1]}${e[2] ? ':' + e[2] : ''}`;

export const BUILTIN_SEMANTICS: ValueSemantics[] = [
  {
    kind: 'scalar',
    equals: (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= EPS,
    difference: (a, b) => (typeof b === 'number' ? b - (typeof a === 'number' ? a : 0) : null),
    transmit: (a, b) => (typeof b === 'number' ? b - (typeof a === 'number' ? a : 0) : null),
    receive: (t, d) => (typeof t === 'number' || t === undefined ? ((t as number) ?? 0) + (d as number) : t),
    magnitude: (d) => Math.abs(d as number),
    distance: (a, b) => Math.abs((a as number) - (b as number)),
  },
  {
    kind: 'vector',
    equals: (a, b) => { const x = (a as VectorValue)?.v, y = (b as VectorValue)?.v; return !!x && !!y && x.length === y.length && x.every((v, i) => Math.abs(v - y[i]) <= EPS); },
    difference: (a, b) => ({ kind: 'vector', v: (b as VectorValue).v.map((y, i) => y - ((a as VectorValue)?.v?.[i] ?? 0)) }),
    transmit: (a, b) => ({ kind: 'vector', v: (b as VectorValue).v.map((y, i) => y - ((a as VectorValue)?.v?.[i] ?? 0)) }),
    receive: (t, d) => ({ kind: 'vector', v: (d as VectorValue).v.map((x, i) => x + ((t as VectorValue)?.v?.[i] ?? 0)) }),
    magnitude: (d) => Math.hypot(...(d as VectorValue).v),
    distance: (a, b) => Math.hypot(...(a as VectorValue).v.map((x, i) => x - (b as VectorValue).v[i])),
  },
  {
    kind: 'relation',
    equals: (a, b) => canonical(((a as RelationValue)?.edges ?? []).map(edgeKey).sort()) === canonical(((b as RelationValue)?.edges ?? []).map(edgeKey).sort()),
    difference: (a, b) => relationDiff(a as RelationValue, b as RelationValue),
    transmit: (a, b) => { const d = relationDiff(a as RelationValue, b as RelationValue); return d.added.length || d.removed.length ? d : null; },
    receive: (t, d) => {
      const cur = new Map(((t as RelationValue)?.edges ?? []).map((e) => [edgeKey(e), e] as const));
      const dd = d as { added: [string, string, string?][]; removed: [string, string, string?][] };
      for (const e of dd.removed) cur.delete(edgeKey(e));
      for (const e of dd.added) cur.set(edgeKey(e), e);
      return { kind: 'relation', edges: [...cur.values()].sort((x, y) => edgeKey(x).localeCompare(edgeKey(y))) };
    },
    magnitude: (d) => { const dd = d as { added: unknown[]; removed: unknown[] }; return dd.added.length + dd.removed.length; },
  },
  {
    kind: 'event',
    equals: (a, b) => canonical(a) === canonical(b),
    difference: (a, b) => ({ from: (a as EventValue)?.type ?? null, to: (b as EventValue).type }),
    transmit: (_a, b) => b,
    receive: (_t, d) => d,
  },
  { kind: 'unknown', equals: (a, b) => canonical(a) === canonical(b), difference: () => ({ undeterminable: true }), transmit: () => null },
  { kind: 'opaque', equals: (a, b) => canonical(a) === canonical(b), difference: () => ({ changed: true }), transmit: (_a, b) => b, receive: (_t, d) => d },
];

function relationDiff(a: RelationValue | undefined, b: RelationValue | undefined) {
  const A = new Map((a?.edges ?? []).map((e) => [edgeKey(e), e] as const)), B = new Map((b?.edges ?? []).map((e) => [edgeKey(e), e] as const));
  return { added: [...B].filter(([k]) => !A.has(k)).map(([, e]) => e), removed: [...A].filter(([k]) => !B.has(k)).map(([, e]) => e) };
}

export class ValueRegistry {
  private m = new Map<string, ValueSemantics>();
  constructor(extra: ValueSemantics[] = []) { for (const s of [...BUILTIN_SEMANTICS, ...extra]) this.m.set(s.kind, s); }
  /** Runtime registration (no core edits). Returns false if the kind already exists. */
  add(s: ValueSemantics): boolean { if (this.m.has(s.kind)) return false; this.m.set(s.kind, s); return true; }
  remove(kind: string): boolean { if (BUILTIN_SEMANTICS.some((b) => b.kind === kind)) return false; return this.m.delete(kind); }
  clone(): ValueRegistry { const r = new ValueRegistry(); r.m = new Map(this.m); return r; }
  isBuiltin(kind: string): boolean { return BUILTIN_SEMANTICS.some((b) => b.kind === kind); }
  get(kind: string): ValueSemantics { return this.m.get(kind) ?? this.m.get('opaque')!; }
  of(v: unknown): ValueSemantics { return this.get(kindOf(v)); }
  /** Whether an operational difference occurred between two values (kind change always counts). */
  same(a: unknown, b: unknown): boolean {
    const ka = kindOf(a), kb = kindOf(b);
    if (ka !== kb) return false;
    if (ka === 'none') return true;
    return this.get(ka).equals(a, b);
  }
  kinds(): string[] { return [...this.m.keys()]; }
}

/** Scalar adapter view: the number, or undefined when the value is not a scalar. */
export function asScalar(v: unknown): number | undefined { return typeof v === 'number' ? v : undefined; }

/** JSON-safe rendering for traces (values are data, never functions). */
export function toData(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' || v === null) return v;
  try { return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'function' ? '[fn]' : x))); } catch { return String(v); }
}

/** Scalar adapter for reading storage outside rules: the number, or `d` when the value is not a scalar. */
export const sc = (v: unknown, d = 0): number => (typeof v === 'number' ? v : d);

/** Scalar view of a state: non-scalar values are omitted, never converted into numeric placeholders. */
export function scalarView(s: Record<string, unknown>): Record<string, number> {
  const o: Record<string, number> = {};
  for (const [k, v] of Object.entries(s)) if (typeof v === 'number') o[k] = v;
  return o;
}

/** Default distinction accounting when a representation changes kind. */
export function defaultDistinctions(kb: string, ka: string): Distinctions {
  if (kb === ka) return { retained: [`${kb} structure`], lost: [], new: [], unknown: [] };
  const lost = kb === 'relation' ? ['which elements are related to which (edge identities)'] : kb === 'vector' ? ['per-component values'] : kb === 'event' ? ['event type and payload'] : kb === 'scalar' ? ['magnitude ordering and arithmetic differences'] : [`distinctions internal to ${kb}`];
  return { retained: [], lost, new: [`distinctions internal to ${ka}`], unknown: [`correspondence between ${kb} and ${ka} descriptions`] };
}
