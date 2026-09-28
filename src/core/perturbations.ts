// The 20 experiment/perturbation types, all expressed in core terms.
// Static perturbations (no `at`) rewrite the spec before the run; dynamic ones (`at`)
// become scheduled interventions, so the change happens inside the dynamics and is traced
// as a reorganization.
import type { ApparatusSpec, ChannelSpec, ClockSpec, CouplingSpec, Ctx, Dimension, Emit, Intervention, RuleSpec, WorldSpec, Aggregate, ProbeSpec } from './types.ts';
import { sc } from './values.ts';

export interface Bundle {
  id: string;
  label?: string;
  rules?: RuleSpec[];
  state?: Record<string, number>;
  addresses?: WorldSpec['addresses'];
  couplings?: CouplingSpec[];
  apparatus?: ApparatusSpec[];
  clocks?: ClockSpec[];
  probes?: ProbeSpec[];
  config?: Dimension[];
}

export type MediumTable = Record<string, { gain?: number; delay?: number; loss?: number; delayFactor?: number }>;

export type Perturbation =
  | { type: 'configuration'; key: string; patch?: Partial<Dimension>; remove?: boolean; at?: number }
  | { type: 'observation'; apparatus: string; channel: string; patch: Partial<ChannelSpec>; at?: number }
  | { type: 'boundary'; apparatus: string; channel?: string; boundary: string[] | null; at?: number }
  | { type: 'scale'; apparatus: string; channel: string; aggregate?: Aggregate; reads?: string[]; at?: number }
  | { type: 'temporal-window'; apparatus?: string; channel?: string; window?: number; clock?: string; period?: number; at?: number }
  | { type: 'resource'; address: string; value?: number; delta?: number; at?: number }
  | { type: 'medium-substitution'; from?: string; to: string; table: MediumTable; couplings?: string[] }
  | { type: 'sensor-replacement'; apparatus: string; channel: string; with: ChannelSpec; at?: number }
  | { type: 'memory-removal'; apparatus?: string; prefix?: string; at?: number }
  | { type: 'address-reassignment'; from: string; to: string; at?: number }
  | { type: 'goal-insertion'; rule: RuleSpec; at?: number }
  | { type: 'goal-removal'; rule: string; at?: number }
  | { type: 'institutional-rule'; rule: string; replace?: RuleSpec; enabled?: boolean; at?: number }
  | { type: 'physical-implementation'; coupling: string; patch: Partial<CouplingSpec>; at?: number }
  | { type: 'reconstruction-transfer'; bundle: Bundle }
  | { type: 'hybridization'; bundles: Bundle[]; remove?: string[] }
  | { type: 'counterfactual-removal'; rule: string; occurrence?: number }
  | { type: 'delayed-intervention'; intervention?: string; rule?: string; occurrence?: number; dt: number }
  | { type: 'feedback-interruption'; couplings?: string[]; rules?: string[]; at?: number }
  | { type: 'reorganization-trigger'; at: number; apply: (c: Ctx, e: Emit) => void; label?: string };

export const PERTURBATION_TYPES = [
  'configuration', 'observation', 'boundary', 'scale', 'temporal-window', 'resource', 'medium-substitution', 'sensor-replacement',
  'memory-removal', 'address-reassignment', 'goal-insertion', 'goal-removal', 'institutional-rule', 'physical-implementation',
  'reconstruction-transfer', 'hybridization', 'counterfactual-removal', 'delayed-intervention', 'feedback-interruption', 'reorganization-trigger',
] as const;

function cloneSpec(s: WorldSpec): WorldSpec {
  return {
    ...s, params: { ...(s.params ?? {}) }, config: (s.config ?? []).map((d) => ({ ...d })), state: { ...s.state },
    addresses: { ...(s.addresses ?? {}) }, clocks: s.clocks.map((c) => ({ ...c })), rules: s.rules.map((r) => ({ ...r })),
    couplings: (s.couplings ?? []).map((c) => ({ ...c })),
    apparatus: (s.apparatus ?? []).map((a) => ({ ...a, channels: a.channels.map((c) => ({ ...c, reads: [...c.reads] })) })),
    probes: [...(s.probes ?? [])], interventions: [...(s.interventions ?? [])], reach: s.reach ? { ...s.reach } : undefined,
  };
}

export function addBundle(s: WorldSpec, b: Bundle): WorldSpec {
  const o = cloneSpec(s);
  Object.assign(o.state, b.state ?? {});
  Object.assign(o.addresses!, b.addresses ?? {});
  const ruleIds = new Set(o.rules.map((r) => r.id));
  for (const r of b.rules ?? []) { if (ruleIds.has(r.id)) o.rules = o.rules.filter((x) => x.id !== r.id); o.rules.push(r); }
  o.couplings!.push(...(b.couplings ?? []));
  o.apparatus!.push(...(b.apparatus ?? []));
  for (const c of b.clocks ?? []) if (!o.clocks.some((x) => x.id === c.id)) o.clocks.push(c);
  o.probes!.push(...(b.probes ?? []));
  o.config!.push(...(b.config ?? []));
  return o;
}

function dyn(o: WorldSpec, id: string, at: number, apply: (c: Ctx, e: Emit) => void, label: string): WorldSpec {
  o.interventions!.push({ id, t: at, kind: 'emit', apply, label });
  return o;
}

export function applyPerturbation(spec: WorldSpec, p: Perturbation, idx = 0): WorldSpec {
  const o = cloneSpec(spec);
  const pid = `p${idx}:${p.type}`;
  const app = (id: string) => o.apparatus!.find((a) => a.id === id);
  const ch = (a: string, c: string) => app(a)?.channels.find((x) => x.id === c);
  switch (p.type) {
    case 'configuration':
      if (p.at !== undefined) return dyn(o, pid, p.at, (_c, e) => (p.remove ? e.dim.remove(p.key) : e.dim.set(p.key, p.patch ?? {})), `configuration ${p.key}`);
      if (p.remove) o.config = o.config!.filter((d) => d.key !== p.key);
      else { const d = o.config!.find((x) => x.key === p.key); if (d) Object.assign(d, p.patch); else o.config!.push({ key: p.key, status: 'specified', ...p.patch }); }
      return o;
    case 'observation':
    case 'scale':
    case 'boundary': {
      const patch: Partial<ChannelSpec> = p.type === 'observation' ? p.patch : p.type === 'scale' ? { ...(p.aggregate ? { aggregate: p.aggregate } : {}), ...(p.reads ? { reads: p.reads } : {}) } : { boundary: p.boundary ?? undefined };
      const targets = p.type === 'boundary' && !p.channel ? (app(p.apparatus)?.channels.map((c) => c.id) ?? []) : [(p as any).channel as string];
      if (p.at !== undefined) return dyn(o, pid, p.at, (_c, e) => targets.forEach((t) => e.apparatus.patchChannel(p.apparatus, t, patch)), `${p.type} ${p.apparatus}`);
      for (const t of targets) { const c = ch(p.apparatus, t); if (c) Object.assign(c, patch); }
      return o;
    }
    case 'temporal-window': {
      if (p.at !== undefined) return dyn(o, pid, p.at, (_c, e) => {
        if (p.clock && p.period) e.clock.patch(p.clock, { period: p.period });
        if (p.apparatus && p.channel && p.window !== undefined) e.apparatus.patchChannel(p.apparatus, p.channel, { window: p.window });
      }, 'temporal-window');
      if (p.clock && p.period) { const c = o.clocks.find((x) => x.id === p.clock); if (c) c.period = p.period; }
      if (p.apparatus && p.channel && p.window !== undefined) { const c = ch(p.apparatus, p.channel); if (c) c.window = p.window; }
      return o;
    }
    case 'resource':
      if (p.at !== undefined) { o.interventions!.push(p.value !== undefined ? { id: pid, t: p.at, kind: 'set', address: p.address, value: p.value } : { id: pid, t: p.at, kind: 'add', address: p.address, value: p.delta ?? 0 }); return o; }
      o.state[p.address] = p.value ?? sc(o.state[p.address]) + (p.delta ?? 0);
      return o;
    case 'medium-substitution': {
      const row = p.table[p.to] ?? {};
      for (const c of o.couplings!) {
        if (p.couplings && !p.couplings.includes(c.id)) continue;
        if (p.from && c.medium !== p.from) continue;
        const was = p.table[c.medium ?? ''] ?? {};
        c.medium = p.to;
        if (row.gain !== undefined) c.gain = c.gain / (was.gain ?? 1) * row.gain;
        if (row.delay !== undefined) c.delay = row.delay; else if (row.delayFactor !== undefined) c.delay = (c.delay ?? 0) * row.delayFactor;
        if (row.loss !== undefined) c.lossThreshold = row.loss;
      }
      for (const [a, m] of Object.entries(o.addresses!)) if (!p.from || m.medium === p.from) if (m.medium) o.addresses![a] = { ...m, medium: p.to };
      return o;
    }
    case 'sensor-replacement':
      if (p.at !== undefined) return dyn(o, pid, p.at, (_c, e) => { e.apparatus.removeChannel(p.apparatus, p.channel); e.apparatus.addChannel(p.apparatus, p.with); }, 'sensor-replacement');
      { const a = app(p.apparatus); if (a) a.channels = a.channels.map((c) => (c.id === p.channel ? { ...p.with } : c)); }
      return o;
    case 'memory-removal':
      if (p.at !== undefined) return dyn(o, pid, p.at, (c, e) => {
        if (p.apparatus) e.apparatus.patch(p.apparatus, { memory: 0 });
        if (p.prefix) for (const a of c.addresses(p.prefix)) e.set(a, 0);
      }, 'memory-removal');
      if (p.apparatus) { const a = app(p.apparatus); if (a) a.memory = 0; }
      if (p.prefix) for (const a of Object.keys(o.state)) if (a.startsWith(p.prefix)) o.state[a] = 0;
      return o;
    case 'address-reassignment':
      return dyn(o, pid, p.at ?? 0, (_c, e) => e.address.reassign(p.from, p.to), `reassign ${p.from}→${p.to}`);
    case 'goal-insertion':
      if (p.at !== undefined) return dyn(o, pid, p.at, (_c, e) => e.rule.add(p.rule), `goal-insertion ${p.rule.id}`);
      o.rules.push(p.rule); return o;
    case 'goal-removal':
    case 'counterfactual-removal':
      if (p.type === 'counterfactual-removal' && p.occurrence !== undefined) { o.interventions!.push({ id: pid, kind: 'suppress', rule: p.rule, occurrence: p.occurrence }); return o; }
      if (p.type === 'goal-removal' && p.at !== undefined) return dyn(o, pid, p.at, (_c, e) => e.rule.disable(p.rule), `goal-removal ${p.rule}`);
      o.rules = o.rules.map((r) => (r.id === p.rule ? { ...r, enabled: false } : r)); return o;
    case 'institutional-rule':
      if (p.at !== undefined) return dyn(o, pid, p.at, (_c, e) => { if (p.replace) { e.rule.disable(p.rule); e.rule.add(p.replace); } else if (p.enabled !== undefined) (p.enabled ? e.rule.enable(p.rule) : e.rule.disable(p.rule)); }, `institutional-rule ${p.rule}`);
      if (p.replace) o.rules = o.rules.map((r) => (r.id === p.rule ? p.replace! : r));
      else if (p.enabled !== undefined) o.rules = o.rules.map((r) => (r.id === p.rule ? { ...r, enabled: p.enabled } : r));
      return o;
    case 'physical-implementation':
      if (p.at !== undefined) return dyn(o, pid, p.at, (_c, e) => e.coupling.patch(p.coupling, p.patch), `physical ${p.coupling}`);
      o.couplings = o.couplings!.map((c) => (c.id === p.coupling ? { ...c, ...p.patch } : c)); return o;
    case 'reconstruction-transfer':
      return addBundle(o, p.bundle);
    case 'hybridization': {
      let x = o;
      if (p.remove) x.rules = x.rules.filter((r) => !p.remove!.includes(r.id));
      for (const b of p.bundles) x = addBundle(x, b);
      return x;
    }
    case 'delayed-intervention':
      if (p.intervention) { o.interventions = o.interventions!.map((iv) => (iv.id === p.intervention ? { ...iv, t: (iv.t ?? 0) + p.dt } as Intervention : iv)); return o; }
      if (p.rule) o.interventions!.push({ id: pid, kind: 'shift', rule: p.rule, occurrence: p.occurrence, dt: p.dt });
      return o;
    case 'feedback-interruption':
      if (p.at !== undefined) return dyn(o, pid, p.at, (_c, e) => { for (const c of p.couplings ?? []) e.coupling.patch(c, { enabled: false }); for (const r of p.rules ?? []) e.rule.disable(r); }, 'feedback-interruption');
      o.couplings = o.couplings!.map((c) => (p.couplings?.includes(c.id) ? { ...c, enabled: false } : c));
      o.rules = o.rules.map((r) => (p.rules?.includes(r.id) ? { ...r, enabled: false } : r));
      return o;
    case 'reorganization-trigger':
      return dyn(o, pid, p.at, p.apply, p.label ?? 'reorganization-trigger');
  }
}

export function applyPerturbations(spec: WorldSpec, ps: Perturbation[] = []): WorldSpec {
  return ps.reduce((s, p, i) => applyPerturbation(s, p, i), spec);
}

export function describePerturbation(p: Perturbation): unknown {
  return JSON.parse(JSON.stringify(p, (_k, v) => (typeof v === 'function' ? '[fn]' : v)));
}
