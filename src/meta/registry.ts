// The simulator's meta-configuration, gathered from every registry (for inspection / UI).
import { MetaConfiguration, type MetaEntry } from '../core/meta.ts';
import { engineMeta } from '../core/engine.ts';
import { ValueRegistry } from '../core/values.ts';
import { TRACE_SCHEMAS } from './trace-schema.ts';
import { MUTATION_REGISTRY } from '../analysis/grammar-morphogenesis.ts';
import { FEATURE_CONSTRUCTORS } from '../analysis/emergence.ts';
import { PARETO_AXES } from '../ziran/reviser.ts';
import { LEVELS } from '../analysis/compare.ts';
import { listTheory } from '../bench/theory.ts';
import { causalOrderFacet, intervalKind } from '../domains/meta-worlds.ts';

const CANDIDATES = ['resolution', 'boundary', 'disaggregate', 'construct-diff', 'memory', 'placement', 'relocate', 'sampling'];

export function globalMeta(): MetaConfiguration {
  const base = engineMeta({ id: 'meta', seed: 0, horizon: 0, state: {}, clocks: [], rules: [] }, new ValueRegistry());
  const entries: MetaEntry[] = [
    ...base.all(),
    { id: intervalKind.kind, registry: 'value-kind', origin: 'domain-registered', description: 'interval (registered at runtime by meta.runtime-value-kind)' },
    { id: causalOrderFacet.id, registry: 'description-facet', origin: 'domain-registered', description: causalOrderFacet.label },
    ...TRACE_SCHEMAS.map((s) => ({ id: s.id, registry: 'trace-schema', origin: s.origin, description: s.description })),
    ...MUTATION_REGISTRY.map((m) => ({ id: m.id, registry: 'grammar-mutation', origin: m.status === 'supplied' ? ('supplied' as const) : m.status === 'retired' ? ('retired' as const) : m.status, description: `${m.transformation} · retains: ${m.expectedRetained} · may lose: ${m.possibleLoss}`, provenance: m.provenance })),
    ...FEATURE_CONSTRUCTORS.map((f) => ({ id: f.id, registry: 'emergence-feature', origin: f.origin, description: `${f.kind}: ${f.description}` })),
    ...PARETO_AXES.map((a) => ({ id: a.id, registry: 'pareto-axis', origin: a.origin, description: `${a.prefer} · ${a.assumptions} · preference origin: ${a.preferenceOrigin}` })),
    ...CANDIDATES.map((c) => ({ id: c, registry: 'observation-revision-candidate', origin: 'supplied' as const, description: 'candidate generator in ziran/reviser.ts' })),
    ...LEVELS.map((l) => ({ id: `level:${l}`, registry: 'comparison-metric', origin: 'supplied' as const, description: 'cross-configuration comparison level' })),
    { id: 'structured-difference', registry: 'comparison-metric', origin: 'supplied', description: 'responsibility / trace comparison by category (no universal metric)' },
    { id: 'scalar-distance', registry: 'comparison-metric', origin: 'supplied', description: 'Euclidean distance over scalar storage only (declared meaningful for scalars)' },
    ...listTheory().map((b: any) => ({ id: `theory:${b.id}`, registry: 'benchmark-predicate', origin: 'supplied' as const, description: b.successPredicate ?? b.title })),
  ];
  const m = new MetaConfiguration([]);
  for (const e of entries) m.register(e, 0, 'startup');
  m.lineage = [];
  return m;
}
