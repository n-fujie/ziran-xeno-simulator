// Minimal symbolic core.
//
// The core knows only: storage keys holding *opaque operational values* (numbers are one kind, handled
// by a scalar adapter — see values.ts), operational addresses that need not coincide with storage, an open
// configuration, clocks, ignition rules, couplings (penetration channels),
// observation apparatuses, probes (possibilities), and the trace.
// "Human", "agent", "body", "market", "belief", "goal", "capability" etc. do
// not exist here. Domain layers compose them — if they need them at all —
// out of these positions. See DESIGN.md for why each object is non-redundant.

import type { ValueSemantics, OperationalValue } from './values.ts';
import type { DescriptionFacet } from './description.ts';
import type { MetaEntry } from './meta.ts';
export type { ValueSemantics, OperationalValue } from './values.ts';

/** A storage key. Implementation identity only — it does not assert an ontological address. */
export type Address = string;

/**
 * An operational address: a revisable relation between an operational difference and storage.
 * One operational address may span several storage nodes; one storage node may belong to several
 * operational addresses; addresses may split, merge, become unavailable, become unresolved, or
 * re-ignite under a new address (lineage). Persistent identity is not required.
 */
export interface OperationalAddressSpec {
  id: string;
  storage: Address[];
  domains?: string[];
  status?: 'resolved' | 'unresolved' | 'unavailable' | 'uncertain';
  lineage?: string[];
  /** Transient: becomes unavailable at this engine time. */
  ttl?: number;
}

/** Descriptive aids only (medium, scale, tags). Never primitive partitions. */
export interface AddressMeta {
  medium?: string;
  scale?: string;
  tags?: string[];
}

// ---------------------------------------------------------------- configuration

/** Configuration dimensions are open, revisable, and may be partially unknown. */
export type DimStatus = 'specified' | 'partial' | 'unknown';

export interface Dimension {
  key: string;
  value?: unknown;
  status: DimStatus;
  resolution?: number;
  relevance?: number;
  /** Keys this dimension was split/merged/replaced from. */
  lineage?: string[];
}

// ---------------------------------------------------------------- clocks

/** Each process runs on its own clock. There is no global simulation clock
 *  beyond the scheduler's ordering of events. */
export interface ClockSpec {
  id: string;
  period: number;
  phase?: number;
  jitter?: number;
  /** Descriptive timescale label: machine, sensor, body, social, geological … */
  label?: string;
  /** Partial coupling: the clock's rate is modulated by a world value. */
  rate?: { address: Address; gain: number; min?: number };
}

// ---------------------------------------------------------------- observation

/**
 * Epistemic status of a world difference relative to one apparatus.
 * There is deliberately NO 'absent'. Measurement failure never becomes
 * ontological absence.
 */
export type EpistemicStatus =
  | 'detected'
  | 'pending'
  | 'not-measured'
  | 'boundary-hidden'
  | 'below-resolution'
  | 'scale-incompatible'
  | 'temporal-window-incompatible'
  | 'apparatus-incompatible'
  | 'inaccessible';

export const NON_DETECTION_STATUSES: readonly EpistemicStatus[] = [
  'not-measured', 'boundary-hidden', 'below-resolution', 'scale-incompatible',
  'temporal-window-incompatible', 'apparatus-incompatible', 'inaccessible',
];

export type Aggregate = 'mean' | 'sum' | 'max' | 'min' | 'first' | 'spread';

export interface ChannelSpec {
  id: string;
  clock: string;
  /** Placement. Entries ending in '*' are prefix patterns. */
  reads: Address[];
  aggregate?: Aggregate;
  /** Quantum. 0 = exact. */
  resolution?: number;
  /** Apparatus-compatible range; outside it the reading is incompatible. */
  range?: [number, number];
  /** Visible address prefixes. Reads outside the boundary are hidden. */
  boundary?: string[];
  /** Temporal integration window (engine time). 0 = instantaneous. */
  window?: number;
  noise?: number;
  modality?: string;
  /** Sensing consumes a resource per sample; when unmet, the reading is inaccessible. */
  cost?: { address: Address; amount: number };
  /** A constructed variable computed from other channels of the same apparatus. */
  construct?: { op: 'diff' | 'sub' | 'sum' | 'product' | 'ratio' | 'abs'; of: string[] };
  enabled?: boolean;
}

export interface ApparatusSpec {
  id: string;
  label?: string;
  channels: ChannelSpec[];
  /** External/working memory: number of previous frames folded into the observation key. */
  memory?: number;
  /** Clock whose ticks define this apparatus's observation frames. */
  frameClock?: string;
  /** Track aliasing (same observation + same intervention → divergent next observation). */
  aliasing?: boolean;
}

/** Scalar view of an observation (`value`), plus the open reading (`open`) when it is not a scalar. */
export interface Observation {
  value: number | null;
  status: EpistemicStatus;
  t: number;
  open?: unknown;
}

/** Summary of a counterfactual lookahead fork (used e.g. by observation revision). */
export interface LookaheadResult {
  horizon: number;
  detected: Record<Address, number>;
  detectedLate: Record<Address, number>;
  blocked: Record<Address, number>;
  blockedLate: Record<Address, number>;
  probes: Record<string, number | null>;
  resources: Record<Address, number>;
  spaceChange: { added: Record<string, string[]>; removed: Record<string, string[]> };
}

// ---------------------------------------------------------------- rules / operations

export interface Ctx {
  readonly t: number;
  readonly tick: number;
  /** Scalar adapter: the number stored at `a` (0 if absent from storage). Throws on non-scalar values. */
  get(a: Address): number;
  /** Open read: the operational value as stored (undefined if no storage). */
  value(a: Address): OperationalValue;
  kind(a: Address): string;
  same(a: OperationalValue, b: OperationalValue): boolean;
  has(a: Address): boolean;
  /** Operational address view: status, storage nodes and their values (values only when resolved). */
  op(id: string): { status: string; storage: Address[]; values: OperationalValue[]; domains: string[] } | undefined;
  opAddresses(): string[];
  obsValue(apparatus: string, channel: string): unknown;
  /** Counterfactual lookahead: fork, apply `change`, run `horizon`; null inside a lookahead. */
  lookahead(change: (e: Emit) => void, horizon: number): LookaheadResult | null;
  /** Ids active in a meta registry (e.g. 'description-facet', 'value-kind'). */
  metaActive(registry: string): string[];
  dim(key: string): Dimension | undefined;
  obs(apparatus: string, channel: string): Observation;
  addresses(prefix: string): Address[];
  hist(a: Address, lag: number): number;
  rng(): number;
  param<T = unknown>(key: string): T;
  aliasing(apparatus: string): AliasingRecord[];
  apparatus(id: string): ApparatusSpec | undefined;
  coupling(id: string): CouplingSpec | undefined;
  couplingsFrom(a: Address): CouplingSpec[];
  couplingsTo(a: Address): CouplingSpec[];
  ruleEnabled(id: string): boolean;
}

export interface Emit {
  /** Write any operational value. */
  set(a: Address, v: OperationalValue): void;
  /** Scalar adapter (no effect on non-scalar values). */
  add(a: Address, dv: number): void;
  /** Resource use. If any consume in an operation cannot be met, the whole operation is blocked. */
  consume(a: Address, amount: number): void;
  dim: {
    set(key: string, patch: Partial<Dimension>): void;
    remove(key: string): void;
    split(key: string, into: Dimension[]): void;
    merge(keys: string[], into: Dimension): void;
    replace(key: string, withDim: Dimension): void;
  };
  apparatus: {
    add(spec: ApparatusSpec): void;
    remove(id: string): void;
    addChannel(app: string, ch: ChannelSpec): void;
    removeChannel(app: string, ch: string): void;
    patchChannel(app: string, ch: string, patch: Partial<ChannelSpec>): void;
    patch(app: string, patch: Partial<Omit<ApparatusSpec, 'channels'>>): void;
  };
  rule: { enable(id: string): void; disable(id: string): void; add(spec: RuleSpec): void };
  coupling: { set(spec: CouplingSpec): void; remove(id: string): void; patch(id: string, patch: Partial<CouplingSpec>): void };
  clock: { patch(id: string, patch: Partial<ClockSpec>): void };
  /** Storage-level operations. */
  address: { meta(a: Address, meta: AddressMeta): void; reassign(fromPrefix: string, toPrefix: string): void; remove(prefix: string): void };
  /** Operational-address operations (independent of storage identity). */
  opAddress: {
    bind(id: string, storage: Address[], domains?: string[]): void;
    split(id: string, parts: Record<string, Address[]>): void;
    merge(ids: string[], into: string): void;
    unavailable(id: string): void;
    unresolve(id: string): void;
    relate(id: string, domain: string): void;
    reignite(from: string, to: string, storage: Address[]): void;
    /** Location unknown among candidate storage sets. */
    uncertain(id: string, candidates: Address[][]): void;
    relateAddress(id: string, to: string, type: string): void;
  };
  /** Level D: meta-configuration changes (registered as ordinary, traced reorganizations). */
  meta: {
    registerFacet(f: DescriptionFacet): void;
    retireFacet(id: string): void;
    registerValueKind(s: ValueSemantics): void;
    retireValueKind(kind: string): void;
    register(e: MetaEntry): void;
    retire(registry: string, id: string): void;
  };
  note(kind: string, data?: unknown): void;
}

export interface RuleSpec {
  id: string;
  clock: string;
  label?: string;
  tags?: string[];
  /** Ignition condition: boolean, or a propensity in [0,1]. */
  when: (c: Ctx) => boolean | number;
  /** Operation: intents are computed at ignition, applied after `delay`. */
  then: (c: Ctx, e: Emit) => void;
  delay?: number;
  refractory?: number;
  enabled?: boolean;
  /** Marks this rule as a correction. `premise` states (engine-side) what the correction assumes. */
  /** `basis` holds the values read at ignition (keys 'a:addr', 'o:app/ch'). */
  correction?: { premise: (c: Ctx, basis: Record<string, unknown>) => boolean | null };
  /** Issue a Transition-Ignition Identifier for this rule's ignitions. */
  tii?: boolean;
  /** Trigger a reachability analysis after this rule ignites. */
  analyze?: boolean;
}

// ---------------------------------------------------------------- penetration

export type Transform = 'linear' | 'threshold' | 'saturate' | 'sign' | 'invert' | 'square' | 'rectify';

/** A channel along which a local difference penetrates elsewhere. Directional (nonreciprocal by default). */
export interface CouplingSpec {
  id: string;
  from: Address;
  to: Address;
  gain: number;
  delay?: number;
  medium?: string;
  transform?: Transform;
  threshold?: number;
  /** Arrivals below this magnitude are lost. */
  lossThreshold?: number;
  enabled?: boolean;
  /** Optional map for non-scalar carried differences (gain/transform apply to scalars only). */
  carry?: (carried: unknown) => unknown | null;
}

// ---------------------------------------------------------------- possibilities

export interface ProbeSpec {
  id: string;
  label?: string;
  test: (c: Ctx) => boolean;
  /** Once satisfied, stays satisfied (declared monotone; not a demonstration of irreversibility). */
  monotone?: boolean;
}

export interface ReachOption {
  id: string;
  interventions?: Intervention[];
  seedOffset?: number;
}

// ---------------------------------------------------------------- interventions

export type Intervention =
  | { id: string; t: number; kind: 'set'; address: Address; value: OperationalValue }
  | { id: string; t: number; kind: 'add'; address: Address; value: number }
  | { id: string; t: number; kind: 'emit'; apply: (c: Ctx, e: Emit) => void; label?: string }
  | { id: string; t?: number; kind: 'suppress'; rule: string; occurrence?: number }
  | { id: string; t?: number; kind: 'shift'; rule: string; occurrence?: number; dt: number };

// ---------------------------------------------------------------- world spec

export interface WorldSpec {
  id: string;
  title?: string;
  seed: number;
  horizon: number;
  params?: Record<string, unknown>;
  config?: Dimension[];
  /** Storage: opaque operational values. Numbers are handled by the scalar adapter. */
  state: Record<Address, OperationalValue>;
  addresses?: Record<Address, AddressMeta>;
  /** Domain-provided comparison/transition semantics for further value kinds. */
  semantics?: ValueSemantics[];
  /** Domain-registered description facets (added to the default facets). */
  facets?: DescriptionFacet[];
  /** Inherited meta-configuration adjustments applied before the run (e.g. retire a default facet). */
  metaOverrides?: { retire?: { registry: string; id: string }[]; register?: MetaEntry[] };
  operationalAddresses?: OperationalAddressSpec[];
  clocks: ClockSpec[];
  rules: RuleSpec[];
  couplings?: CouplingSpec[];
  apparatus?: ApparatusSpec[];
  probes?: ProbeSpec[];
  interventions?: Intervention[];
  /**
   * Reachability analysis. `probe-relative` reachability is computed only relative to the declared probes,
   * this option menu, this horizon and the current observation configuration; `emergent` reachability
   * records description-space expansion/contraction in the same forks, independently of probes.
   */
  reach?: {
    every?: number;
    horizon: number;
    options?: ReachOption[];
    /** Run reachability after every operation (small worlds only). */
    onEveryOperation?: boolean;
  };
}

export interface AliasingRecord {
  apparatus: string;
  key: string;
  sig: string;
  next: [string, string];
  t: [number, number];
  /** Retained physical snapshots of the two apparently identical states. */
  snapshots: [Record<Address, OperationalValue>, Record<Address, OperationalValue>];
  /** Snapshots one frame earlier (for constructed/memory candidates). */
  previous: [Record<Address, OperationalValue> | null, Record<Address, OperationalValue> | null];
  seq: number;
}

/** Loose event record. `seq` is its index in the trace. */
export interface TraceEvent {
  seq: number;
  t: number;
  kind: string;
  [k: string]: any;
}
