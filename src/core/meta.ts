// MetaConfiguration M — explicitly represented and partially revisable meta-configuration.
//
// The rules that decide what can count as a value kind, a description facet, a grammar mutation, a trace
// event, an emergence feature, a Pareto axis or a benchmark predicate are not invisible implementation facts:
// they are runtime objects with provenance, and some of them can be registered or retired during a run
// (Level D: M_t → M_{t+1}). This does not remove constraints — the registries, their interfaces and the code
// that consults them remain fixed. It makes some previously hidden constraints inspectable and revisable.
import { hashOf } from './hash.ts';

export type Origin = 'supplied' | 'generated' | 'composed' | 'inherited' | 'domain-registered' | 'retired';

export const META_REGISTRIES = [
  'value-kind', 'description-facet', 'transition-class', 'observation-revision-candidate', 'grammar-mutation',
  'comparison-metric', 'emergence-feature', 'pareto-axis', 'trace-schema', 'benchmark-predicate',
] as const;
export type MetaRegistry = (typeof META_REGISTRIES)[number];

export interface MetaEntry {
  id: string;
  registry: MetaRegistry | string;
  origin: Origin;
  /** Human-readable account of what the entry does and assumes. */
  description?: string;
  provenance?: string;
  /** Executable payload (functions allowed); never serialized. */
  impl?: unknown;
  retired?: boolean;
}

export interface MetaChange { t: number; op: 'register' | 'retire'; registry: string; id: string; origin: Origin; from: string; to: string; via?: string }

export class MetaConfiguration {
  private entries = new Map<string, MetaEntry>();
  lineage: MetaChange[] = [];

  constructor(initial: MetaEntry[] = []) { for (const e of initial) this.entries.set(key(e.registry, e.id), { ...e }); }

  clone(): MetaConfiguration {
    const m = new MetaConfiguration([...this.entries.values()]);
    m.lineage = [...this.lineage];
    return m;
  }

  register(e: MetaEntry, t = 0, via?: string): boolean {
    const k = key(e.registry, e.id);
    const prev = this.entries.get(k);
    if (prev && !prev.retired) return false;
    const from = this.hash();
    this.entries.set(k, { ...e, retired: false });
    this.lineage.push({ t, op: 'register', registry: e.registry, id: e.id, origin: e.origin, from, to: this.hash(), via });
    return true;
  }

  retire(registry: string, id: string, t = 0, via?: string): boolean {
    const k = key(registry, id); const e = this.entries.get(k);
    if (!e || e.retired) return false;
    const from = this.hash();
    this.entries.set(k, { ...e, retired: true });
    this.lineage.push({ t, op: 'retire', registry, id, origin: e.origin, from, to: this.hash(), via });
    return true;
  }

  active(registry: string): MetaEntry[] { return [...this.entries.values()].filter((e) => e.registry === registry && !e.retired).sort((a, b) => a.id.localeCompare(b.id)); }
  all(): MetaEntry[] { return [...this.entries.values()].sort((a, b) => (a.registry + a.id).localeCompare(b.registry + b.id)); }
  has(registry: string, id: string): boolean { const e = this.entries.get(key(registry, id)); return !!e && !e.retired; }
  get(registry: string, id: string): MetaEntry | undefined { return this.entries.get(key(registry, id)); }

  /** Serializable view (no implementations). */
  snapshot(): { registry: string; id: string; origin: Origin; retired: boolean; description?: string; provenance?: string }[] {
    return this.all().map((e) => ({ registry: e.registry, id: e.id, origin: e.origin, retired: !!e.retired, description: e.description, provenance: e.provenance }));
  }

  hash(): string { return hashOf(this.all().filter((e) => !e.retired).map((e) => e.registry + ':' + e.id)).slice(0, 16); }
}

const key = (r: string, id: string) => r + '\u0000' + id;

/** Merge several registrations into one configuration (e.g. core defaults + domain extensions). */
export function metaFrom(...groups: MetaEntry[][]): MetaConfiguration {
  return new MetaConfiguration(groups.flat());
}
