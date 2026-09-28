// Transition engine.
//
//   C_t → Δ_t → ignition → operation → real effect → penetration → feedback → reorganization → C_{t+1}
//   and, where the description space itself changes,  S_t → S_{t+1}  (Level C),
//   and, where the meta-configuration changes,        M_t → M_{t+1}  (Level D).
//
// These are positions in a process, not substances. The engine:
//  * schedules asynchronous clocks (no single simulation clock),
//  * evaluates ignition conditions against configuration, world, and observation,
//  * computes operation intents at ignition and applies them after a delay,
//  * stores opaque operational values; value semantics decide whether a difference occurred and what
//    penetrates (numbers are one kind, via the scalar adapter),
//  * records only *actual* downstream differences as real effects,
//  * propagates differences along couplings (penetration) with delay/transform/loss,
//  * detects feedback structurally (a descendant of an ignition modifies what it read),
//  * treats reorganization of configuration/apparatus/rules/couplings/addresses as ordinary effects,
//  * tracks the operational description space S and records S_t → S_{t+1} lineage (Level C),
//  * keeps epistemic status per apparatus and never converts non-detection into absence,
//  * records aliasing (same observation + same intervention → divergent next observation),
//  * computes probe-relative reachability and emergent (description-space) reachability by forking.

import type {
  Address, AddressMeta, AliasingRecord, ApparatusSpec, ChannelSpec, ClockSpec, CouplingSpec, Ctx,
  Dimension, Emit, EpistemicStatus, Intervention, Observation, ProbeSpec, RuleSpec, TraceEvent, WorldSpec, LookaheadResult,
} from './types.ts';
import { Heap, type QItem } from './heap.ts';
import { seedStream, next as rnext, gauss, type RngState } from './rng.ts';
import { hashOf, sha256, canonical } from './hash.ts';
import { ValueRegistry, kindOf, toData, defaultDistinctions, type ValueSemantics, type Distinctions } from './values.ts';
import { describeSpace, diffSpace, spaceHash, changeSignature, DEFAULT_FACETS, type Space, type DescriptionFacet } from './description.ts';
import { MetaConfiguration, type MetaEntry } from './meta.ts';

export const ENGINE_VERSION = '0.3.0';

/** The engine's own meta-configuration: which value kinds, facets, transition-class constructor and trace schema are in force. */
export function engineMeta(spec: WorldSpec, values: ValueRegistry): MetaConfiguration {
  const entries: MetaEntry[] = [
    ...values.kinds().map((k) => ({ id: k, registry: 'value-kind', origin: (values.isBuiltin(k) ? 'supplied' : 'domain-registered') as MetaEntry['origin'], description: `value semantics for kind ${k}`, impl: values.get(k) })),
    ...DEFAULT_FACETS.map((f) => ({ id: f.id, registry: 'description-facet', origin: 'supplied' as const, description: f.label, impl: f })),
    ...(spec.facets ?? []).map((f) => ({ id: f.id, registry: 'description-facet', origin: (f.origin ?? 'domain-registered') as MetaEntry['origin'], description: f.label, impl: f })),
    { id: 'rule', registry: 'transition-class', origin: 'supplied', description: 'ignition condition → operation (intents computed at ignition, applied after delay)' },
    { id: 'coupling', registry: 'transition-class', origin: 'supplied', description: 'difference penetration along a directional coupling (delay, transform, loss)' },
    { id: 'engine-full', registry: 'trace-schema', origin: 'supplied', description: 'all event kinds, all fields, cause edges, no temporal aggregation' },
  ];
  const m = new MetaConfiguration(entries);
  for (const r of spec.metaOverrides?.register ?? []) m.register({ ...r, origin: r.origin ?? 'inherited' }, -1, 'inherited');
  for (const r of spec.metaOverrides?.retire ?? []) m.retire(r.registry, r.id, -1, 'inherited');
  m.lineage = [];
  return m;
}

export interface EngineOptions {
  /** Full causal trace. Forks for reachability run with trace=false. */
  trace?: boolean;
  recordObservations?: boolean;
  reachability?: boolean;
  maxHops?: number;
  feedbackDepth?: number;
  maxAliasing?: number;
  seedOffset?: number;
  /** Inside a lookahead fork: no nested lookahead, no aliasing. */
  lookahead?: boolean;
}

interface RuleRt { spec: RuleSpec; enabled: boolean; lastIgnite: number; count: number; lastCond: boolean; lastEvalSeq: number }
interface ChanRt { lastQ: unknown; lastRaw: Record<Address, unknown>; pending: number[]; prevSource: number | null }
type Snap = Record<Address, unknown>;
interface FrameRt {
  keys: string[]; lastKey?: string; lastSig: string; lastT: number;
  lastSnap: Snap | null; prevSnap: Snap | null;
  trans: Map<string, { next: string; snap: Snap | null; prev: Snap | null; t: number; aliased?: boolean }>;
  sig: Set<string>; aliasing: AliasingRecord[]; consumed: number;
}
type Intent =
  | { op: 'set'; a: Address; v: unknown } | { op: 'add'; a: Address; v: number } | { op: 'consume'; a: Address; v: number }
  | { op: 'note'; kind: string; data?: unknown }
  | { op: 'reorg'; target: string; action: string; args: any[] };

interface PendingCorrection { ign: number; rule: string; premise: (c: Ctx, basis: Record<string, unknown>) => boolean | null; basis: Record<string, unknown>; valid: boolean | null; reconfigT: number | null; detT: number }
export interface OpAddr {
  id: string; storage: string[]; domains: string[]; status: 'resolved' | 'unresolved' | 'unavailable' | 'uncertain'; lineage: string[];
  /** Candidate storage sets when the location is uncertain. */
  candidates?: string[][];
  /** Relations to other operational addresses. */
  relations?: { to: string; type: string }[];
  /** Transient addresses expire at this engine time. */
  expires?: number;
  identityPreserved?: boolean;
}

const EPS = 1e-12;
const num = (v: unknown): number => (typeof v === 'number' ? v : v === undefined ? 0 : NaN);

export class Engine {
  readonly spec: WorldSpec;
  readonly opts: Required<Omit<EngineOptions, 'seedOffset' | 'lookahead'>> & { seedOffset: number; lookahead: boolean };
  readonly tr: boolean;
  values: ValueRegistry;
  metaConfig!: MetaConfiguration;
  specHash = '';
  t = 0;

  state: Record<Address, unknown> = {};
  meta: Record<Address, AddressMeta> = {};
  dims: Record<string, Dimension> = {};
  clocks: Record<string, { spec: ClockSpec; tick: number }> = {};
  rules: Record<string, RuleRt> = {};
  couplings: Record<string, CouplingSpec> = {};
  apparatus: Record<string, ApparatusSpec> = {};
  opAddr: Record<string, OpAddr> = {};
  probes: ProbeSpec[] = [];
  stochastic = new Set<string>();

  private byClock: Record<string, string[]> | null = null;
  private couplingsByFrom: Record<Address, string[]> | null = null;
  private readIndex: Record<Address, string[]> | null = null;
  private opIndex: Record<Address, string[]> | null = null;
  chan: Record<string, ChanRt> = {};
  latest: Record<string, Observation & { seq: number }> = {};
  frames: Record<string, FrameRt> = {};

  queue = new Heap();
  private qseq = 0;
  rngRule!: RngState; rngObs!: RngState; rngClock!: RngState;

  events: TraceEvent[] = [];
  epistemic: Record<string, Record<number, EpistemicStatus>> = {};
  lastEffect: Record<Address, number> = {};
  latestDetection: Record<string, number> = {};
  changeLog: Record<Address, [number, unknown][]> = {};
  readSets = new Map<number, Set<string>>();
  loops = new Map<string, { originRule: string; key: string; kind: string; count: number; first: number; firstSeq: number; latencySum: number }>();
  interactions = new Map<string, { address: Address; rules: string[]; mode: string; count: number }>();
  observations: Record<string, Record<string, [number, unknown, EpistemicStatus][]>> = {};
  probeState: Record<string, { satisfied: boolean; first: number | null; flips: number }> = {};
  private corrections: PendingCorrection[] = [];
  private suppress: { rule: string; occurrence?: number }[] = [];
  private shifts: { rule: string; occurrence?: number; dt: number }[] = [];
  private reachPrev: any = null;
  private emergentPrev: any = null;
  private lastReachT = -Infinity;
  reachHistory: any[] = [];
  emergentHistory: any[] = [];
  // description space
  private space: Space | null = null;
  private spaceDirty = false;
  private pendingReorgs: number[] = [];
  spaceLineage: { t: number; seq: number; from: string; to: string; added: Record<string, string[]>; removed: Record<string, string[]>; facetsAdded: string[]; facetsRemoved: string[]; signature: string; cause: number[]; level: 'C' | 'D' }[] = [];
  metaLineage: { t: number; seq: number; op: string; registry: string; id: string; origin: string; from: string; to: string; via?: string }[] = [];
  initialSpace: Record<string, string[]> = {};
  /** Union of every descriptor seen so far (novelty relative to the historical trace). */
  everSeen: Record<string, Set<string>> = {};

  constructor(spec: WorldSpec, opts: EngineOptions = {}, parent?: Engine) {
    this.spec = spec;
    const tr = opts.trace ?? true;
    this.tr = tr;
    this.opts = {
      trace: tr,
      recordObservations: opts.recordObservations ?? tr,
      reachability: opts.reachability ?? tr,
      maxHops: opts.maxHops ?? 24,
      feedbackDepth: opts.feedbackDepth ?? 16,
      maxAliasing: opts.lookahead ? 0 : (opts.maxAliasing ?? 40),
      seedOffset: opts.seedOffset ?? 0,
      lookahead: opts.lookahead ?? false,
    };
    this.values = parent ? parent.values.clone() : new ValueRegistry(spec.semantics ?? []);
    if (parent) { this.metaConfig = parent.metaConfig.clone(); this.cloneFrom(parent); return; }
    this.metaConfig = engineMeta(spec, this.values);

    const seed = spec.seed + this.opts.seedOffset * 7919;
    this.rngRule = seedStream(seed, 1); this.rngObs = seedStream(seed, 2); this.rngClock = seedStream(seed, 3);
    this.state = { ...spec.state };
    for (const [a, m] of Object.entries(spec.addresses ?? {})) this.meta[a] = { ...m };
    for (const d of spec.config ?? []) this.dims[d.key] = structuredClone(d);
    for (const c of spec.clocks) this.clocks[c.id] = { spec: { ...c }, tick: 0 };
    for (const r of spec.rules) this.registerRule(r);
    for (const c of spec.couplings ?? []) this.couplings[c.id] = { ...c };
    for (const a of spec.apparatus ?? []) this.installApparatus(structuredClone(a));
    for (const o of spec.operationalAddresses ?? []) this.opAddr[o.id] = { id: o.id, storage: [...o.storage], domains: [...(o.domains ?? [])], status: o.status ?? 'resolved', lineage: [...(o.lineage ?? [])] };
    this.probes = spec.probes ?? [];
    for (const p of this.probes) this.probeState[p.id] = { satisfied: false, first: null, flips: 0 };
    for (const [a, v] of Object.entries(this.state)) this.changeLog[a] = [[0, v]];
    for (const o of spec.operationalAddresses ?? []) if (o.ttl !== undefined) this.opAddr[o.id].expires = o.ttl;
    if (tr) {
      this.specHash = specHashOf(spec);
      this.space = describeSpace(this, this.facets());
      this.initialSpace = Object.fromEntries(Object.entries(this.space).map(([k, v]) => [k, [...v].sort()]));
      for (const [k, v] of Object.entries(this.space)) this.everSeen[k] = new Set(v);
    }

    for (const c of spec.clocks) this.schedule(c.phase ?? 0, 3, 'tick', c.id);
    for (const iv of spec.interventions ?? []) this.intervene(iv);
    const R = spec.reach;
    if (R?.every && this.opts.reachability) for (let t = R.every; t <= spec.horizon; t += R.every) this.schedule(t, 9, 'reach', null);
  }

  // ------------------------------------------------------------------ fork

  fork(opts: EngineOptions = {}): Engine {
    return new Engine(this.spec, { trace: false, reachability: false, ...opts }, this);
  }

  private cloneFrom(p: Engine): void {
    this.t = p.t;
    this.state = { ...p.state };
    this.meta = structuredClone(p.meta);
    this.dims = structuredClone(p.dims);
    for (const [k, c] of Object.entries(p.clocks)) this.clocks[k] = { spec: { ...c.spec }, tick: c.tick };
    for (const [k, r] of Object.entries(p.rules)) this.rules[k] = { ...r, lastEvalSeq: -1 };
    for (const [k, c] of Object.entries(p.couplings)) this.couplings[k] = { ...c };
    this.apparatus = structuredClone(p.apparatus);
    this.opAddr = structuredClone(p.opAddr);
    for (const [k, v] of Object.entries(p.everSeen)) this.everSeen[k] = new Set(v);
    this.stochastic = new Set(p.stochastic);
    for (const [k, c] of Object.entries(p.chan)) this.chan[k] = { lastQ: c.lastQ, lastRaw: { ...c.lastRaw }, pending: [], prevSource: c.prevSource };
    for (const [k, o] of Object.entries(p.latest)) this.latest[k] = { ...o, seq: -1 };
    for (const id of Object.keys(this.apparatus)) { this.frames[id] = newFrame(); this.epistemic[id] = {}; }
    this.probes = p.probes;
    for (const pr of this.probes) this.probeState[pr.id] = { ...p.probeState[pr.id] };
    const keep = 256;
    for (const [a, log] of Object.entries(p.changeLog)) {
      let i = log.length - 1; while (i > 0 && log[i][0] > p.t - keep) i--;
      this.changeLog[a] = log.slice(i);
    }
    const mix = (r: RngState, k: number) => ({ s: (r.s ^ Math.imul(this.opts.seedOffset + k, 0x9e3779b9)) >>> 0 });
    this.rngRule = this.opts.seedOffset ? mix(p.rngRule, 1) : { ...p.rngRule };
    this.rngObs = this.opts.seedOffset ? mix(p.rngObs, 2) : { ...p.rngObs };
    this.rngClock = this.opts.seedOffset ? mix(p.rngClock, 3) : { ...p.rngClock };
    this.suppress = [...p.suppress]; this.shifts = [...p.shifts];
    // A traced fork has its own event numbering: queued items must not point into the parent's trace.
    for (const it of p.queue.items) if (it.kind !== 'reach') {
      let data = it.data;
      if (this.tr && it.kind === 'arrive') data = { ...data, cause: -1 };
      if (this.tr && it.kind === 'op') data = { ...data, ign: -1, corr: undefined };
      this.queue.items.push({ ...it, data });
    }
    this.qseq = p.qseq;
    if (this.tr) this.space = describeSpace(this, this.facets());
  }

  /** Active description facets (from the meta-configuration). */
  facets(): DescriptionFacet[] { const f = this.metaConfig.active('description-facet').map((e) => e.impl as DescriptionFacet).filter(Boolean); this.valueFacets = f.some((x) => x.dependsOnValues); return f; }
  private valueFacets = false;
  /** Trace serialization of a value through its kind's semantics. */
  serialize(v: unknown): unknown { return this.ser(v); }

  // ------------------------------------------------------------------ registration

  private registerRule(r: RuleSpec): void {
    this.rules[r.id] = { spec: r, enabled: r.enabled ?? true, lastIgnite: -Infinity, count: 0, lastCond: false, lastEvalSeq: -1 };
    this.byClock = null;
  }

  private installApparatus(a: ApparatusSpec): void {
    this.apparatus[a.id] = a;
    for (const ch of a.channels) this.chan[a.id + '/' + ch.id] ??= { lastQ: null, lastRaw: {}, pending: [], prevSource: null };
    this.frames[a.id] = newFrame();
    this.epistemic[a.id] ??= {};
    this.readIndex = null;
  }

  private rulesOn(clock: string): string[] {
    if (!this.byClock) {
      this.byClock = {};
      for (const id of Object.keys(this.rules).sort()) (this.byClock[this.rules[id].spec.clock] ??= []).push(id);
    }
    return this.byClock[clock] ?? [];
  }

  private outCouplings(a: Address): string[] {
    if (!this.couplingsByFrom) {
      this.couplingsByFrom = {};
      for (const id of Object.keys(this.couplings).sort()) (this.couplingsByFrom[this.couplings[id].from] ??= []).push(id);
    }
    return this.couplingsByFrom[a] ?? [];
  }

  /** address → ['app/ch', …] for channels whose placement covers the address. */
  channelsReading(a: Address): string[] {
    if (!this.readIndex) this.readIndex = {};
    let hit = this.readIndex[a];
    if (hit) return hit;
    hit = [];
    for (const app of Object.values(this.apparatus)) for (const ch of app.channels) {
      if (!ch.construct && ch.reads.some((r) => matches(r, a))) hit.push(app.id + '/' + ch.id);
    }
    this.readIndex[a] = hit;
    return hit;
  }

  /** storage key → operational addresses that include it. */
  private opsOf(a: Address): string[] {
    if (!this.opIndex) {
      this.opIndex = {};
      for (const o of Object.values(this.opAddr)) for (const s of o.storage) (this.opIndex[s] ??= []).push(o.id);
    }
    return this.opIndex[a] ?? [];
  }

  resolveReads(ch: ChannelSpec): Address[] {
    const out: Address[] = [];
    for (const r of ch.reads) {
      if (r.endsWith('*')) { const p = r.slice(0, -1); for (const a of Object.keys(this.state).sort()) if (a.startsWith(p)) out.push(a); }
      else out.push(r);
    }
    return out;
  }

  // ------------------------------------------------------------------ scheduling / running

  private schedule(t: number, pri: number, kind: string, data: any): void {
    this.queue.push({ t, pri, seq: this.qseq++, kind, data });
  }

  intervene(iv: Intervention): void {
    if (iv.kind === 'suppress') { this.suppress.push({ rule: iv.rule, occurrence: iv.occurrence }); return; }
    if (iv.kind === 'shift') { this.shifts.push({ rule: iv.rule, occurrence: iv.occurrence, dt: iv.dt }); return; }
    this.schedule(iv.t, 0, 'intervene', iv);
  }

  run(until: number = this.spec.horizon): this {
    for (;;) {
      const top = this.queue.peek();
      if (!top || top.t > until) break;
      this.step();
    }
    this.t = Math.max(this.t, until);
    return this;
  }

  step(): QItem | undefined {
    const it = this.queue.pop();
    if (!it) return undefined;
    this.t = it.t;
    switch (it.kind) {
      case 'tick': this.onTick(it.data); break;
      case 'arrive': this.onArrive(it.data); break;
      case 'op': this.applyOp(it.data, null); break;
      case 'intervene': this.onIntervention(it.data); break;
      case 'reach': this.reach(null); break;
    }
    this.expireTransient();
    if (this.spaceDirty) this.updateSpace();
    return it;
  }

  /** Transient operational addresses become unavailable when their time is over (traced). */
  private expireTransient(): void {
    for (const o of Object.values(this.opAddr)) if (o.expires !== undefined && o.status !== 'unavailable' && this.t >= o.expires) {
      const b = structuredClone(o); o.status = 'unavailable'; this.opIndex = null; this.spaceDirty = true;
      const seq = this.ev('reorganization', { target: 'op-address', op: 'unavailable', key: o.id, before: b, after: structuredClone(o), via: 'transience', cause: [], derived: 'transient address expired' });
      this.pendingReorgs.push(seq);
    }
  }

  // ------------------------------------------------------------------ description space (Level C)

  private updateSpace(): void {
    this.spaceDirty = false;
    if (!this.tr || !this.space) { this.pendingReorgs = []; return; }
    const facets = this.facets();
    const next = describeSpace(this, facets);
    const d = diffSpace(this.space, next, facets);
    const reorgs = this.pendingReorgs; this.pendingReorgs = [];
    const facetLevel = d.facetsAdded.length || d.facetsRemoved.length;
    for (const s of reorgs) if (this.events[s] && this.events[s].level !== 'D') this.events[s].level = d.empty ? 'B' : facetLevel && !Object.keys(d.added).length && !Object.keys(d.removed).length ? 'D' : 'C';
    if (d.empty) return;
    const from = spaceHash(this.space), to = spaceHash(next);
    const cause = reorgs.length ? reorgs : this.events.length ? [this.events.length - 1] : [];
    const novelToHistory: Record<string, string[]> = {};
    for (const [c, v] of Object.entries(d.added)) { const nv = v.filter((x) => !this.everSeen[c]?.has(x)); if (nv.length) novelToHistory[c] = nv; }
    const contraction = Object.values(d.removed).reduce((a, v) => a + v.length, 0) + d.facetsRemoved.length;
    const expansion = Object.values(d.added).reduce((a, v) => a + v.length, 0) + d.facetsAdded.length;
    const level: 'C' | 'D' = facetLevel ? 'D' : 'C';
    const seq = this.ev('state-space', { from, to, added: d.added, removed: d.removed, facetsAdded: d.facetsAdded, facetsRemoved: d.facetsRemoved, signature: changeSignature(d), expansion, contraction, novelToHistory, level, cause });
    this.spaceLineage.push({ t: this.t, seq, from, to, added: d.added, removed: d.removed, facetsAdded: d.facetsAdded, facetsRemoved: d.facetsRemoved, signature: changeSignature(d), cause, level });
    for (const [c, v] of Object.entries(next)) { const u = (this.everSeen[c] ??= new Set()); for (const x of v) u.add(x); }
    this.space = next;
  }

  currentSpace(): Space { return describeSpace(this, this.facets()); }

  // ------------------------------------------------------------------ ctx / emit

  ctx(reads: Set<string> | null, tick = 0): Ctx {
    const self = this;
    const R = (k: string) => { if (reads) reads.add(k); };
    return {
      t: this.t, tick,
      get(a) {
        R('a:' + a);
        const v = self.state[a];
        if (v === undefined) return 0;
        if (typeof v === 'number') return v;
        throw new TypeError(`scalar read of a non-scalar operational value at '${a}' (kind ${kindOf(v)}); use ctx.value()`);
      },
      value(a) { R('a:' + a); return self.state[a]; },
      kind(a) { R('a:' + a); return kindOf(self.state[a]); },
      same(a, b) { return self.values.same(a, b); },
      has(a) { R('a:' + a); return a in self.state; },
      op(id) {
        R('op:' + id);
        const o = self.opAddr[id]; if (!o) return undefined;
        for (const s of o.storage) R('a:' + s);
        return { status: o.status, storage: [...o.storage], domains: [...o.domains], values: o.status === 'resolved' ? o.storage.map((s) => self.state[s]) : [] };
      },
      opAddresses() { return Object.keys(self.opAddr).sort(); },
      dim(k) { R('d:' + k); return self.dims[k]; },
      obs(app, ch) {
        R('o:' + app + '/' + ch);
        return self.latest[app + '/' + ch] ?? { value: null, status: 'pending', t: -1, seq: -1 };
      },
      obsValue(app, ch) { R('o:' + app + '/' + ch); const o = self.latest[app + '/' + ch]; return o ? (o.open !== undefined ? o.open : o.value) : undefined; },
      addresses(prefix) { R('p:' + prefix); return Object.keys(self.state).filter((a) => a.startsWith(prefix)).sort(); },
      hist(a, lag) { R('a:' + a); return num(self.valueAt(a, self.t - lag)); },
      rng() { return rnext(self.rngRule); },
      param<T>(k: string) { return (self.spec.params ?? {})[k] as T; },
      aliasing(app) { R('x:' + app); const f = self.frames[app]; return f ? f.aliasing.slice(f.consumed) : []; },
      apparatus(id) { R('o:' + id + '/*'); return self.apparatus[id]; },
      coupling(id) { R('c:' + id); return self.couplings[id]; },
      couplingsFrom(a) { return self.outCouplings(a).map((id) => self.couplings[id]).filter((c) => c.enabled !== false); },
      couplingsTo(a) { return Object.values(self.couplings).filter((c) => c.to === a && c.enabled !== false); },
      ruleEnabled(id) { R('r:' + id); return !!self.rules[id]?.enabled; },
      lookahead(change, horizon) { return self.opts.lookahead ? null : self.lookahead(change, horizon); },
      metaActive(registry) { R('m:' + registry); return self.metaConfig.active(registry).map((e) => e.id); },
    };
  }

  private emitter(intents: Intent[]): Emit {
    const re = (target: string, action: string) => (...args: any[]) => { intents.push({ op: 'reorg', target, action, args }); };
    return {
      set: (a, v) => { intents.push({ op: 'set', a, v }); },
      add: (a, v) => { intents.push({ op: 'add', a, v }); },
      consume: (a, v) => { intents.push({ op: 'consume', a, v }); },
      note: (kind, data) => { intents.push({ op: 'note', kind, data }); },
      dim: { set: re('dimension', 'set'), remove: re('dimension', 'remove'), split: re('dimension', 'split'), merge: re('dimension', 'merge'), replace: re('dimension', 'replace') },
      apparatus: { add: re('apparatus', 'add'), remove: re('apparatus', 'remove'), addChannel: re('apparatus', 'addChannel'), removeChannel: re('apparatus', 'removeChannel'), patchChannel: re('apparatus', 'patchChannel'), patch: re('apparatus', 'patch') },
      rule: { enable: re('rule', 'enable'), disable: re('rule', 'disable'), add: re('rule', 'add') },
      coupling: { set: re('coupling', 'set'), remove: re('coupling', 'remove'), patch: re('coupling', 'patch') },
      clock: { patch: re('clock', 'patch') },
      address: { meta: re('address', 'meta'), reassign: re('address', 'reassign'), remove: re('address', 'remove') },
      opAddress: { bind: re('op-address', 'bind'), split: re('op-address', 'split'), merge: re('op-address', 'merge'), unavailable: re('op-address', 'unavailable'), unresolve: re('op-address', 'unresolve'), relate: re('op-address', 'relate'), reignite: re('op-address', 'reignite'), uncertain: re('op-address', 'uncertain'), relateAddress: re('op-address', 'relateAddress') },
      meta: { registerFacet: re('meta', 'registerFacet'), retireFacet: re('meta', 'retireFacet'), registerValueKind: re('meta', 'registerValueKind'), retireValueKind: re('meta', 'retireValueKind'), register: re('meta', 'register'), retire: re('meta', 'retire') },
    } as Emit;
  }

  // ------------------------------------------------------------------ trace

  private ev(kind: string, data: Record<string, any>): number {
    if (!this.tr) return -1;
    const seq = this.events.length;
    this.events.push({ seq, t: this.t, kind, ...data });
    return seq;
  }

  // ------------------------------------------------------------------ clocks & rules

  private onTick(clockId: string): void {
    const ck = this.clocks[clockId];
    if (!ck) return;
    ck.tick++;
    // 1. observation on this clock (non-constructed channels first)
    for (const app of Object.values(this.apparatus)) {
      const chs = app.channels.filter((c) => c.clock === clockId && c.enabled !== false);
      for (const ch of chs) if (!ch.construct) this.sample(app, ch);
      for (const ch of chs) if (ch.construct) this.sample(app, ch);
      if ((app.frameClock ?? app.channels[0]?.clock) === clockId) this.frame(app);
    }
    // 2. ignition: all conditions and intents are computed against the same pre-tick state
    const ops: { rule: string; ign: number; intents: Intent[]; delay: number; corr?: PendingCorrection }[] = [];
    for (const id of this.rulesOn(clockId)) {
      const rt = this.rules[id];
      if (!rt || !rt.enabled) continue;
      if (rt.spec.refractory && this.t - rt.lastIgnite < rt.spec.refractory) continue;
      const reads = this.tr ? new Set<string>() : null;
      const c = this.ctx(reads, ck.tick);
      const p = rt.spec.when(c);
      if (typeof p === 'number' && p > 0 && p < 1 && !this.stochastic.has(id)) { this.stochastic.add(id); this.spaceDirty = true; }
      const ignite = p === true || (typeof p === 'number' && (p >= 1 || (p > 0 && rnext(this.rngRule) < p)));
      if (this.tr && rt.lastCond && !ignite) {
        const cause = this.changedSince(reads!, rt.lastEvalSeq);
        if (cause.length) {
          const by = [...new Set(cause.map((s) => this.originOf(s)).filter((o) => o !== 'rule:' + id))];
          if (by.length) this.ev('suppression', { rule: id, by, cause });
        }
      }
      if (ignite) {
        const occ = rt.count++;
        rt.lastIgnite = this.t;
        let cause = this.tr ? this.changedSince(reads!, rt.lastEvalSeq) : [];
        const sup = this.suppress.find((s) => s.rule === id && (s.occurrence === undefined || s.occurrence === occ));
        if (sup) {
          this.ev('ignition', { rule: id, clock: clockId, tick: ck.tick, occurrence: occ, onset: !rt.lastCond, reads: reads ? [...reads] : [], cond: +p, cause, suppressed: true });
        } else {
          const intents: Intent[] = [];
          const thenReads = this.tr ? new Set<string>() : null;
          rt.spec.then(this.ctx(thenReads, ck.tick), this.emitter(intents));
          const allReads = reads ? new Set([...reads, ...thenReads!, 'r:' + id]) : null;
          // What made this operation what it is: new differences on anything the condition or the operation read.
          if (allReads) cause = this.changedSince(allReads, rt.lastEvalSeq);
          const ign = this.ev('ignition', {
            rule: id, clock: clockId, tick: ck.tick, occurrence: occ, onset: !rt.lastCond, reads: reads ? [...reads] : [],
            inputs: reads ? this.inputsOf(reads) : undefined,
            opReads: thenReads ? [...thenReads] : [], cond: +p, cause,
            tii: rt.spec.tii && this.tr ? tiiFor(this.specHash, id, occ, this.t) : undefined,
          });
          if (allReads) this.readSets.set(ign, allReads);
          for (const f of Object.values(this.frames)) f.sig.add(id);
          const shift = this.shifts.find((s) => s.rule === id && (s.occurrence === undefined || s.occurrence === occ));
          const delay = Math.max(0, (rt.spec.delay ?? 0) + (shift?.dt ?? 0));
          let corr: PendingCorrection | undefined;
          if (rt.spec.correction && this.tr && !this.opts.lookahead) {
            const basis = this.inputsOf(allReads!);
            const valid = rt.spec.correction.premise(this.ctx(null), basis);
            corr = { ign, rule: id, premise: rt.spec.correction.premise, basis, valid, reconfigT: valid === false ? this.t : null, detT: this.t };
            this.corrections.push(corr);
          }
          ops.push({ rule: id, ign, intents, delay, corr });
          if (rt.spec.analyze && this.opts.reachability) this.schedule(this.t, 9, 'reach', ign);
        }
      }
      rt.lastCond = ignite;
      rt.lastEvalSeq = this.events.length - 1;
    }
    // 3. apply
    const writes = new Map<Address, { rule: string; d: number; set: boolean }[]>();
    for (const op of ops) {
      if (op.delay > 0) this.schedule(this.t + op.delay, 2, 'op', op);
      else this.applyOp(op, writes);
    }
    if (this.tr) this.detectInteractions(writes);
    // 4. corrections: environmental reconfiguration monitoring
    if (this.tr) for (const pc of this.corrections) if (pc.reconfigT === null && pc.valid) {
      if (pc.premise(this.ctx(null), pc.basis) === false) pc.reconfigT = this.t;
    }
    // 5. probes
    this.checkProbes();
    if (this.spec.reach?.onEveryOperation && ops.length && this.opts.reachability) this.schedule(this.t, 9, 'reach', ops[ops.length - 1].ign);
    // 6. next tick (clock may be rate-coupled to the world)
    const s = ck.spec;
    if (s.period > 0) {
      let rate = 1;
      if (s.rate) rate = Math.max(s.rate.min ?? 0.05, 1 + s.rate.gain * (num(this.state[s.rate.address]) || 0));
      const j = s.jitter ? 1 + s.jitter * (2 * rnext(this.rngClock) - 1) : 1;
      this.schedule(this.t + (s.period * j) / rate, 3, 'tick', clockId);
    }
  }

  private inputsOf(reads: Set<string>): Record<string, unknown> {
    const o: Record<string, unknown> = {};
    for (const k of reads) {
      if (k.startsWith('a:')) { const v = this.state[k.slice(2)]; o[k] = v === undefined ? 0 : typeof v === 'number' ? v : toData(v); }
      else if (k.startsWith('o:') && !k.endsWith('/*')) { const l = this.latest[k.slice(2)]; o[k] = l ? (l.open !== undefined ? toData(l.open) : l.value) : null; }
    }
    return o;
  }

  private checkProbes(): void {
    if (!this.probes.length) return;
    const c = this.ctx(null);
    for (const p of this.probes) {
      const st = this.probeState[p.id];
      if (p.monotone && st.satisfied) continue;
      const now = !!p.test(c);
      if (now !== st.satisfied) {
        st.satisfied = now; st.flips++;
        if (now && st.first === null) st.first = this.t;
        this.ev('probe', { probe: p.id, satisfied: now });
      }
    }
  }

  private changedSince(reads: Set<string>, since: number): number[] {
    const out: number[] = [];
    for (const k of reads) {
      let s: number | undefined;
      if (k.startsWith('a:')) s = this.lastEffect[k.slice(2)];
      else if (k.startsWith('o:')) s = this.latestDetection[k.slice(2)];
      if (s !== undefined && s > since) out.push(s);
    }
    return out.sort((a, b) => a - b);
  }

  /** The via-string of the operation/coupling/intervention an event descends from. */
  originOf(seq: number): string {
    const e = this.events[seq];
    if (!e) return '?';
    if (e.via) return e.via;
    if (e.kind === 'detection') return 'observation:' + e.apparatus;
    return e.kind;
  }

  // ------------------------------------------------------------------ operations

  private applyOp(op: { rule: string; ign: number; intents: Intent[]; delay: number; corr?: PendingCorrection }, writes: Map<Address, { rule: string; d: number; set: boolean }[]> | null): void {
    const via = 'rule:' + op.rule;
    const opSeq = this.ev('operation', { rule: op.rule, ignition: op.ign, delay: op.delay, intents: op.intents.length, cause: op.ign >= 0 ? [op.ign] : [] });
    const cons = op.intents.filter((i) => i.op === 'consume') as { a: Address; v: number }[];
    for (const c of cons) {
      const have = num(this.state[c.a]);
      if (!(have + EPS >= c.v)) {
        this.ev('blocked', { rule: op.rule, via, resource: c.a, needed: c.v, available: Number.isFinite(have) ? have : null, cause: [opSeq] });
        if (op.corr) this.finishCorrection(op.corr, opSeq, 'not-executed');
        return;
      }
    }
    let real = 0;
    const note = (a: Address, d: number, set: boolean) => { if (writes) (writes.get(a) ?? writes.set(a, []).get(a)!).push({ rule: op.rule, d, set }); };
    for (const i of op.intents) {
      if (i.op === 'consume') { if (this.write(i.a, num(this.state[i.a]) - i.v, via, [opSeq]) >= 0) real++; }
      else if (i.op === 'set') { const d = typeof i.v === 'number' ? i.v - (num(this.state[i.a]) || 0) : NaN; if (this.write(i.a, i.v, via, [opSeq]) >= 0) real++; note(i.a, d, true); }
      else if (i.op === 'add') { if (this.addScalar(i.a, i.v, via, [opSeq]) >= 0) real++; note(i.a, i.v, false); }
      else if (i.op === 'note') this.ev('note', { note: i.kind, data: i.data, via, cause: [opSeq] });
      else if (this.reorganize(i.target, i.action, i.args, via, [opSeq]) >= 0) real++;
    }
    if (this.tr && opSeq >= 0) this.events[opSeq].realEffects = real;
    if (op.corr) this.finishCorrection(op.corr, opSeq, 'executed');
  }

  /** Trace serialization through the value kind's own semantics when it declares one. */
  private ser(v: unknown): unknown { const s = v === undefined ? undefined : this.values.of(v).serialize; return s ? toData(s(v)) : toData(v); }

  private addScalar(a: Address, dv: number, via: string, cause: number[]): number {
    const cur = this.state[a];
    if (cur !== undefined && typeof cur !== 'number') {
      this.ev('no-effect', { address: a, via, cause, intended: dv, why: 'scalar-add-on-non-scalar', valueKind: kindOf(cur) });
      return -1;
    }
    return this.write(a, ((cur as number | undefined) ?? 0) + dv, via, cause);
  }

  private finishCorrection(pc: PendingCorrection, opSeq: number, exec: 'executed' | 'not-executed'): void {
    const i = this.corrections.indexOf(pc); if (i >= 0) this.corrections.splice(i, 1);
    const atEffect = exec === 'executed' ? pc.premise(this.ctx(null), pc.basis) : null;
    const epistemic = pc.valid === null ? 'undetermined' : pc.valid ? 'correct' : 'incorrect';
    let operational: string;
    if (epistemic !== 'correct') operational = 'n/a';
    else if (exec === 'not-executed') operational = 'not-executed';
    else if (atEffect === false) operational = 'too-late';
    else if (atEffect === null) operational = 'undetermined';
    else operational = 'in-time';
    const label = epistemic === 'correct'
      ? (operational === 'in-time' ? 'correct-in-time' : operational === 'too-late' ? 'correct-but-too-late' : 'correct-' + operational)
      : epistemic;
    this.ev('correction', {
      rule: pc.rule, ignition: pc.ign, operation: opSeq, epistemic, operational, label,
      detectionT: pc.detT, effectT: this.t, correctionLatency: this.t - pc.detT,
      reconfigT: pc.reconfigT, reconfigLatency: pc.reconfigT === null ? null : pc.reconfigT - pc.detT, cause: [opSeq],
    });
  }

  /** Apply a world write. Returns the effect seq, or -1 when no operational difference resulted. */
  write(a: Address, value: unknown, via: string, cause: number[], hop = 0, medium?: string): number {
    const had = a in this.state;
    const before = this.state[a];
    if (typeof value === 'number' && !Number.isFinite(value)) {
      this.ev('no-effect', { address: a, via, cause, intended: String(value), why: 'non-finite' });
      return -1;
    }
    if (value === undefined) { this.ev('no-effect', { address: a, via, cause, why: 'undefined-value' }); return -1; }
    if (had && this.values.same(before, value)) {
      if (this.tr && hop === 0) this.ev('no-effect', { address: a, via, cause, intended: toData(value), why: 'no-difference' });
      return -1;
    }
    const kb = kindOf(before), ka = kindOf(value);
    const scalar = typeof value === 'number' && (typeof before === 'number' || before === undefined);
    this.state[a] = value;
    if (!had) { this.readIndex = null; this.spaceDirty = true; }
    if (had && kb !== ka) this.spaceDirty = true;
    // facets may depend on non-scalar content (relations, events) or declare value dependence
    if (!scalar || this.valueFacets) this.spaceDirty = true;
    (this.changeLog[a] ??= []).push([this.t, value]);
    if (!this.tr) { this.propagate(a, before, value, -1, hop); return 0; }
    const rec: Record<string, any> = scalar
      ? { address: a, before: (before as number | undefined) ?? 0, after: value, delta: (value as number) - ((before as number | undefined) ?? 0), via, cause, hop, medium, appeared: !had || undefined }
      : { address: a, before: this.ser(before), after: this.ser(value), valueKind: ka, difference: toData(this.values.get(ka).difference?.(kb === ka ? before : undefined, value) ?? null), via, cause, hop, medium, appeared: !had || undefined,
          rendered: this.values.get(ka).render?.(value),
          representationChange: had && kb !== ka ? { from: kb, to: ka } : undefined,
          distinctions: had && kb !== ka ? (this.values.get(kb).distinctions?.(before, value) ?? defaultDistinctions(kb, ka)) : undefined };
    const ops = this.opsOf(a); if (ops.length) rec.ops = ops;
    const seq = this.ev('effect', rec);
    this.lastEffect[a] = seq;
    this.bookkeepEpistemic(a, seq);
    this.checkFeedback(seq, 'a:' + a, 'world');
    this.propagate(a, before, value, seq, hop);
    return seq;
  }

  // ------------------------------------------------------------------ penetration

  private propagate(a: Address, before: unknown, after: unknown, seq: number, hop: number): void {
    const outs = this.outCouplings(a);
    if (!outs.length) return;
    const scalar = typeof after === 'number' && (typeof before === 'number' || before === undefined);
    const kind = kindOf(after);
    const carried = scalar ? (after as number) - ((before as number | undefined) ?? 0) : this.values.get(kind).transmit?.(kindOf(before) === kind ? before : undefined, after) ?? null;
    for (const id of outs) {
      const c = this.couplings[id];
      if (!c || c.enabled === false) continue;
      if (scalar) {
        const v = transform(c, carried as number) * c.gain;
        this.schedule(this.t + (c.delay ?? 0), 1, 'arrive', { id, v, cause: seq, hop: hop + 1, raw: carried });
      } else {
        const x = carried === null ? null : c.carry ? c.carry(carried) : carried;
        this.schedule(this.t + (c.delay ?? 0), 1, 'arrive', { id, open: x, kind, cause: seq, hop: hop + 1 });
      }
    }
  }

  private onArrive(d: { id: string; v?: number; open?: unknown; kind?: string; cause: number; hop: number; raw?: number }): void {
    const c = this.couplings[d.id];
    const lossAt = c?.lossThreshold ?? 1e-9;
    let why: string | null = null;
    const isOpen = d.kind !== undefined;
    if (!c || c.enabled === false) why = 'coupling-removed';
    else if (!isOpen && Math.abs(d.v!) < lossAt) why = d.v === 0 && (c.transform === 'threshold' || c.transform === 'rectify') ? 'below-threshold' : 'attenuated';
    else if (isOpen && d.open === null) why = 'nothing-transmitted';
    else if (isOpen && this.values.get(d.kind!).magnitude && c.lossThreshold !== undefined && this.values.get(d.kind!).magnitude!(d.open) < c.lossThreshold) why = 'attenuated';
    else if (d.hop > this.opts.maxHops) why = 'hop-limit';
    const cause = d.cause >= 0 ? [d.cause] : [];
    if (why) { this.ev('loss', { coupling: d.id, value: isOpen ? toData(d.open) : d.v, raw: d.raw, why, cause }); return; }
    if (!isOpen) {
      const cur = this.state[c!.to];
      if (cur !== undefined && typeof cur !== 'number') { this.ev('loss', { coupling: d.id, value: d.v, why: 'incommensurable-target', targetKind: kindOf(cur), cause }); return; }
      this.write(c!.to, ((cur as number | undefined) ?? 0) + d.v!, 'coupling:' + d.id, cause, d.hop, c!.medium);
    } else {
      const sem = this.values.get(d.kind!);
      const nextVal = sem.receive ? sem.receive(this.state[c!.to], d.open) : d.open;
      this.write(c!.to, nextVal, 'coupling:' + d.id, cause, d.hop, c!.medium);
    }
  }

  // ------------------------------------------------------------------ feedback

  private checkFeedback(seq: number, key: string, kind: string): void {
    if (!this.tr) return;
    const start = this.events[seq].cause as number[];
    const seen = new Set<number>();
    let frontier = start.slice(); let depth = 0;
    const found: { ign: number; depth: number; mediated: boolean }[] = [];
    // An ignition that read a channel placed on this address has read the address through observation.
    const via = key.startsWith('a:') ? this.channelsReading(key.slice(2)).map((h) => 'o:' + h) : [];
    while (frontier.length && depth < this.opts.feedbackDepth && seen.size < 400) {
      depth++;
      const nxt: number[] = [];
      for (const s of frontier) {
        if (seen.has(s)) continue; seen.add(s);
        const e = this.events[s]; if (!e) continue;
        if (e.kind === 'ignition') {
          const rs = this.readSets.get(s);
          if (rs && (rs.has(key) || wildcardHit(rs, key))) found.push({ ign: s, depth, mediated: false });
          else if (rs && via.some((o) => rs.has(o))) found.push({ ign: s, depth, mediated: true });
        }
        if (e.cause) for (const c of e.cause as number[]) nxt.push(c);
      }
      frontier = nxt;
    }
    for (const f of found) {
      const ign = this.events[f.ign];
      const k = f.mediated ? 'observation-mediated' : kind;
      const sig = ign.rule + '|' + key + '|' + k;
      const L = this.loops.get(sig);
      const lat = this.t - ign.t;
      if (L) { L.count++; L.latencySum += lat; continue; }
      this.loops.set(sig, { originRule: ign.rule, key, kind: k, count: 1, first: this.t, firstSeq: seq, latencySum: lat });
      this.ev('feedback', { origin: f.ign, originRule: ign.rule, returning: seq, key, loop: k, latency: lat, length: f.depth, cause: [seq] });
    }
  }

  // ------------------------------------------------------------------ interactions among simultaneous operations

  private detectInteractions(writes: Map<Address, { rule: string; d: number; set: boolean }[]>): void {
    for (const [a, ws] of writes) {
      const rules = [...new Set(ws.map((w) => w.rule))].sort();
      if (rules.length < 2) continue;
      let mode: string;
      if (ws.some((w) => w.set)) mode = 'conflict';
      else if (ws.every((w) => w.d >= 0) || ws.every((w) => w.d <= 0)) mode = 'cooperation';
      else mode = 'competition';
      const k = a + '|' + rules.join(',');
      const prev = this.interactions.get(k);
      if (prev && prev.mode === mode) { prev.count++; continue; }
      this.interactions.set(k, { address: a, rules, mode, count: 1 });
      this.ev('interaction', { address: a, rules, mode, deltas: ws.map((w) => (Number.isFinite(w.d) ? w.d : null)) });
    }
  }

  // ------------------------------------------------------------------ reorganization

  private reorganize(target: string, action: string, args: any[], via: string, cause: number[]): number {
    let key = '';
    let before: any = null, after: any = null;
    let fbKey = '';
    switch (target) {
      case 'dimension': {
        const [k] = args; key = String(k);
        if (action === 'set') { before = this.dims[k] ?? null; this.dims[k] = Object.assign({ key: k, status: 'specified' as const }, this.dims[k] ?? {}, args[1]); after = this.dims[k]; }
        else if (action === 'remove') { before = this.dims[k] ?? null; delete this.dims[k]; }
        else if (action === 'split') { before = this.dims[k] ?? null; const inherited = this.dims[k]?.lineage ?? []; delete this.dims[k]; after = (args[1] as Dimension[]).map((d) => (this.dims[d.key] = { ...d, lineage: [...new Set([...(d.lineage ?? []), ...inherited, k])] })); }
        else if (action === 'merge') { const keys = args[0] as string[]; key = keys.join('+'); before = keys.map((x) => this.dims[x] ?? null); const inherited = keys.flatMap((x) => this.dims[x]?.lineage ?? []); keys.forEach((x) => delete this.dims[x]); const d = args[1] as Dimension; this.dims[d.key] = { ...d, lineage: [...new Set([...(d.lineage ?? []), ...inherited, ...keys])] }; after = this.dims[d.key]; }
        else if (action === 'replace') { before = this.dims[k] ?? null; const inherited = this.dims[k]?.lineage ?? []; delete this.dims[k]; const d = args[1] as Dimension; this.dims[d.key] = { ...d, lineage: [...new Set([...(d.lineage ?? []), ...inherited, k])] }; after = this.dims[d.key]; }
        fbKey = 'd:' + (action === 'merge' ? (args[0] as string[])[0] : k);
        break;
      }
      case 'apparatus': {
        const [app] = args; key = String(action === 'add' ? app.id : app);
        const A = this.apparatus[key];
        if (action === 'add') { before = A ?? null; this.installApparatus(structuredClone(app)); after = app; }
        else if (!A) { this.ev('no-effect', { via, cause, why: 'apparatus-missing', target, action, key }); return -1; }
        else if (action === 'remove') { before = A; delete this.apparatus[key]; this.readIndex = null; }
        else if (action === 'patch') { before = { ...A, channels: undefined }; Object.assign(A, args[1]); after = { ...A, channels: undefined }; }
        else {
          const chId = action === 'addChannel' ? args[1].id : args[1];
          key = key + '/' + chId;
          const i = A.channels.findIndex((c) => c.id === chId);
          if (action === 'addChannel') { before = i >= 0 ? A.channels[i] : null; if (i >= 0) A.channels[i] = structuredClone(args[1]); else A.channels.push(structuredClone(args[1])); after = args[1]; this.chan[key] ??= { lastQ: null, lastRaw: {}, pending: [], prevSource: null }; }
          else if (i < 0) { this.ev('no-effect', { via, cause, why: 'channel-missing', target, action, key }); return -1; }
          else if (action === 'removeChannel') { before = A.channels[i]; A.channels.splice(i, 1); delete this.latest[key]; }
          else if (action === 'patchChannel') { before = { ...A.channels[i] }; Object.assign(A.channels[i], args[2]); after = { ...A.channels[i] }; }
          this.readIndex = null;
        }
        // The observation map changed: previous aliasing bookkeeping is no longer comparable.
        const f = this.frames[args[0]?.id ?? args[0]]; if (f) { f.trans.clear(); f.lastKey = undefined; f.consumed = f.aliasing.length; }
        fbKey = 'o:' + key;
        break;
      }
      case 'rule': {
        if (action === 'add') { const r = args[0] as RuleSpec; key = r.id; before = this.rules[r.id] ? 'present' : null; this.registerRule(r); after = { id: r.id, clock: r.clock, label: r.label }; }
        else { key = args[0]; const r = this.rules[key]; if (!r) { this.ev('no-effect', { via, cause, why: 'rule-missing', target, action, key }); return -1; }
          before = r.enabled; r.enabled = action === 'enable'; after = r.enabled; if (before === after) return -1; }
        fbKey = 'r:' + key;
        break;
      }
      case 'coupling': {
        if (action === 'set') { const c = args[0] as CouplingSpec; key = c.id; before = this.couplings[c.id] ?? null; this.couplings[c.id] = { ...c }; after = c; }
        else { key = args[0]; const c = this.couplings[key]; if (!c) { this.ev('no-effect', { via, cause, why: 'coupling-missing', target, action, key }); return -1; }
          before = { ...c }; if (action === 'remove') delete this.couplings[key]; else Object.assign(c, args[1]); after = this.couplings[key] ?? null; }
        this.couplingsByFrom = null; fbKey = 'c:' + key;
        break;
      }
      case 'clock': {
        key = args[0]; const c = this.clocks[key]; if (!c) return -1;
        before = { ...c.spec }; Object.assign(c.spec, args[1]); after = { ...c.spec }; fbKey = 'k:' + key;
        break;
      }
      case 'address': {
        if (action === 'meta') { key = args[0]; before = this.meta[key] ?? null; this.meta[key] = { ...(this.meta[key] ?? {}), ...args[1] }; after = this.meta[key]; fbKey = 'a:' + key; }
        else if (action === 'reassign') { const [from, to] = args as [string, string]; key = from + '→' + to; before = from; after = to; this.reassign(from, to); fbKey = 'p:' + from; }
        else if (action === 'remove') { key = args[0]; before = Object.keys(this.state).filter((a) => a.startsWith(key)); this.removePrefix(key); after = null; fbKey = 'p:' + key; }
        this.spaceDirty = true;
        break;
      }
      case 'meta': {
        const r = this.reorganizeMeta(action, args, via);
        if (!r) { this.ev('no-effect', { via, cause, why: 'meta-unchanged', target, action, key: String(args[0]?.id ?? args[0]?.kind ?? args[0]) }); return -1; }
        ({ key, before, after } = r); fbKey = 'm:' + r.registry;
        break;
      }
      case 'op-address': {
        const r = this.reorganizeOpAddress(action, args);
        if (!r) { this.ev('no-effect', { via, cause, why: 'op-address-unchanged', target, action, key: String(args[0]) }); return -1; }
        ({ key, before, after } = r); fbKey = 'op:' + key.split('+')[0];
        break;
      }
      default: return -1;
    }
    this.spaceDirty = true;
    if (!this.tr) return 0;
    const distinctions = target === 'apparatus' ? apparatusDistinctions(action, before, after) : undefined;
    const seq = this.ev('reorganization', { target, op: action, key, before: jsonSafe(before), after: jsonSafe(after), via, cause, distinctions, level: target === 'meta' ? 'D' : undefined });
    if (target === 'meta') {
      const last = this.metaConfig.lineage[this.metaConfig.lineage.length - 1];
      const ms = this.ev('meta-configuration', { op: last.op, registry: last.registry, id: last.id, origin: last.origin, from: last.from, to: last.to, via, cause: [seq] });
      this.metaLineage.push({ t: this.t, seq: ms, op: last.op, registry: last.registry, id: last.id, origin: last.origin, from: last.from, to: last.to, via });
    }
    this.pendingReorgs.push(seq);
    const kind = target === 'dimension' ? 'configuration' : target === 'apparatus' ? 'observation' : target;
    this.checkFeedback(seq, fbKey, kind);
    if (target === 'address' && action === 'remove') this.markUnavailable(key, via, [seq]);
    return seq;
  }

  private reorganizeMeta(action: string, args: any[], via: string): { key: string; before: any; after: any; registry: string } | null {
    const t = this.t;
    switch (action) {
      case 'registerFacet': { const f = args[0] as DescriptionFacet; const ok = this.metaConfig.register({ id: f.id, registry: 'description-facet', origin: f.origin ?? 'generated', description: f.label, impl: f }, t, via); return ok ? { key: f.id, before: null, after: { facet: f.id, label: f.label }, registry: 'description-facet' } : null; }
      case 'retireFacet': { const ok = this.metaConfig.retire('description-facet', args[0], t, via); return ok ? { key: args[0], before: { facet: args[0] }, after: null, registry: 'description-facet' } : null; }
      case 'registerValueKind': { const v = args[0] as ValueSemantics; if (!this.values.add(v)) return null; this.metaConfig.register({ id: v.kind, registry: 'value-kind', origin: 'generated', description: `value semantics for kind ${v.kind}`, impl: v }, t, via); return { key: v.kind, before: null, after: { kind: v.kind }, registry: 'value-kind' }; }
      case 'retireValueKind': { const k = args[0] as string; if (Object.values(this.state).some((x) => kindOf(x) === k)) return null; if (!this.values.remove(k)) return null; this.metaConfig.retire('value-kind', k, t, via); return { key: k, before: { kind: k }, after: null, registry: 'value-kind' }; }
      case 'register': { const e = args[0] as MetaEntry; const ok = this.metaConfig.register({ ...e, origin: e.origin ?? 'generated' }, t, via); return ok ? { key: e.id, before: null, after: { registry: e.registry, id: e.id }, registry: e.registry } : null; }
      case 'retire': { const [reg, id] = args as [string, string]; const ok = this.metaConfig.retire(reg, id, t, via); return ok ? { key: id, before: { registry: reg, id }, after: null, registry: reg } : null; }
    }
    return null;
  }

  private reorganizeOpAddress(action: string, args: any[]): { key: string; before: any; after: any } | null {
    const O = this.opAddr; this.opIndex = null;
    const snap = (id: string) => (O[id] ? structuredClone(O[id]) : null);
    switch (action) {
      case 'bind': { const [id, storage, domains, ttl] = args as [string, string[], string[] | undefined, number | undefined]; const b = snap(id);
        O[id] = { id, storage: [...storage], domains: [...(domains ?? O[id]?.domains ?? [])], status: 'resolved', lineage: O[id]?.lineage ?? [], relations: O[id]?.relations ?? [], ...(ttl !== undefined ? { expires: this.t + ttl } : {}) }; return { key: id, before: b, after: snap(id) }; }
      case 'uncertain': { const [id, candidates] = args as [string, string[][]]; const b = snap(id);
        O[id] = { id, storage: [...new Set(candidates.flat())], domains: O[id]?.domains ?? [], status: 'uncertain', lineage: O[id]?.lineage ?? [], candidates: candidates.map((c) => [...c]), relations: O[id]?.relations ?? [] };
        return { key: id, before: b, after: snap(id) }; }
      case 'relateAddress': { const [id, to, type] = args as [string, string, string]; if (!O[id] || O[id].relations?.some((r) => r.to === to && r.type === type)) return null; const b = snap(id); (O[id].relations ??= []).push({ to, type }); return { key: id, before: b, after: snap(id) }; }
      case 'split': { const [id, parts] = args as [string, Record<string, string[]>]; const b = snap(id); if (!b) return null;
        for (const [nid, st] of Object.entries(parts)) O[nid] = { id: nid, storage: [...st], domains: [...b.domains], status: 'resolved', lineage: [...b.lineage, id] };
        O[id].status = 'unavailable'; return { key: id, before: b, after: Object.keys(parts).map(snap) }; }
      case 'merge': { const [ids, into] = args as [string[], string]; const bs = ids.map(snap); if (bs.some((x) => !x)) return null;
        O[into] = { id: into, storage: [...new Set(bs.flatMap((x) => x!.storage))], domains: [...new Set(bs.flatMap((x) => x!.domains))], status: 'resolved', lineage: [...new Set([...bs.flatMap((x) => x!.lineage), ...ids])] };
        for (const id of ids) if (id !== into) O[id].status = 'unavailable';
        return { key: ids.join('+'), before: bs, after: snap(into) }; }
      case 'unavailable': case 'unresolve': { const [id] = args as [string]; if (!O[id]) return null; const st = action === 'unavailable' ? 'unavailable' : 'unresolved'; if (O[id].status === st) return null;
        const b = snap(id); O[id].status = st; return { key: id, before: b, after: snap(id) }; }
      case 'relate': { const [id, dom] = args as [string, string]; if (!O[id] || O[id].domains.includes(dom)) return null; const b = snap(id); O[id].domains.push(dom); return { key: id, before: b, after: snap(id) }; }
      case 'reignite': { const [from, to, storage] = args as [string, string, string[]]; const b = snap(from);
        // Re-ignition does not preserve identity: `to` is a different operational address with a lineage link.
        O[to] = { id: to, storage: [...storage], domains: b ? [...b.domains] : [], status: 'resolved', lineage: [...(b?.lineage ?? []), from], identityPreserved: false };
        return { key: `${from}⇒${to}`, before: b, after: snap(to) }; }
    }
    return null;
  }

  /** Operational addresses whose storage has entirely disappeared become unavailable (traced). */
  private markUnavailable(prefix: string, via: string, cause: number[]): void {
    for (const o of Object.values(this.opAddr)) {
      if (o.status === 'unavailable' || !o.storage.some((s) => s.startsWith(prefix))) continue;
      if (o.storage.every((s) => !(s in this.state))) {
        const b = structuredClone(o); o.status = 'unavailable';
        const seq = this.ev('reorganization', { target: 'op-address', op: 'unavailable', key: o.id, before: b, after: structuredClone(o), via, cause, derived: 'storage removed' });
        this.pendingReorgs.push(seq);
      }
    }
  }

  private reassign(from: string, to: string): void {
    const rn = (a: string) => (a.startsWith(from) ? to + a.slice(from.length) : a);
    for (const a of Object.keys(this.state)) if (a.startsWith(from)) {
      const b = rn(a); this.state[b] = this.state[a]; delete this.state[a];
      if (this.meta[a]) { this.meta[b] = this.meta[a]; delete this.meta[a]; }
      this.changeLog[b] = this.changeLog[a] ?? []; delete this.changeLog[a];
    }
    for (const c of Object.values(this.couplings)) { c.from = rn(c.from); c.to = rn(c.to); }
    for (const app of Object.values(this.apparatus)) for (const ch of app.channels) ch.reads = ch.reads.map((r) => (r.endsWith('*') ? rn(r.slice(0, -1)) + '*' : rn(r)));
    // Storage moved; operational addresses follow the storage (identity of the difference is not assumed).
    for (const o of Object.values(this.opAddr)) o.storage = o.storage.map(rn);
    this.couplingsByFrom = null; this.readIndex = null; this.opIndex = null;
  }

  private removePrefix(p: string): void {
    for (const a of Object.keys(this.state)) if (a.startsWith(p)) { delete this.state[a]; delete this.meta[a]; }
    for (const [id, c] of Object.entries(this.couplings)) if (c.from.startsWith(p) || c.to.startsWith(p)) delete this.couplings[id];
    for (const app of Object.values(this.apparatus)) for (const ch of app.channels) ch.reads = ch.reads.filter((r) => !r.startsWith(p));
    this.couplingsByFrom = null; this.readIndex = null;
  }

  // ------------------------------------------------------------------ interventions

  private onIntervention(iv: Intervention): void {
    const via = 'intervention:' + iv.id;
    const s = this.ev('intervention', { id: iv.id, action: iv.kind, address: (iv as any).address, value: toData((iv as any).value), label: (iv as any).label });
    for (const f of Object.values(this.frames)) f.sig.add(via);
    const cause = s >= 0 ? [s] : [];
    if (iv.kind === 'set') this.write(iv.address, iv.value, via, cause);
    else if (iv.kind === 'add') this.addScalar(iv.address, iv.value, via, cause);
    else if (iv.kind === 'emit') this.applyIntents(iv.apply, via, cause);
  }

  private applyIntents(apply: (c: Ctx, e: Emit) => void, via: string, cause: number[]): void {
    const intents: Intent[] = [];
    apply(this.ctx(null), this.emitter(intents));
    for (const i of intents) {
      if (i.op === 'set') this.write(i.a, i.v, via, cause);
      else if (i.op === 'add') this.addScalar(i.a, i.v, via, cause);
      else if (i.op === 'consume') this.addScalar(i.a, -i.v, via, cause);
      else if (i.op === 'note') this.ev('note', { note: i.kind, data: i.data, via, cause });
      else this.reorganize(i.target, i.action, i.args, via, cause);
    }
  }

  // ------------------------------------------------------------------ lookahead

  /** Counterfactual anticipation: fork (traced, no reachability, no aliasing), apply a change, run, summarize. */
  lookahead(change: (e: Emit) => void, horizon: number): LookaheadResult {
    const f = new Engine(this.spec, { trace: true, reachability: false, recordObservations: false, lookahead: true }, this);
    // Called mid-tick, the current clock's next tick is not yet queued: make sure every clock keeps running in the fork.
    const queued = new Set(f.queue.items.filter((it) => it.kind === 'tick').map((it) => it.data));
    for (const [id, c] of Object.entries(f.clocks)) if (!queued.has(id) && c.spec.period > 0) f.schedule(f.t + c.spec.period, 3, 'tick', id);
    const s0 = describeSpace(f);
    f.applyIntents((_c, e) => change(e), 'lookahead', []);
    const t0 = f.t, until = f.t + horizon, mid = f.t + horizon / 2;
    f.run(until);
    const detected: Record<string, number> = {}, detectedLate: Record<string, number> = {};
    const tot: Record<string, [number, number]> = {}, totL: Record<string, [number, number]> = {};
    for (const e of f.events) if (e.kind === 'effect') {
      const hit = Object.values(f.epistemic).some((m) => m[e.seq] === 'detected') ? 1 : 0;
      const T = (tot[e.address] ??= [0, 0]); T[0] += hit; T[1]++;
      if (e.t >= mid) { const L = (totL[e.address] ??= [0, 0]); L[0] += hit; L[1]++; }
    }
    for (const [a, [h, n]] of Object.entries(tot)) detected[a] = h / n;
    for (const [a, [h, n]] of Object.entries(totL)) detectedLate[a] = h / n;
    const blocked: Record<string, number> = {}, blockedLate: Record<string, number> = {};
    for (const e of f.events) if (e.kind === 'blocked') { blocked[e.resource] = (blocked[e.resource] ?? 0) + 1; if (e.t >= mid) blockedLate[e.resource] = (blockedLate[e.resource] ?? 0) + 1; }
    const resources: Record<string, number> = {};
    for (const [a, m] of Object.entries(f.meta)) if (m.tags?.includes('resource') && typeof f.state[a] === 'number') resources[a] = f.state[a] as number;
    for (const ch of Object.values(f.apparatus).flatMap((a) => a.channels)) if (ch.cost && typeof f.state[ch.cost.address] === 'number') resources[ch.cost.address] = f.state[ch.cost.address] as number;
    const probes: Record<string, number | null> = {};
    for (const p of f.probes) probes[p.id] = f.probeState[p.id].first !== null && f.probeState[p.id].first! >= t0 ? f.probeState[p.id].first : this.probeState[p.id].satisfied ? t0 : null;
    const d = diffSpace(s0, describeSpace(f));
    return { horizon, detected, detectedLate, blocked, blockedLate, probes, resources, spaceChange: { added: d.added as Record<string, string[]>, removed: d.removed as Record<string, string[]> } };
  }

  // ------------------------------------------------------------------ observation

  private boundaryAllows(ch: ChannelSpec, a: Address): boolean {
    return !ch.boundary || ch.boundary.some((p) => a.startsWith(p));
  }

  private bookkeepEpistemic(a: Address, seq: number): void {
    const hits = this.channelsReading(a);
    for (const app of Object.values(this.apparatus)) {
      const mine = hits.filter((h) => h.startsWith(app.id + '/'));
      const E = (this.epistemic[app.id] ??= {});
      if (!mine.length) { E[seq] = 'not-measured'; continue; }
      let visible = 0, enabled = 0;
      for (const h of mine) {
        const ch = app.channels.find((c) => app.id + '/' + c.id === h);
        if (!ch) continue;
        if (ch.enabled === false) continue;
        enabled++;
        if (!this.boundaryAllows(ch, a)) continue;
        visible++;
        this.chan[h].pending.push(seq);
      }
      E[seq] = !enabled ? 'inaccessible' : visible ? 'pending' : 'boundary-hidden';
    }
  }

  valueAt(a: Address, t: number): unknown {
    const log = this.changeLog[a];
    if (!log || !log.length) return this.state[a] ?? 0;
    let lo = 0, hi = log.length - 1;
    if (t < log[0][0]) return log[0][1];
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (log[m][0] <= t) lo = m; else hi = m - 1; }
    return log[lo][1];
  }

  private windowMean(a: Address, w: number): number {
    const log = this.changeLog[a];
    if (!log || !log.length || w <= 0) return num(this.state[a]);
    const t0 = this.t - w; let acc = 0; let tEnd = this.t;
    for (let i = log.length - 1; i >= 0; i--) {
      const [ti, vi] = log[i]; const ts = Math.max(ti, t0);
      if (tEnd > ts) acc += num(vi) * (tEnd - ts);
      tEnd = ts; if (ti <= t0) break;
    }
    if (tEnd > t0) acc += num(log[0][1]) * (tEnd - t0);
    return acc / w;
  }

  /** Compute a channel reading on the live world (or on a retained snapshot). Non-scalar readings are returned open. */
  readChannel(ch: ChannelSpec, snap?: Snap): { value: unknown; status: EpistemicStatus; raw: Record<Address, unknown>; open: boolean } {
    const src = snap ?? this.state;
    const addrs = ch.reads.flatMap((r) => (r.endsWith('*') ? Object.keys(src).filter((a) => a.startsWith(r.slice(0, -1))).sort() : [r]))
      .filter((a) => this.boundaryAllows(ch, a));
    if (!addrs.length) return { value: null, status: ch.reads.length ? 'boundary-hidden' : 'not-measured', raw: {}, open: false };
    const raw: Record<Address, unknown> = {};
    const rawVals = addrs.map((a) => (raw[a] = src[a]));
    if (rawVals.some((v) => v !== undefined && typeof v !== 'number')) {
      // Open reading: passed through without numeric placeholder; aggregation is not applied across incommensurable values.
      const v = rawVals.length === 1 ? rawVals[0] : { kind: 'tuple', items: rawVals.map((x) => toData(x)) };
      return { value: toData(v), status: 'detected', raw, open: true };
    }
    const vals = addrs.map((a) => (raw[a] = !snap && ch.window ? this.windowMean(a, ch.window) : (src[a] as number | undefined) ?? 0));
    let v = aggregate(ch.aggregate ?? 'mean', vals as number[]);
    if (ch.noise && !snap) v += ch.noise * gauss(this.rngObs);
    if (ch.range && (v < ch.range[0] || v > ch.range[1])) return { value: null, status: 'apparatus-incompatible', raw, open: false };
    return { value: quantize(v, ch.resolution ?? 0), status: 'detected', raw, open: false };
  }

  private sample(app: ApparatusSpec, ch: ChannelSpec): void {
    const key = app.id + '/' + ch.id;
    const rt = (this.chan[key] ??= { lastQ: null, lastRaw: {}, pending: [], prevSource: null });
    let r: { value: unknown; status: EpistemicStatus; raw: Record<Address, unknown>; open: boolean };
    let costOk = true;
    if (ch.cost) {
      const have = num(this.state[ch.cost.address]);
      if (!(have + EPS >= ch.cost.amount)) costOk = false;
      else this.write(ch.cost.address, have - ch.cost.amount, 'observation:' + key, []);
    }
    if (!costOk) r = { value: null, status: 'inaccessible', raw: rt.lastRaw, open: false };
    else if (ch.construct) r = { ...this.construct(app, ch, rt), open: false };
    else r = this.readChannel(ch);
    const q = r.value;
    const changed = q !== null && q !== undefined && (rt.lastQ === null || rt.lastQ === undefined || (typeof q === 'number' && typeof rt.lastQ === 'number' ? Math.abs(q - rt.lastQ) > EPS : canonical(q) !== canonical(rt.lastQ)));
    let seq = this.latest[key]?.seq ?? -1;
    if (this.tr) {
      const E = (this.epistemic[app.id] ??= {});
      if (rt.pending.length) {
        if (changed) {
          seq = this.ev('detection', { apparatus: app.id, channel: ch.id, value: q, prev: rt.lastQ ?? null, cause: rt.pending.slice(), latency: rt.pending.map((s) => this.t - this.events[s].t), open: r.open || undefined });
          for (const s of rt.pending) E[s] = 'detected';
          this.latestDetection[key] = seq;
        } else {
          const statuses: Record<string, number> = {};
          for (const s of rt.pending) {
            const why = this.classifyMiss(ch, rt, s, r.status, (ch.reads.length > 1 || ch.reads.some((x) => x.endsWith('*'))));
            if (E[s] !== 'detected') E[s] = why;
            statuses[why] = (statuses[why] ?? 0) + 1;
          }
          this.ev('undetermined', { apparatus: app.id, channel: ch.id, statuses, cause: rt.pending.slice() });
        }
      } else if (changed && rt.lastQ !== null && rt.lastQ !== undefined) {
        seq = this.ev('detection', { apparatus: app.id, channel: ch.id, value: q, prev: rt.lastQ, cause: [], spurious: true });
        this.latestDetection[key] = seq;
      }
      if (this.opts.recordObservations) ((this.observations[app.id] ??= {})[ch.id] ??= []).push([this.t, q ?? null, r.status]);
    }
    rt.pending = [];
    if (q !== null && q !== undefined) rt.lastQ = q;
    rt.lastRaw = r.raw;
    this.latest[key] = r.open ? { value: null, open: q, status: r.status, t: this.t, seq } : { value: (q as number | null) ?? null, status: r.status, t: this.t, seq };
  }

  private classifyMiss(ch: ChannelSpec, rt: ChanRt, s: number, status: EpistemicStatus, multi: boolean): EpistemicStatus {
    if (status === 'apparatus-incompatible' || status === 'inaccessible') return status;
    const e = this.events[s];
    const res = ch.resolution ?? 0;
    const prevRaw = rt.lastRaw[e.address];
    const now = this.state[e.address];
    if (typeof e.delta !== 'number') return this.values.same(prevRaw, now) ? 'temporal-window-incompatible' : multi ? 'scale-incompatible' : 'below-resolution';
    if (typeof prevRaw === 'number' && typeof now === 'number' && Math.abs(now - prevRaw) <= EPS && Math.abs(e.delta) > EPS) return 'temporal-window-incompatible';
    if (ch.window && Math.abs(e.delta) >= res) return 'temporal-window-incompatible';
    if (multi && Math.abs(e.delta) >= res && res > 0) return 'scale-incompatible';
    return 'below-resolution';
  }

  private construct(app: ApparatusSpec, ch: ChannelSpec, rt: ChanRt): { value: number | null; status: EpistemicStatus; raw: Record<Address, unknown> } {
    const k = ch.construct!;
    const vals = k.of.map((id) => this.latest[app.id + '/' + id]?.value ?? null);
    if (vals.some((v) => v === null)) return { value: null, status: 'not-measured', raw: {} };
    const v = vals as number[];
    let out: number | null = null;
    switch (k.op) {
      case 'diff': out = rt.prevSource === null ? null : v[0] - rt.prevSource; rt.prevSource = v[0]; break;
      case 'sub': out = v[0] - v[1]; break;
      case 'sum': out = v.reduce((a, b) => a + b, 0); break;
      case 'product': out = v.reduce((a, b) => a * b, 1); break;
      case 'ratio': out = Math.abs(v[1]) > EPS ? v[0] / v[1] : null; break;
      case 'abs': out = Math.abs(v[0]); break;
    }
    if (out === null) return { value: null, status: 'pending', raw: {} };
    return { value: quantize(out, ch.resolution ?? 0), status: 'detected', raw: {} };
  }

  private frame(app: ApparatusSpec): void {
    const f = this.frames[app.id];
    if (!f) return;
    const k = app.channels.filter((c) => c.enabled !== false).map((c) => { const o = this.latest[app.id + '/' + c.id]; return o?.open !== undefined ? canonical(o.open) : fmt(o?.value); }).join('|');
    f.keys.push(k);
    const m = app.memory ?? 0;
    const full = f.keys.slice(-(m + 1)).join('§');
    if (f.keys.length > m + 1) f.keys.shift();
    const sig = [...f.sig].sort().join(',');
    f.sig.clear();
    const track = this.tr && app.aliasing !== false && this.opts.maxAliasing > 0;
    if (track && f.lastKey !== undefined) {
      const tk = f.lastKey + '#' + sig;
      const e = f.trans.get(tk);
      if (!e) f.trans.set(tk, { next: full, snap: f.lastSnap, prev: f.prevSnap, t: f.lastT });
      else if (e.next !== full && !e.aliased && f.aliasing.length < this.opts.maxAliasing) {
        e.aliased = true;
        const seq = this.ev('aliasing', { apparatus: app.id, key: f.lastKey, sig, next: [e.next, full], at: [e.t, f.lastT] });
        f.aliasing.push({ apparatus: app.id, key: f.lastKey, sig, next: [e.next, full], t: [e.t, f.lastT], snapshots: [e.snap ?? {}, f.lastSnap ?? {}], previous: [e.prev, f.prevSnap], seq });
      }
    }
    if (track) { f.prevSnap = f.lastSnap; f.lastSnap = { ...this.state }; }
    f.lastKey = full; f.lastSig = sig; f.lastT = this.t;
  }

  // ------------------------------------------------------------------ reachability

  /**
   * Fork, run each option to the horizon, and record
   *  - probe-relative reachability: which declared probes open/close/delay/branch — relative to the probe
   *    vocabulary, this option menu, this horizon and the current observation configuration;
   *  - emergent reachability: how the description space S expands or contracts in each fork, and which
   *    branch grammars (patterns of expansion/contraction) appear or disappear — independent of probes.
   */
  reach(trigger: number | null): any {
    const R = this.spec.reach;
    if (!R) return null;
    if (this.t === this.lastReachT) return null;
    this.lastReachT = this.t;
    const options = R.options ?? [{ id: 'baseline' }, { id: 'seed+1', seedOffset: 1 }, { id: 'seed+2', seedOffset: 2 }];
    const now = this.t;
    const per: Record<string, Record<string, number | null>> = {};
    const emergentPer: Record<string, { added: Record<string, string[]>; removed: Record<string, string[]>; signature: string }> = {};
    for (const o of options) {
      const f = this.fork({ seedOffset: o.seedOffset ?? 0 });
      const s0 = describeSpace(f);
      for (const iv of o.interventions ?? []) f.intervene({ ...iv, t: now + (iv.t ?? 0) } as Intervention);
      const earliest: Record<string, number | null> = {};
      for (const p of this.probes) earliest[p.id] = this.probeState[p.id].satisfied ? now : null;
      const until = now + R.horizon;
      for (;;) {
        const top = f.queue.peek(); if (!top || top.t > until) break;
        const it = f.step();
        if (it?.kind !== 'tick' || !this.probes.length) continue;
        const c = f.ctx(null);
        for (const p of this.probes) if (earliest[p.id] === null && p.test(c)) earliest[p.id] = f.t;
      }
      per[o.id] = earliest;
      const d = diffSpace(s0, describeSpace(f, f.facets()), f.facets());
      const novelty: { level: string; what: string; facet?: string; descriptor?: string; novelToHistory: boolean }[] = [];
      const WHAT: Record<string, string> = { 'configuration-dimension': 'new dimension', 'state-dimension': 'new dimension', 'transition-class': 'new transition class', 'relation-type': 'new relation type', channel: 'new observation channel', 'value-kind': 'new value kind' };
      for (const [c, v] of Object.entries(d.added)) for (const x of v) novelty.push({ level: 'C', what: WHAT[c] ?? `new ${c} descriptor`, facet: c, descriptor: x, novelToHistory: !this.everSeen[c]?.has(x) });
      for (const c of d.facetsAdded) novelty.push({ level: 'D', what: 'new description facet', facet: c, novelToHistory: !(c in this.everSeen) });
      const metaDelta = f.metaConfig.lineage.slice(this.metaConfig.lineage.length);
      for (const m of metaDelta) if (m.registry !== 'description-facet') novelty.push({ level: 'D', what: 'new meta-rule', facet: m.registry, descriptor: m.id, novelToHistory: true });
      // Level A: new non-scalar or integer-valued states at already-known storage (continuous values are excluded: nearly always "new")
      let newStates = 0;
      for (const [k, v] of Object.entries(f.state)) {
        if (!(k in this.state) || (typeof v === 'number' && !Number.isInteger(v))) continue;
        const cv = canonical(v); if (!(this.changeLog[k] ?? []).some(([, x]) => canonical(x) === cv)) newStates++;
      }
      if (newStates) novelty.push({ level: 'A', what: 'new state within known description space', descriptor: `${newStates} storage value(s)`, novelToHistory: true });
      const contraction = [...Object.entries(d.removed).flatMap(([c, v]) => v.map((x) => ({ level: 'C', what: `lost ${c} descriptor`, facet: c, descriptor: x }))), ...d.facetsRemoved.map((c) => ({ level: 'D', what: 'lost description facet', facet: c }))];
      emergentPer[o.id] = { added: d.added, removed: d.removed, signature: changeSignature(d), novelty, contraction } as any;
    }
    const cause = trigger !== null ? [trigger] : [];
    const relativeTo = { probes: this.probes.map((p) => p.id), options: options.map((o) => o.id), horizon: R.horizon, observation: Object.values(this.apparatus).map((a) => `${a.id}:[${a.channels.map((c) => c.id).join(',')}]`) };
    let rec: any = null;
    if (this.probes.length) {
      const probes: Record<string, { fraction: number; earliest: number | null; status: string }> = {};
      for (const p of this.probes) {
        const ts = options.map((o) => per[o.id][p.id]);
        const hits = ts.filter((x): x is number => x !== null);
        const fraction = hits.length / options.length;
        probes[p.id] = { fraction, earliest: hits.length ? Math.min(...hits) - now : null, status: fraction === 0 ? 'unreachable' : fraction === 1 ? 'reachable' : 'conditionally-reachable' };
      }
      const signatures = [...new Set(options.map((o) => this.probes.map((p) => (per[o.id][p.id] === null ? '0' : '1')).join('')))].sort();
      const changes: { probe: string; change: string; from?: any; to?: any }[] = [];
      const prev = this.reachPrev;
      if (prev) {
        for (const p of this.probes) {
          const a = prev.probes[p.id], b = probes[p.id];
          if (a.fraction === 0 && b.fraction > 0) changes.push({ probe: p.id, change: 'became-reachable' });
          else if (a.fraction > 0 && b.fraction === 0) changes.push({ probe: p.id, change: 'became-unreachable' });
          else if (a.status !== b.status) changes.push({ probe: p.id, change: 'became-' + b.status, from: a.status, to: b.status });
          if (a.earliest !== null && b.earliest !== null) {
            const ea = a.earliest - (now - prev.t);
            if (b.earliest > ea + 1e-9 && b.earliest > 0) changes.push({ probe: p.id, change: 'delayed', from: ea, to: b.earliest });
          }
        }
      }
      const appeared = prev ? signatures.filter((s) => !prev.signatures.includes(s)) : [];
      const disappeared = prev ? prev.signatures.filter((s: string) => !signatures.includes(s)) : [];
      rec = { mode: 'probe-relative', relativeTo, t: now, probes, signatures, branches: signatures.length, options: options.map((o) => o.id), perOption: per, changes, branchesAppeared: appeared, branchesDisappeared: disappeared, horizon: R.horizon, trigger };
      this.reachPrev = rec;
      this.reachHistory.push(rec);
      this.ev('reachability.probe-relative', { ...rec, cause });
    }
    // emergent (description-space) reachability
    const expansion: Record<string, string[]> = {}, contraction: Record<string, string[]> = {};
    for (const x of Object.values(emergentPer)) {
      for (const [c, v] of Object.entries(x.added)) expansion[c] = [...new Set([...(expansion[c] ?? []), ...v])].sort();
      for (const [c, v] of Object.entries(x.removed)) contraction[c] = [...new Set([...(contraction[c] ?? []), ...v])].sort();
    }
    const grammar = [...new Set(Object.values(emergentPer).map((x) => x.signature))].sort();
    const ep = this.emergentPrev;
    const relativeToM = { configuration: hashOf(Object.values(this.dims).map((d) => [d.key, d.value ?? null])).slice(0, 12), descriptionSpace: this.space ? spaceHash(this.space) : spaceHash(describeSpace(this, this.facets())), metaConfiguration: this.metaConfig.hash(), historyUpTo: now };
    const em = {
      mode: 'emergent', t: now, relativeTo: relativeToM,
      noveltyByLevel: Object.fromEntries(['A', 'C', 'D'].map((L) => [L, Object.values(emergentPer).reduce((a: number, x: any) => a + x.novelty.filter((n: any) => n.level === L).length, 0)])),
      contractionCount: Object.values(emergentPer).reduce((a: number, x: any) => a + x.contraction.length, 0), horizon: R.horizon, options: options.map((o) => o.id), perOption: emergentPer, expansion, contraction,
      branchGrammar: grammar, newBranchGrammar: ep ? grammar.filter((g) => !ep.branchGrammar.includes(g)) : [], lostBranchGrammar: ep ? ep.branchGrammar.filter((g: string) => !grammar.includes(g)) : [],
      knownState: rec ? Object.fromEntries(Object.entries(rec.probes).map(([k, v]: any) => [k, v.fraction])) : null, trigger,
    };
    this.emergentPrev = em;
    this.emergentHistory.push(em);
    this.ev('reachability.emergent', { ...em, cause });
    return rec;
  }
}

// ------------------------------------------------------------------ helpers

function newFrame(): FrameRt {
  return { keys: [], lastSig: '', lastT: 0, lastSnap: null, prevSnap: null, trans: new Map(), sig: new Set(), aliasing: [], consumed: 0 };
}

function matches(pattern: string, a: Address): boolean {
  return pattern.endsWith('*') ? a.startsWith(pattern.slice(0, -1)) : pattern === a;
}

function wildcardHit(rs: Set<string>, key: string): boolean {
  if (key.startsWith('o:')) { const app = key.slice(2).split('/')[0]; if (rs.has('o:' + app + '/*')) return true; for (const r of rs) if (r.startsWith('o:' + app + '/') && key.endsWith('/*')) return true; }
  if (key.startsWith('a:')) { const a = key.slice(2); for (const r of rs) if (r.startsWith('p:') && a.startsWith(r.slice(2))) return true; }
  if (key.startsWith('p:')) { const p = key.slice(2); for (const r of rs) if (r.startsWith('a:') && r.slice(2).startsWith(p)) return true; }
  return false;
}

export function quantize(v: number, res: number): number {
  if (!res) return v;
  return Math.round(Math.round(v / res) * res * 1e9) / 1e9;
}

function aggregate(kind: string, vals: number[]): number {
  switch (kind) {
    case 'sum': return vals.reduce((a, b) => a + b, 0);
    case 'max': return Math.max(...vals);
    case 'min': return Math.min(...vals);
    case 'first': return vals[0];
    case 'spread': return Math.max(...vals) - Math.min(...vals);
    default: return vals.reduce((a, b) => a + b, 0) / vals.length;
  }
}

function transform(c: CouplingSpec, d: number): number {
  const th = c.threshold ?? 1;
  switch (c.transform ?? 'linear') {
    case 'threshold': return Math.abs(d) >= th ? d : 0;
    case 'saturate': return th * Math.tanh(d / th);
    case 'sign': return Math.sign(d);
    case 'invert': return -d;
    case 'square': return d * Math.abs(d);
    case 'rectify': return d > 0 ? d : 0;
    default: return d;
  }
}

/** What becomes (in)distinguishable when an observation channel is changed. */
function apparatusDistinctions(action: string, before: any, after: any): Distinctions | undefined {
  if (action === 'removeChannel') return { retained: [], lost: [`readings of ${before?.reads?.join(',') ?? '?'}`], new: [], unknown: [] };
  if (action === 'addChannel') return { retained: before ? [] : ['all previous channels'], lost: before ? [`previous configuration of ${before.id}`] : [], new: [`readings of ${after?.reads?.join(',') ?? after?.construct?.op ?? '?'}`], unknown: [] };
  if (action !== 'patchChannel' || !before || !after) return undefined;
  const d: Distinctions = { retained: [], lost: [], new: [], unknown: [] };
  if ((after.resolution ?? 0) > (before.resolution ?? 0)) d.lost.push(`differences finer than ${after.resolution}`);
  if ((after.resolution ?? 0) < (before.resolution ?? 0)) d.new.push(`differences between ${after.resolution} and ${before.resolution}`);
  const rb = [...(before.reads ?? [])].sort().join(','), ra = [...(after.reads ?? [])].sort().join(',');
  if (rb !== ra) { d.lost.push(...(before.reads ?? []).filter((x: string) => !(after.reads ?? []).includes(x)).map((x: string) => `readings of ${x}`)); d.new.push(...(after.reads ?? []).filter((x: string) => !(before.reads ?? []).includes(x)).map((x: string) => `readings of ${x}`)); }
  if ((after.reads?.length ?? 0) > 1 && after.aggregate && after.aggregate !== before.aggregate) d.lost.push('per-address distinctions under aggregation');
  if (JSON.stringify(after.boundary ?? null) !== JSON.stringify(before.boundary ?? null)) d.unknown.push('which differences lie at the new boundary');
  const retainedReads = (after.reads ?? []).filter((x: string) => (before.reads ?? []).includes(x));
  if (retainedReads.length) d.retained.push(...retainedReads.map((x: string) => `readings of ${x}`));
  return d;
}

function fmt(v: number | null | undefined): string { return v === null || v === undefined ? '∅' : String(Math.round(v * 1e6) / 1e6); }

function jsonSafe(x: any): any {
  if (x === null || x === undefined) return null;
  try { return JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === 'function' ? '[fn]' : v))); } catch { return String(x); }
}

export function specHashOf(spec: WorldSpec): string {
  return hashOf({
    engine: ENGINE_VERSION, id: spec.id, seed: spec.seed, horizon: spec.horizon, params: spec.params, config: spec.config,
    state: spec.state, addresses: spec.addresses, clocks: spec.clocks, rules: spec.rules, couplings: spec.couplings, metaOverrides: spec.metaOverrides,
    apparatus: spec.apparatus, probes: spec.probes, interventions: spec.interventions, reach: spec.reach,
    semantics: spec.semantics, operationalAddresses: spec.operationalAddresses, facets: spec.facets,
  });
}

/** Content-addressed, deterministic TII: the same ignition in an exact rerun gets the same identifier. */
export function tiiFor(specHash: string, rule: string, occurrence: number, t: number): string {
  return 'tii-test:zx:' + sha256(specHash + '|' + rule + '|' + occurrence + '|' + t).slice(0, 20);
}
