// Layers 1–5: minimal operational dynamics, observation revision, reachability and branch closure,
// delayed correction, and fragility transfer. Addresses are bare letters on purpose: nothing here
// presupposes what the world is made of.
import type { Preset } from '../core/experiment.ts';
import type { WorldSpec } from '../core/types.ts';
import { ziranReviser } from '../ziran/reviser.ts';

const n = (p: Record<string, unknown>, k: string, d: number) => (typeof p[k] === 'number' ? (p[k] as number) : d);
const b = (p: Record<string, unknown>, k: string, d: boolean) => (typeof p[k] === 'boolean' ? (p[k] as boolean) : d);

// ---------------------------------------------------------------- Layer 1

export const operationalSampler: Preset = {
  id: 'core.operational-sampler', title: 'Minimal operational dynamics', area: 'foundations', layer: 1,
  summary: 'Stochastic ignition, splitting/threshold penetration across media, delayed activation, resource-blocked operations, suppression feedback, latching closure, and configuration reorganization — with two observation apparatuses that see different things.',
  questions: ['Which differences ignite what, after which delay?', 'Where does a pulse get lost (below threshold) versus penetrate?', 'When does the latch close a branch irreversibly?'],
  defaults: { seed: 7, horizon: 120, pulse: 0.35, resource: 8, latchAt: 4 },
  build: (p): WorldSpec => ({
    id: 'core.operational-sampler', title: 'Minimal operational dynamics', seed: n(p, 'seed', 7), horizon: n(p, 'horizon', 120),
    config: [
      { key: 'boundary', value: 'a,b,c,d', status: 'specified' },
      { key: 'medium', value: 'mixed', status: 'partial' },
      { key: 'environment', status: 'unknown' },
    ],
    state: { a: 0, b: 0, c: 0, d: 0, r: n(p, 'resource', 8), lock: 0 },
    addresses: {
      a: { medium: 'mechanical', scale: 'local' }, b: { medium: 'electrical', scale: 'local' }, c: { medium: 'chemical', scale: 'local' },
      d: { medium: 'structural', scale: 'aggregate' }, r: { medium: 'energy', tags: ['resource'] }, lock: { medium: 'structural', scale: 'aggregate' },
    },
    clocks: [{ id: 'fast', period: 1, label: 'machine' }, { id: 'slow', period: 5, label: 'structural' }],
    rules: [
      { id: 'src.pulse', clock: 'fast', label: 'stochastic source', when: () => n(p, 'pulse', 0.35), then: (c, e) => e.add('a', 0.6 + 0.4 * c.rng()) },
      { id: 'b.ignite', clock: 'fast', label: 'threshold ignition (delayed)', delay: 2, refractory: 3, tii: true, analyze: true,
        when: (c) => c.get('b') > 1 && c.get('lock') === 0, then: (_c, e) => { e.consume('r', 1); e.add('d', 1); e.set('b', 0); } },
      { id: 'c.suppress', clock: 'fast', label: 'suppressive return', when: (c) => c.get('c') > 0.6, then: (c, e) => { e.add('a', -0.5); e.add('c', -c.get('c')); } },
      { id: 'd.latch', clock: 'slow', label: 'latching closure', tii: true, analyze: true,
        when: (c) => c.get('d') >= n(p, 'latchAt', 4) && c.get('lock') === 0,
        then: (_c, e) => { e.set('lock', 1); e.dim.set('boundary', { value: 'a,b,c,d,lock', status: 'specified' }); e.note('closure', { closed: 'b.ignite' }); } },
      { id: 'decay', clock: 'slow', label: 'relaxation', when: () => true, then: (c, e) => { for (const x of ['a', 'b']) if (Math.abs(c.get(x)) > 1e-6) e.add(x, -0.5 * c.get(x)); } },
    ],
    couplings: [
      { id: 'a→b', from: 'a', to: 'b', gain: 0.8, delay: 1, medium: 'electrical', transform: 'rectify' },
      { id: 'a→c', from: 'a', to: 'c', gain: 0.6, delay: 0.5, medium: 'chemical', transform: 'threshold', threshold: 0.3 },
      { id: 'd→a', from: 'd', to: 'a', gain: 0.2, delay: 3, medium: 'structural' },
    ],
    apparatus: [
      { id: 'coarse', label: 'coarse aggregate apparatus', aliasing: true, channels: [
        { id: 'ab', clock: 'fast', reads: ['a', 'b'], aggregate: 'sum', resolution: 0.5 },
        { id: 'd', clock: 'slow', reads: ['d'], resolution: 1 },
      ] },
      { id: 'fine', label: 'fine chemical/energy apparatus', channels: [
        { id: 'c', clock: 'fast', reads: ['c'], resolution: 0.05 },
        { id: 'r', clock: 'fast', reads: ['r'], resolution: 1, range: [0, 100] },
      ] },
    ],
    probes: [
      { id: 'latched', label: 'latch closed (monotone probe)', test: (c) => c.get('lock') === 1, monotone: true },
      { id: 'resource-exhausted', test: (c) => c.get('r') < 1 },
      { id: 'b-hot', test: (c) => c.get('b') > 1.5 },
    ],
    reach: { every: 10, horizon: 20 },
  }),
  perturbations: [
    { label: 'remove chemical return (feedback interruption)', list: [{ type: 'feedback-interruption', couplings: ['a→c'] }] },
    { label: 'double resource', list: [{ type: 'resource', address: 'r', value: 16 }] },
    { label: 'coarse apparatus: finer resolution', list: [{ type: 'observation', apparatus: 'coarse', channel: 'ab', patch: { resolution: 0.1 } }] },
  ],
};

// ---------------------------------------------------------------- Layer 2

export const hiddenPhase: Preset = {
  id: 'observation.hidden-phase', title: 'Observation revision: hidden phase', area: 'foundations', layer: 2,
  summary: 'A visible address x responds to the same push in opposite directions depending on a hidden phase h. The apparatus sees x only. States that look identical diverge under the same intervention → aliasing → the Ziran reviser grows a sensor along the physical coupling graph.',
  questions: ['What distinction was previously unavailable?', 'What apparatus change makes it available?', 'Does the new distinction alter later reachability (negative excursions)?'],
  defaults: { seed: 3, horizon: 90, reviser: true, flipEvery: 7 },
  build: (p): WorldSpec => ({
    id: 'observation.hidden-phase', title: 'Observation revision: hidden phase', seed: n(p, 'seed', 3), horizon: n(p, 'horizon', 90),
    config: [{ key: 'observation', value: 'x only', status: 'specified' }, { key: 'hidden-structure', status: 'unknown' }],
    state: { x: 0, h: 1 },
    addresses: { x: { medium: 'mechanical' }, h: { medium: 'unknown' } },
    clocks: [{ id: 'w', period: 1, label: 'sensor' }],
    rules: [
      { id: 'world.flip', clock: 'w', when: (c) => c.tick % n(p, 'flipEvery', 7) === 0, then: (c, e) => e.set('h', -c.get('h')) },
      { id: 'act.push', clock: 'w', tags: ['intervention'], when: (c) => c.tick % 3 === 1,
        then: (c, e) => { const g = c.obs('A', 'grow:h').value; const s = g === null ? 1 : Math.sign(g) || 1; e.set('x', c.get('h') * s); } },
      { id: 'world.reset', clock: 'w', when: (c) => c.tick % 3 !== 1 && c.get('x') !== 0, then: (_c, e) => e.set('x', 0) },
      ...(b(p, 'reviser', true) ? [ziranReviser({ apparatus: 'A', clock: 'w', budget: 3 })] : []),
    ],
    // Physical contact between x and h: it transmits nothing noticeable, but it is where a sensor can grow.
    couplings: [{ id: 'contact', from: 'x', to: 'h', gain: 1e-6, lossThreshold: 1e-3, medium: 'contact' }],
    apparatus: [{ id: 'A', label: 'x-only apparatus', aliasing: true, channels: [{ id: 'x', clock: 'w', reads: ['x'], resolution: 1 }] }],
    probes: [{ id: 'negative-excursion', test: (c) => c.get('x') < 0 }],
    reach: { every: 15, horizon: 12 },
  }),
};

// ---------------------------------------------------------------- Layer 3

export const branchClosure: Preset = {
  id: 'reachability.branch-closure', title: 'Reachability and branch closure', area: 'foundations', layer: 3,
  summary: 'A finite capacity is invested into one of two paths; unfinished paths decay. An early stochastic commitment closes the other branch once remaining capacity cannot complete it.',
  questions: ['When does B become unreachable, and does that closure persist for the rest of the run (horizon-relative closure)?', 'Which option menu keeps both conditionally reachable longest?'],
  defaults: { seed: 11, horizon: 40, capacity: 10, need: 6 },
  build: (p): WorldSpec => {
    const need = n(p, 'need', 6);
    return {
      id: 'reachability.branch-closure', title: 'Reachability and branch closure', seed: n(p, 'seed', 11), horizon: n(p, 'horizon', 40),
      state: { capacity: n(p, 'capacity', 10), A: 0, B: 0, choice: 0 },
      addresses: { capacity: { tags: ['resource'] } },
      clocks: [{ id: 't', period: 1 }],
      rules: [
        { id: 'commit', clock: 't', when: (c) => c.tick === 3 && c.get('choice') === 0, then: (c, e) => e.set('choice', c.rng() < 0.5 ? 1 : -1), analyze: true },
        { id: 'invest', clock: 't', when: (c) => c.get('capacity') >= 1 && c.get('A') < need && c.get('B') < need,
          then: (c, e) => { const ch = c.get('choice'); e.consume('capacity', 1); if (ch >= 0) e.add('A', ch === 0 ? 0.5 : 1); if (ch <= 0) e.add('B', ch === 0 ? 0.5 : 1); } },
        { id: 'decay', clock: 't', when: (c) => c.get('A') < need || c.get('B') < need,
          then: (c, e) => { for (const x of ['A', 'B']) if (c.get(x) > 0 && c.get(x) < need) e.add(x, -Math.min(0.2, c.get(x))); } },
      ],
      probes: [
        { id: 'A-complete', test: (c) => c.get('A') >= need, monotone: true },
        { id: 'B-complete', test: (c) => c.get('B') >= need, monotone: true },
      ],
      reach: {
        every: 2, horizon: 30,
        options: [
          { id: 'hold' },
          { id: 'force-A', interventions: [{ id: 'fA', t: 0, kind: 'set', address: 'choice', value: 1 }] },
          { id: 'force-B', interventions: [{ id: 'fB', t: 0, kind: 'set', address: 'choice', value: -1 }] },
          { id: 'split', interventions: [{ id: 'sp', t: 0, kind: 'set', address: 'choice', value: 0 }] },
        ],
      },
    };
  },
};

// ---------------------------------------------------------------- Layer 4

export const tooLate: Preset = {
  id: 'timing.too-late-correction', title: 'Delayed correction: the too-slow truth', area: 'foundations', layer: 4,
  summary: 'An environment switches regime; a correction observes the regime through a sampled sensor and realigns the system after an actuation delay. Corrections are classified as correct-in-time, correct-but-too-late, incorrect (stale basis), or undetermined.',
  questions: ['When is a valid correction operationally ineffective?', 'How do sensing period, actuation delay and environmental speed trade off?'],
  defaults: { seed: 5, horizon: 200, envPeriod: 12, sensePeriod: 2, actDelay: 3, envJitter: 0.4, sensorError: 0, singleClock: false },
  build: (p): WorldSpec => (b(p, 'singleClock', false) ? singleClockTooLate(p) : {
    id: 'timing.too-late-correction', title: 'Delayed correction', seed: n(p, 'seed', 5), horizon: n(p, 'horizon', 200),
    config: [{ key: 'environmental-speed', value: n(p, 'envPeriod', 12), status: 'specified' }, { key: 'actuation-delay', value: n(p, 'actDelay', 3), status: 'specified' }],
    state: { regime: 1, x: 1, damage: 0, 'sensor/reading': 1 },
    addresses: { regime: { scale: 'environment' }, x: { scale: 'system' }, damage: { scale: 'system' } },
    clocks: [
      { id: 'env', period: n(p, 'envPeriod', 12), jitter: n(p, 'envJitter', 0.4), phase: 0.5, label: 'environment' },
      { id: 'sense', period: n(p, 'sensePeriod', 2), label: 'sensor' },
      { id: 'ctl', period: 1, label: 'controller' },
    ],
    rules: [
      { id: 'env.switch', clock: 'env', when: () => true, then: (c, e) => e.set('regime', -c.get('regime')) },
      { id: 'sensor.transduce', clock: 'ctl', label: 'physical transduction (may misread)', when: () => true,
        then: (c, e) => e.set('sensor/reading', c.rng() < n(p, 'sensorError', 0) ? -c.get('regime') : c.get('regime')) },
      { id: 'correct.align', clock: 'ctl', label: 'align to observed regime', delay: n(p, 'actDelay', 3), refractory: n(p, 'actDelay', 3),
        when: (c) => { const o = c.obs('S', 'regime').value; return o !== null && Math.sign(c.get('x')) !== o; },
        then: (c, e) => e.set('x', c.obs('S', 'regime').value ?? c.get('x')),
        correction: { premise: (c, basis) => (basis['o:S/regime'] === null || basis['o:S/regime'] === undefined ? null : c.get('regime') === basis['o:S/regime']) } },
      { id: 'mismatch.damage', clock: 'ctl', when: (c) => Math.sign(c.get('x')) !== c.get('regime'), then: (_c, e) => e.add('damage', 1) },
    ],
    apparatus: [{ id: 'S', label: 'regime sensor', channels: [{ id: 'regime', clock: 'sense', reads: ['sensor/reading'], resolution: 1 }] }],
    probes: [{ id: 'damage-high', test: (c) => c.get('damage') >= 40, monotone: true }],
  }),
};

/**
 * Single-clock model class: every process (environment, transduction, sensing, correction) is one synchronous
 * update on one clock, with no intra-process latency. Used only as the comparison class in theory benchmark C.
 */
function singleClockTooLate(p: Record<string, unknown>): WorldSpec {
  const envP = Math.max(1, Math.round(n(p, 'envPeriod', 12)));
  return {
    id: 'timing.too-late-correction', title: 'Delayed correction (single synchronous clock)', seed: n(p, 'seed', 5), horizon: n(p, 'horizon', 200),
    config: [{ key: 'clock-model', value: 'single synchronous clock', status: 'specified' }],
    state: { regime: 1, x: 1, damage: 0, 'sensor/reading': 1 },
    clocks: [{ id: 'global', period: 1, label: 'single clock' }],
    rules: [
      // All processes share one synchronous clock and act with zero latency; they differ only in what they read.
      { id: 'env.switch', clock: 'global', when: (c) => c.tick % envP === 0, then: (c, e) => e.set('regime', -c.get('regime')) },
      { id: 'sensor.transduce', clock: 'global', when: () => true, then: (c, e) => e.set('sensor/reading', c.rng() < n(p, 'sensorError', 0) ? -c.get('regime') : c.get('regime')) },
      { id: 'correct.align', clock: 'global', label: 'align to transduced regime (zero latency)', when: (c) => Math.sign(c.get('x')) !== c.get('sensor/reading'),
        then: (c, e) => e.set('x', c.get('sensor/reading')),
        correction: { premise: (c, basis) => c.get('regime') === basis['a:sensor/reading'] } },
      { id: 'mismatch.damage', clock: 'global', when: (c) => Math.sign(c.get('x')) !== c.get('regime'), then: (_c, e) => e.add('damage', 1) },
    ],
    probes: [{ id: 'damage-high', test: (c) => c.get('damage') >= 40, monotone: true }],
  };
}

// ---------------------------------------------------------------- Layer 5

export const sharedLoad: Preset = {
  id: 'fragility.shared-load', title: 'Fragility transfer: shared load', area: 'foundations', layer: 5,
  summary: 'Region A is strengthened by drawing on a shared pool, dumping overflow onto B, and shifting monitoring attention away from B. A looks better; B, the pool, and observability pay.',
  questions: ['Does strengthening A move risk, burden, or observability loss to B?', 'Does the optimizer notice?'],
  defaults: { seed: 9, horizon: 150, k: 0, pool: 60 },
  build: (p): WorldSpec => {
    const k = n(p, 'k', 0);
    return {
      id: 'fragility.shared-load', title: 'Fragility transfer: shared load', seed: n(p, 'seed', 9), horizon: n(p, 'horizon', 150),
      config: [{ key: 'reinforcement', value: k, status: 'specified' }],
      state: { 'A/stress': 0, 'B/stress': 0, 'pool/energy': n(p, 'pool', 60), 'A/fail': 0, 'B/fail': 0 },
      addresses: { 'pool/energy': { tags: ['resource'] } },
      clocks: [{ id: 't', period: 1 }],
      rules: [
        { id: 'shock', clock: 't', when: () => 0.6, then: (c, e) => { e.add('A/stress', 1.2 * c.rng()); e.add('B/stress', 1.2 * c.rng()); } },
        { id: 'A.stabilize', clock: 't', when: (c) => k > 0 && c.get('A/stress') > 1,
          then: (c, e) => { const s = c.get('A/stress'); e.consume('pool/energy', 0.3 * k); e.add('A/stress', -Math.min(s, 0.8 * k)); e.add('B/stress', 0.25 * k * s); } },
        { id: 'B.stabilize', clock: 't', when: (c) => c.get('B/stress') > 1.5, then: (_c, e) => { e.consume('pool/energy', 0.5); e.add('B/stress', -1); } },
        { id: 'A.fail', clock: 't', when: (c) => c.get('A/stress') > 5, then: (c, e) => { e.add('A/fail', 1); e.add('A/stress', -c.get('A/stress')); } },
        { id: 'B.fail', clock: 't', when: (c) => c.get('B/stress') > 5, then: (c, e) => { e.add('B/fail', 1); e.add('B/stress', -c.get('B/stress')); } },
        { id: 'relax', clock: 't', when: () => true, then: (c, e) => { for (const x of ['A/stress', 'B/stress']) if (c.get(x) > 0) e.add(x, -0.15 * c.get(x)); } },
      ],
      couplings: [{ id: 'A→B overflow', from: 'A/stress', to: 'B/stress', gain: 0.08 * k, delay: 1, medium: 'load' }],
      apparatus: [{ id: 'monitor', channels: [
        { id: 'A', clock: 't', reads: ['A/stress'], resolution: 0.25 },
        { id: 'B', clock: 't', reads: ['B/stress'], resolution: 0.25 * (1 + 2 * k) },
      ] }],
      probes: [{ id: 'A-failed', test: (c) => c.get('A/fail') >= 1, monotone: true }, { id: 'B-failed', test: (c) => c.get('B/fail') >= 1, monotone: true }, { id: 'pool-exhausted', test: (c) => c.get('pool/energy') < 0.5 }],
    };
  },
};

export const SHARED_LOAD_REGIONS = [
  { id: 'A', prefixes: ['A/'], failureProbes: ['A-failed'], limits: [{ address: 'A/stress', limit: 5, dir: 'above' as const }] },
  { id: 'B', prefixes: ['B/'], failureProbes: ['B-failed'], limits: [{ address: 'B/stress', limit: 5, dir: 'above' as const }] },
  { id: 'pool', prefixes: ['pool/'], resources: ['pool/energy'], failureProbes: ['pool-exhausted'] },
];

// ---------------------------------------------------------------- Layer 2: observation revision under a sensing budget

export const sensorBudget: Preset = {
  id: 'observation.sensor-budget', title: 'Observation revision under a sensing budget', area: 'foundations', layer: 2,
  summary: 'The hidden-phase world, but sensing consumes energy that recharges slowly. Growing a second sensor resolves the alias yet drains the budget (later readings become inaccessible); relocating the sensor resolves it cheaply but loses the old placement. The reviser exposes the trade-off; the selection policy is a parameter.',
  questions: ['Which revision hides another difference?', 'Which one moves the burden to the energy store?', 'What changes if no revision is selected?'],
  defaults: { seed: 3, horizon: 60, energy: 6, recharge: 1.3, policy: 'pareto-min-loss' },
  options: { policy: ['pareto-min-loss', 'pareto-all', 'cheapest', 'lexicographic', 'none'] },
  build: (p): WorldSpec => {
    const baseSpec = hiddenPhase.build({ ...hiddenPhase.defaults, ...p, reviser: false });
    return {
      ...baseSpec, id: 'observation.sensor-budget', title: 'Observation revision under a sensing budget',
      state: { ...baseSpec.state, 'sensor/energy': n(p, 'energy', 6) },
      addresses: { ...baseSpec.addresses, 'sensor/energy': { tags: ['resource'], medium: 'energy' } },
      rules: [...baseSpec.rules,
        { id: 'sensor.recharge', clock: 'w', when: (c) => c.get('sensor/energy') < 6, then: (c, e) => e.add('sensor/energy', Math.min(n(p, 'recharge', 1.3), 6 - c.get('sensor/energy'))) },
        ziranReviser({ apparatus: 'A', clock: 'w', budget: 2, policy: (p.policy as any) ?? 'pareto-min-loss', lookahead: 16, axes: Array.isArray(p.axes) ? (p.axes as string[]) : undefined, policyOrigin: (p.policyOrigin as any) ?? 'external' })],
      apparatus: [{ id: 'A', label: 'x-only apparatus (energy-bounded)', aliasing: true, channels: [{ id: 'x', clock: 'w', reads: ['x'], resolution: 1, cost: { address: 'sensor/energy', amount: 1 } }] }],
    };
  },
};

export const FOUNDATION_PRESETS = [operationalSampler, hiddenPhase, sensorBudget, branchClosure, tooLate, sharedLoad];
