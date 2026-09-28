// Worlds for meta-configuration experiments: meta-grammar adaptation, runtime-registered description facets
// and value kinds, and adversarial model-class comparisons (where the framework's favoured mechanism should
// NOT win automatically).
import type { Preset } from '../core/experiment.ts';
import type { WorldSpec, RuleSpec } from '../core/types.ts';
import type { DescriptionFacet } from '../core/description.ts';
import type { ValueSemantics, RelationValue } from '../core/values.ts';
import { hiddenPhase } from './foundations.ts';
import { ziranReviser } from '../ziran/reviser.ts';

const n = (p: Record<string, unknown>, k: string, d: number) => (typeof p[k] === 'number' ? (p[k] as number) : d);
const b = (p: Record<string, unknown>, k: string, d: boolean) => (typeof p[k] === 'boolean' ? (p[k] as boolean) : d);

// ---------------------------------------------------------------- meta-grammar adaptation world

export const REGIMES_DEFAULT: [number, number][] = [[0, 240], [240, 480], [480, 560]];

export const delayThreshold: Preset = {
  id: 'meta.delay-threshold', title: 'Meta-grammar: recurring delay→threshold regularity', area: 'meta-configuration', layer: 8,
  summary: 'Two channels follow a hidden law in which a thresholded delayed value matters. Regime 1 also has a linear delayed term (so a delay operator is individually useful); in regime 2 only the thresholded term at a different delay remains; regime 3 is short. The initial grammar cannot express it; ordinary morphogenesis needs a sequence of mutations; meta-grammar morphogenesis can abstract the sequence.',
  defaults: { seed: 9, horizon: 560, k1: 5, k2: 9, k3: 3, noise: 0.3 },
  build: (p): WorldSpec => {
    const k1 = n(p, 'k1', 5), k2 = n(p, 'k2', 9), k3 = n(p, 'k3', 3), nz = n(p, 'noise', 0.3);
    const law = (c: import('../core/types.ts').Ctx, ch: string) => {
      const x = c.get(ch), t = c.t;
      // delayed negative feedback → relay oscillation, so the lagged sign carries information beyond x itself
      if (t < 240) return 0.5 * x - 0.15 * c.hist(ch, k1) - 0.9 * Math.sign(c.hist(ch, k1));
      if (t < 480) return 0.5 * x - 0.8 * Math.sign(c.hist(ch, k2));
      return 0.5 * x - 0.8 * Math.sign(c.hist(ch, k3));
    };
    return {
      id: 'meta.delay-threshold', seed: n(p, 'seed', 9), horizon: n(p, 'horizon', 560),
      config: [{ key: 'hidden-law', status: 'unknown' }],
      state: { x: 0.5, y: -0.5 },
      clocks: [{ id: 'dyn', period: 1 }, { id: 'obs', period: 1, phase: 0.5 }],
      rules: [{ id: 'hidden.law', clock: 'dyn', when: () => true, then: (c, e) => { e.set('x', law(c, 'x') + nz * (c.rng() * 2 - 1)); e.set('y', law(c, 'y') + nz * (c.rng() * 2 - 1)); } }],
      interventions: [60, 150, 300, 390, 500].map((t, i) => ({ id: `kick${i}`, t: t + 0.25, kind: 'add' as const, address: 'x', value: 1.5 })),
      apparatus: [{ id: 'O', channels: [{ id: 'x', clock: 'obs', reads: ['x'] }, { id: 'y', clock: 'obs', reads: ['y'] }] }],
    };
  },
};

// ---------------------------------------------------------------- domain-introduced description facet (causal order)

/** A description facet unknown to the core: which events causally precede which (from 'precedes'-labelled relations). */
export const causalOrderFacet: DescriptionFacet = {
  id: 'causal-order', label: 'causal-order relation (domain facet)', origin: 'domain-registered',
  describe: (s) => { const o: string[] = []; for (const v of Object.values(s.state)) if ((v as RelationValue)?.kind === 'relation') for (const e of (v as RelationValue).edges) if (e[2] === 'precedes') o.push(`${e[0]}<${e[1]}`); return o; },
  lineage: (ch) => `causal order ${ch.added.length ? 'gained ' + ch.added.join(', ') : ''}${ch.removed.length ? ' lost ' + ch.removed.join(', ') : ''}`,
};

export const causalFacetWorld: Preset = {
  id: 'meta.causal-order-facet', title: 'Domain-registered description facet (causal order)', area: 'meta-configuration', layer: 3,
  summary: 'A domain registers a description facet the core does not know ("causal order"). With registerAtRuntime the facet is added during the run (Level D); afterwards new precedence pairs are Level-C changes inside the new facet.',
  defaults: { seed: 1, horizon: 20, registerAtRuntime: true },
  build: (p): WorldSpec => {
    const rt = b(p, 'registerAtRuntime', true);
    const rules: RuleSpec[] = [
      { id: 'observe-order', clock: 'c', when: (c) => c.tick % 4 === 0, then: (c, e) => {
        const r = c.value('events/order') as RelationValue; const k = r.edges.length;
        e.set('events/order', { kind: 'relation', edges: [...r.edges, [`e${k}`, `e${k + 1}`, 'precedes']] });
      } },
    ];
    if (rt) rules.push({ id: 'adopt-facet', clock: 'c', when: (c) => c.t === 6 && !c.metaActive('description-facet').includes('causal-order'), then: (_c, e) => e.meta.registerFacet(causalOrderFacet) });
    return {
      id: 'meta.causal-order-facet', seed: n(p, 'seed', 1), horizon: n(p, 'horizon', 20),
      state: { 'events/order': { kind: 'relation', edges: [['e0', 'e1', 'precedes']] } },
      facets: rt ? [] : [causalOrderFacet],
      clocks: [{ id: 'c', period: 1 }], rules,
    };
  },
};

// ---------------------------------------------------------------- runtime value kind

/** An interval value kind registered by a domain at runtime — no core edits. */
export const intervalKind: ValueSemantics = {
  kind: 'interval',
  equals: (a: any, c: any) => !!a && !!c && Math.abs(a.lo - c.lo) < 1e-9 && Math.abs(a.hi - c.hi) < 1e-9,
  difference: (a: any, c: any) => ({ shiftLo: c.lo - (a?.lo ?? 0), shiftHi: c.hi - (a?.hi ?? 0) }),
  transmit: (a: any, c: any) => ({ kind: 'interval-shift', dlo: c.lo - (a?.lo ?? c.lo), dhi: c.hi - (a?.hi ?? c.hi) }),
  receive: (t: any, d: any) => ({ kind: 'interval', lo: (t?.lo ?? 0) + d.dlo, hi: (t?.hi ?? 0) + d.dhi }),
  magnitude: (d: any) => Math.abs(d.dlo) + Math.abs(d.dhi),
  distance: (a: any, c: any) => Math.max(Math.abs(a.lo - c.lo), Math.abs(a.hi - c.hi)),
  serialize: (v: any) => ({ interval: [v.lo, v.hi] }),
  render: (v: any) => `[${v.lo.toFixed(2)}, ${v.hi.toFixed(2)}]`,
  distinctions: () => ({ retained: ['interval bounds'], lost: ['which point inside the interval'], new: [], unknown: [] }),
};

export const runtimeKindWorld: Preset = {
  id: 'meta.runtime-value-kind', title: 'Runtime-registered value kind (interval)', area: 'meta-configuration', layer: 1,
  summary: 'At t=2 a rule registers a new value kind ("interval") through the meta-configuration and starts writing intervals, which penetrate along a coupling and are compared, serialized and rendered by the new kind’s own semantics.',
  defaults: { seed: 1, horizon: 12 },
  build: (p): WorldSpec => ({
    id: 'meta.runtime-value-kind', seed: n(p, 'seed', 1), horizon: n(p, 'horizon', 12), state: { tick: 0 },
    clocks: [{ id: 'c', period: 1 }],
    rules: [
      { id: 'register-interval', clock: 'c', when: (c) => c.t === 2 && !c.metaActive('value-kind').includes('interval'), then: (_c, e) => e.meta.registerValueKind(intervalKind) },
      { id: 'estimate', clock: 'c', when: (c) => c.t >= 3 && c.metaActive('value-kind').includes('interval'), then: (c, e) => e.set('est/band', { kind: 'interval', lo: c.t * 0.5, hi: c.t * 0.5 + 1 }) },
    ],
    couplings: [{ id: 'report', from: 'est/band', to: 'report/band', gain: 1, delay: 0.5, medium: 'report', lossThreshold: 0.01 }],
    apparatus: [{ id: 'A', channels: [{ id: 'band', clock: 'c', reads: ['est/band'] }] }],
  }),
};

// ---------------------------------------------------------------- adversarial worlds

/** G: observation revision that costs but yields nothing downstream (the controller ignores the new sensor). */
export const uselessRevision: Preset = {
  id: 'adversarial.useless-revision', title: 'Adversarial G: revision without downstream benefit', area: 'adversarial', layer: 2,
  summary: 'The hidden-phase world, but nothing downstream uses the grown sensor and sensing costs energy. Self-revision should not automatically win.',
  defaults: { seed: 3, horizon: 90, reviser: true },
  build: (p): WorldSpec => {
    const base = hiddenPhase.build({ ...hiddenPhase.defaults, ...p, reviser: false });
    return { ...base, id: 'adversarial.useless-revision',
      state: { ...base.state, 'sensor/energy': 50 }, addresses: { ...base.addresses, 'sensor/energy': { tags: ['resource'] } },
      rules: [...base.rules.map((r) => (r.id === 'act.push' ? { ...r, then: (c: any, e: any) => e.set('x', c.get('h')) } : r)),
        ...(b(p, 'reviser', true) ? [ziranReviser({ apparatus: 'A', clock: 'w', budget: 3 })] : [])],
      apparatus: [{ id: 'A', aliasing: true, channels: [{ id: 'x', clock: 'w', reads: ['x'], resolution: 1, cost: { address: 'sensor/energy', amount: 0.2 } }] }] };
  },
};

/** H: a stable AR(1) world where a richer grammar can only overfit. */
export const stableLinear: Preset = {
  id: 'adversarial.stable-linear', title: 'Adversarial H: stable linear world', area: 'adversarial', layer: 8,
  summary: 'x_{t+1} = 0.7 x_t + noise, with no delays, windows or thresholds. Grammar morphogenesis has nothing real to find.',
  defaults: { seed: 4, horizon: 320, noise: 0.5 },
  build: (p): WorldSpec => ({ id: 'adversarial.stable-linear', seed: n(p, 'seed', 4), horizon: n(p, 'horizon', 320), state: { x: 0 },
    clocks: [{ id: 'dyn', period: 1 }, { id: 'obs', period: 1, phase: 0.5 }],
    rules: [{ id: 'ar1', clock: 'dyn', when: () => true, then: (c, e) => e.set('x', 0.7 * c.get('x') + n(p, 'noise', 0.5) * (c.rng() * 2 - 1)) }],
    apparatus: [{ id: 'O', channels: [{ id: 'x', clock: 'obs', reads: ['x'] }] }] }),
};

/** J/K: two order sources with identical operational roles. Unit identity matters only if budgets are separate. */
export const twinUnits: Preset = {
  id: 'adversarial.twin-units', title: 'Adversarial J/K: when a thick unit category matters', area: 'adversarial', layer: 10,
  summary: 'Two order sources have identical rules (same operational role). With separate budgets, cutting unit 1’s budget changes only unit 1’s orders — the unit label carries interventional information the role description lacks. With a shared budget, the unit label adds nothing.',
  defaults: { seed: 5, horizon: 120, separateBudgets: true, cutAt: 60 },
  build: (p): WorldSpec => {
    const sep = b(p, 'separateBudgets', true);
    const budget = (u: string) => (sep ? `${u}/budget` : 'shared/budget');
    const unit = (u: string): RuleSpec[] => [
      { id: `${u}.order`, clock: 'c', tags: ['order-source'], when: (c) => c.get(budget(u)) >= 1 && c.rng() < 0.6, then: (_c, e) => { e.consume(budget(u), 1); e.add('flow', 1); e.add(`${u}/orders`, 1); } },
      { id: `${u}.refill`, clock: 'c', tags: ['order-source'], when: (c) => c.tick % 5 === 0, then: (_c, e) => e.add(budget(u), 2) },
    ];
    return { id: 'adversarial.twin-units', seed: n(p, 'seed', 5), horizon: n(p, 'horizon', 120),
      state: sep ? { 'u1/budget': 5, 'u2/budget': 5, flow: 0, 'u1/orders': 0, 'u2/orders': 0 } : { 'shared/budget': 10, flow: 0, 'u1/orders': 0, 'u2/orders': 0 },
      clocks: [{ id: 'c', period: 1 }], rules: [...unit('u1'), ...unit('u2')],
      interventions: [{ id: 'cut-u1', t: n(p, 'cutAt', 60) + 0.5, kind: 'emit', label: 'cut the budget of unit 1', apply: (_c, e) => { e.rule.disable('u1.refill'); if (sep) e.set('u1/budget', 0); else e.set('shared/budget', 0); } }] };
  },
};

/** L: a stable, useful configuration and a self-reorganization rule that reacts to noise by rewiring. */
export const harmfulReorg: Preset = {
  id: 'adversarial.harmful-reorganization', title: 'Adversarial L: harmful self-reorganization', area: 'adversarial', layer: 5,
  summary: 'A controller keeps x near 0 through a well-tuned coupling. A self-reorganization rule rewires the coupling whenever an error spike occurs. Reorganization is not intrinsically beneficial.',
  defaults: { seed: 6, horizon: 200, reorganize: true },
  build: (p): WorldSpec => ({ id: 'adversarial.harmful-reorganization', seed: n(p, 'seed', 6), horizon: n(p, 'horizon', 200),
    state: { x: 0, damage: 0, gain: 0.5 },
    clocks: [{ id: 'c', period: 1 }],
    rules: [
      { id: 'drift', clock: 'c', when: () => true, then: (c, e) => e.add('x', 0.5 * (c.rng() * 2 - 1) + 0.05 * c.get('x')) },
      // the stable, useful configuration: proportional correction toward 0
      { id: 'control', clock: 'c', when: () => true, then: (c, e) => e.add('x', -c.get('gain') * c.get('x')) },
      { id: 'damage', clock: 'c', when: (c) => Math.abs(c.get('x')) > 1.2, then: (_c, e) => e.add('damage', 1) },
      // self-reorganization: reacts to any error spike by re-tuning the controller (here: flipping to a weak, then an overshooting gain)
      { id: 'self.reorganize', clock: 'c', enabled: b(p, 'reorganize', true), tags: ['reorganization'], refractory: 5, when: (c) => Math.abs(c.get('x')) > 0.8,
        then: (c, e) => { const g = c.get('gain'); const ng = g === 0.5 ? 0.05 : g === 0.05 ? 1.9 : 0.05; e.set('gain', ng); e.dim.set('controller-tuning', { value: ng, status: 'specified' }); e.note('reorganized', { newGain: ng }); } },
    ],
    probes: [{ id: 'damage-high', test: (c) => c.get('damage') >= 30, monotone: true }] }),
};

/** M: storage identity vs operational address — a storage slot is reused by an unrelated difference, and the original difference re-ignites elsewhere. */
export const slotReuse: Preset = {
  id: 'adversarial.slot-reuse', title: 'Storage identity vs operational address (slot reuse)', area: 'adversarial', layer: 1,
  summary: 'Difference α lives in storage s/slot. α is lost; later s/slot is reused by an unrelated difference β, while α re-ignites in s/other with lineage. Treating storage identity as the address reads continuity where there is none and loss where there is re-ignition.',
  defaults: { seed: 1, horizon: 20 },
  build: (p): WorldSpec => ({ id: 'adversarial.slot-reuse', seed: n(p, 'seed', 1), horizon: n(p, 'horizon', 20),
    state: { 's/slot': 1, 's/other': 0, 'arch/alpha': 0 },
    operationalAddresses: [{ id: 'alpha', storage: ['s/slot'], domains: ['bundle-A'] }, { id: 'probe-window', storage: ['s/slot'], ttl: 5 }],
    clocks: [{ id: 'c', period: 1 }],
    rules: [
      { id: 'alpha.grow', clock: 'c', when: (c) => c.op('alpha')?.status === 'resolved' && c.t < 6, then: (_c, e) => e.add('s/slot', 1) },
      { id: 'archive', clock: 'c', when: (c) => c.t === 5, then: (c, e) => e.set('arch/alpha', c.get('s/slot')) },
      { id: 'lose-alpha', clock: 'c', when: (c) => c.t === 6, then: (_c, e) => e.opAddress.unavailable('alpha') },
      { id: 'beta.claims-slot', clock: 'c', when: (c) => c.t === 8, then: (_c, e) => { e.set('s/slot', 100); e.opAddress.bind('beta', ['s/slot'], ['bundle-B']); } },
      { id: 'alpha.reignites', clock: 'c', when: (c) => c.t === 10, then: (c, e) => { e.set('s/other', c.get('arch/alpha')); e.opAddress.reignite('alpha', 'alpha′', ['s/other']); e.opAddress.relateAddress('alpha′', 'alpha', 'reignites'); } },
      { id: 'uncertain-locus', clock: 'c', when: (c) => c.t === 12, then: (_c, e) => e.opAddress.uncertain('gamma', [['s/slot'], ['s/other']]) },
    ] }),
};

export const META_PRESETS = [delayThreshold, causalFacetWorld, runtimeKindWorld, uselessRevision, stableLinear, twinUnits, harmfulReorg, slotReuse];
