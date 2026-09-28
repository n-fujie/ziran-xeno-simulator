// Open-value, operational-address and description-space worlds.
// These presets exercise second-generation core abstractions: non-scalar operational values, storage vs
// operational address, S_t → S_{t+1} (new dimensions / transition classes), boundary-relative localization.
import type { Preset } from '../core/experiment.ts';
import type { WorldSpec, RuleSpec, Ctx } from '../core/types.ts';
import type { RelationValue } from '../core/values.ts';

const n = (p: Record<string, unknown>, k: string, d: number) => (typeof p[k] === 'number' ? (p[k] as number) : d);
const s = (p: Record<string, unknown>, k: string, d: string) => (typeof p[k] === 'string' ? (p[k] as string) : d);

// ---------------------------------------------------------------- relation spread: scalar vs open representation

const TOPOLOGY: Record<string, [string, string][]> = {
  // same edge count (5); different structure
  A: [['n0', 'n1'], ['n1', 'n2'], ['n2', 'n3'], ['n3', 'n4'], ['n1', 'n5']],
  B: [['n0', 'n1'], ['n1', 'n2'], ['n2', 'n3'], ['n0', 'n5'], ['n1', 'n5']],
};
const CUT: Record<string, [string, string]> = { bridge: ['n2', 'n3'], leaf: ['n1', 'n5'] };
const rel = (edges: [string, string, string?][]): RelationValue => ({ kind: 'relation', edges });
const nodesOf = (r: unknown) => new Set(((r as RelationValue)?.edges ?? []).map((e) => e[1]));

export const relationSpread: Preset = {
  id: 'open.relation-spread', title: 'Relation-valued spread: scalar vs open representation', area: 'open-values', layer: 1,
  summary: 'A difference spreads along a relation (who is connected to whom). In the open representation the relation, the infection set, an event log and an opaque label are stored as such; in the scalar representation only an edge count and an infected count exist. Cutting a bridge edge and cutting a leaf edge are different interventions — can the representation tell?',
  questions: ['Which interventions become indistinguishable when a relation is stored as a scalar?', 'What penetrates along a coupling when the value is a relation or an event?'],
  defaults: { seed: 1, horizon: 12, representation: 'relation', topology: 'A', cut: 'none' },
  options: { representation: ['relation', 'scalar'], topology: ['A', 'B'], cut: ['none', 'bridge', 'leaf'] },
  build: (p): WorldSpec => {
    const repr = s(p, 'representation', 'relation'), topo = TOPOLOGY[s(p, 'topology', 'A')] ?? TOPOLOGY.A, cut = CUT[s(p, 'cut', 'none')];
    const common = { id: 'open.relation-spread', seed: n(p, 'seed', 1), horizon: n(p, 'horizon', 12), clocks: [{ id: 'c', period: 1 }] };
    if (repr === 'scalar') {
      return {
        ...common,
        config: [{ key: 'representation', value: 'scalar', status: 'specified' }],
        state: { 'net/edgecount': topo.length, 'net/infected': 1 },
        rules: [{ id: 'spread', clock: 'c', label: 'mean-field spread (counts only)', when: (c) => c.get('net/infected') < 6,
          then: (c, e) => e.set('net/infected', Math.min(6, c.get('net/infected') + Math.floor((c.get('net/edgecount') / 5) * 1))) }],
        interventions: cut ? [{ id: 'cut', t: 0.5, kind: 'add', address: 'net/edgecount', value: -1 }] : [],
        // The probe "n4 reached" is not expressible: the scalar representation has no node identity.
        probes: [{ id: 'n4-reached', label: 'not expressible in counts — surrogate: ≥5 infected', test: (c) => c.get('net/infected') >= 5, monotone: true }],
      };
    }
    const rules: RuleSpec[] = [
      { id: 'spread', clock: 'c', label: 'spread along the relation', when: () => true, then: (c, e) => {
        const inf = nodesOf(c.value('net/infected'));
        const edges = (c.value('net/edges') as RelationValue).edges;
        const add = new Set<string>();
        for (const [a, b] of edges) { if (inf.has(a) && !inf.has(b)) add.add(b); if (inf.has(b) && !inf.has(a)) add.add(a); }
        if (!add.size) return;
        e.set('net/infected', rel([...[...inf].map((x) => ['infected', x] as [string, string]), ...[...add].map((x) => ['infected', x] as [string, string])].sort((x, y) => x[1].localeCompare(y[1]))));
        const first = [...add].sort()[0];
        e.set('log/last', { kind: 'event', type: 'infected', payload: { node: first, t: c.t } });
      } },
    ];
    return {
      ...common,
      config: [{ key: 'representation', value: 'relation', status: 'specified' }],
      state: {
        'net/edges': rel(topo.map(([a, b]) => [a, b])),
        'net/infected': rel([['infected', 'n0']]),
        'log/last': { kind: 'event', type: 'seeded', payload: { node: 'n0' } },
        'net/label': { name: 'contact structure', provenance: 'field notes' }, // opaque: no kind, no numbers
        'mirror/edges': rel(topo.map(([a, b]) => [a, b])), // a record that follows the relation by receiving its differences
      },
      rules,
      couplings: [
        { id: 'mirror', from: 'net/edges', to: 'mirror/edges', gain: 1, delay: 0.5, medium: 'record' },
        { id: 'archive', from: 'log/last', to: 'archive/last', gain: 1, delay: 0.2, medium: 'log' },
      ],
      interventions: [
        ...(cut ? [{ id: 'cut', t: 0.5, kind: 'emit' as const, label: `cut ${cut.join('–')}`, apply: (c: Ctx, e: import('../core/types.ts').Emit) => e.set('net/edges', rel((c.value('net/edges') as RelationValue).edges.filter(([a, b]) => !(a === cut[0] && b === cut[1])))) }] : []),
        { id: 'relabel', t: 6, kind: 'set' as const, address: 'net/label', value: { name: 'contact structure', provenance: 'revised survey' } },
      ],
      apparatus: [{ id: 'survey', label: 'network survey', channels: [{ id: 'infected', clock: 'c', reads: ['net/infected'] }, { id: 'last', clock: 'c', reads: ['log/last'] }] }],
      probes: [{ id: 'n4-reached', test: (c) => nodesOf(c.value('net/infected')).has('n4'), monotone: true }],
    };
  },
};

// ---------------------------------------------------------------- operational addressing

export const addressing: Preset = {
  id: 'open.operational-address', title: 'Storage identity vs operational address', area: 'open-values', layer: 1,
  summary: 'One operational difference spans several storage nodes; one storage node belongs to two bundles; an address splits, merges, becomes unavailable when its storage is destroyed, and a difference re-ignites under a new address without persistent identity.',
  defaults: { seed: 1, horizon: 30 },
  build: (p): WorldSpec => ({
    id: 'open.operational-address', seed: n(p, 'seed', 1), horizon: n(p, 'horizon', 30),
    state: { 's/a': 1, 's/b': 2, 's/c': 3, 's/shared': 0, 'arch/copy': 0 },
    operationalAddresses: [
      { id: 'tension-field', storage: ['s/a', 's/b', 's/shared'], domains: ['bundle-1'] },
      { id: 'rhythm', storage: ['s/c', 's/shared'], domains: ['bundle-2'] },
    ],
    clocks: [{ id: 'c', period: 1 }],
    rules: [
      { id: 'pulse', clock: 'c', when: (c) => c.tick % 3 === 0 && c.op('tension-field')?.status === 'resolved', then: (c, e) => { e.add('s/shared', 1); e.add('s/a', 0.5); } },
      { id: 'split', clock: 'c', when: (c) => c.t === 8, then: (_c, e) => e.opAddress.split('tension-field', { 'tension-left': ['s/a', 's/shared'], 'tension-right': ['s/b'] }) },
      { id: 'merge', clock: 'c', when: (c) => c.t === 12, then: (_c, e) => e.opAddress.merge(['tension-right', 'rhythm'], 'composite') },
      { id: 'copy', clock: 'c', when: (c) => c.t === 14, then: (c, e) => e.set('arch/copy', c.get('s/a')) },
      { id: 'destroy', clock: 'c', when: (c) => c.t === 16, then: (_c, e) => { e.address.remove('s/a'); e.address.remove('s/shared'); } },
      { id: 'reignite', clock: 'c', when: (c) => c.t === 20 && c.op('tension-left')?.status === 'unavailable', then: (_c, e) => e.opAddress.reignite('tension-left', 'tension-archival', ['arch/copy']) },
      { id: 'unresolve', clock: 'c', when: (c) => c.t === 24, then: (_c, e) => { e.opAddress.unresolve('composite'); e.opAddress.relate('tension-archival', 'archive-domain'); } },
    ],
    probes: [{ id: 'reignited', test: (c) => c.op('tension-archival')?.status === 'resolved', monotone: true }],
  }),
};

// ---------------------------------------------------------------- novel dimension: probe-identical but description-changing runs

export const novelDimension: Preset = {
  id: 'open.novel-dimension', title: 'Description-space change invisible to probes', area: 'open-values', layer: 3,
  summary: 'Two runs with identical predefined probe results; in one, the configuration acquires a new dimension and a new transition class. Probe-relative reachability cannot tell them apart; emergent reachability and state-space lineage can.',
  defaults: { seed: 2, horizon: 30, novel: true },
  build: (p): WorldSpec => ({
    id: 'open.novel-dimension', seed: n(p, 'seed', 2), horizon: n(p, 'horizon', 30),
    config: [{ key: 'medium', value: 'liquid', status: 'specified' }],
    state: { x: 0 },
    clocks: [{ id: 'c', period: 1 }],
    rules: [
      { id: 'grow', clock: 'c', when: (c) => c.get('x') < 10, then: (_c, e) => e.add('x', 1) },
      { id: 'innovate', clock: 'c', enabled: p.novel !== false, when: (c) => c.t === 8, then: (_c, e) => {
        e.dim.set('surface-tension', { value: 'emergent', status: 'partial' });
        e.rule.add({ id: 'surface.relax', clock: 'c', label: 'new transition class', when: (c2) => c2.has('film'), then: (c2, e2) => e2.set('film', c2.get('film') * 0.9 + 0.01) });
        e.set('film', 1);
      } },
    ],
    probes: [{ id: 'x-full', test: (c) => c.get('x') >= 10, monotone: true }],
    reach: { every: 4, horizon: 8 },
  }),
};

// ---------------------------------------------------------------- boundary-relative localization

export const boundaryWorld: Preset = {
  id: 'open.boundary-localization', title: 'Boundary-relative responsibility localization', area: 'open-values', layer: 5,
  summary: 'An environmental trigger penetrates into a system and a relay produces an outcome. Where responsibility localizes depends on the analysis boundary; no boundary is claimed to be universally correct.',
  defaults: { seed: 3, horizon: 12 },
  build: (p): WorldSpec => ({
    id: 'open.boundary-localization', seed: n(p, 'seed', 3), horizon: n(p, 'horizon', 12),
    state: { 'env/signal': 0, 'sys/in': 0, 'sys/out': 0 },
    clocks: [{ id: 'c', period: 1 }],
    rules: [
      { id: 'env.trigger', clock: 'c', when: (c) => c.tick === 3, then: (_c, e) => e.set('env/signal', 1) },
      { id: 'sys.relay', clock: 'c', when: (c) => c.get('sys/in') > 0.5 && c.get('sys/out') === 0, then: (_c, e) => e.set('sys/out', 1) },
    ],
    couplings: [{ id: 'inflow', from: 'env/signal', to: 'sys/in', gain: 1, delay: 0.5, medium: 'membrane' }],
    probes: [{ id: 'out', test: (c) => c.get('sys/out') === 1, monotone: true }],
  }),
};

export const OPEN_PRESETS = [relationSpread, addressing, novelDimension, boundaryWorld];
