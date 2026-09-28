// CICGI, remnant configurations, xeno-capital and cross-scale coupling (Layer 13, XXVII–XXIX).
// Civilization is not a person-like agent: it is a set of inheritance stores (archives, technique,
// institutions, language, capital, infrastructure, machine-readable memory) through which generation
// can become cumulative. Capital-like categories are introduced only if they are non-redundant.
import type { Preset } from '../core/experiment.ts';
import type { WorldSpec, RuleSpec, Ctx } from '../core/types.ts';
import { nonRedundancy, runLight } from '../core/counterfactual.ts';
import { sc } from '../core/values.ts';

const n = (p: Record<string, unknown>, k: string, d: number) => (typeof p[k] === 'number' ? (p[k] as number) : d);
const b = (p: Record<string, unknown>, k: string, d: boolean) => (typeof p[k] === 'boolean' ? (p[k] as boolean) : d);

export const STORES = ['archive', 'technique', 'institution', 'language', 'capital', 'infrastructure', 'machine'] as const;
const W: Record<string, number> = { archive: 0.12, technique: 0.25, institution: 0.15, language: 0.1, capital: 0.12, infrastructure: 0.18, machine: 0.2 };
const DECAY: Record<string, number> = { archive: 0.01, technique: 0.08, institution: 0.06, language: 0.02, capital: 0.05, infrastructure: 0.04, machine: 0.005 };

export const cicgi: Preset = {
  id: 'civ.cicgi', title: 'CICGI: cumulative inheritance, collapse, remnants', area: 'civilization', layer: 13,
  summary: 'Each generation produces capacity from individual learning plus what it can inherit from stores. Stores decay unless maintained. A collapse removes institutions and part of infrastructure; archives and machine-readable memory may persist as remnants and re-ignite later growth.',
  questions: ['In which intervals is generation cumulative through inheritance (CICGI non-redundant)?', 'Which operational forms survive collapse and re-ignite?'],
  defaults: { seed: 71, horizon: 600, collapseAt: 300, inheritance: true, machineMemory: true },
  build: (p): WorldSpec => {
    const inh = b(p, 'inheritance', true), mm = b(p, 'machineMemory', true), col = n(p, 'collapseAt', 300);
    const state: Record<string, number> = { 'pop/alive': 1, 'gen/capacity': 1, 'gen/count': 0, 'civ/collapsed': 0 };
    for (const s of STORES) state[`store/${s}`] = 0;
    const rules: RuleSpec[] = [
      { id: 'generation', clock: 'gen', tii: true, when: (c) => c.get('pop/alive') === 1, then: (c, e) => {
        let inherited = 0;
        for (const s of STORES) if (c.has(`store/${s}`) && (s !== 'machine' || mm)) inherited += W[s] * Math.sqrt(Math.max(0, c.get(`store/${s}`)));
        const cap = 1 + 0.2 * c.rng() + (inh ? inherited * 3 : 0);
        e.set('gen/capacity', cap); e.add('gen/count', 1);
        for (const s of STORES) if (c.has(`store/${s}`) && (s !== 'machine' || mm)) {
          const v = c.get(`store/${s}`); e.add(`store/${s}`, 0.3 * cap * (s === 'machine' ? (c.t > 200 ? 1 : 0) : 1) - DECAY[s] * v * (s === 'institution' ? 2 / cap : 1));
        }
      } },
      // On its own phase-shifted clock: a same-tick generation intent would otherwise re-create the removed store.
      { id: 'collapse', clock: 'shock', tii: true, analyze: true, when: (c) => c.t >= col && c.get('civ/collapsed') === 0, then: (c, e) => {
        e.set('civ/collapsed', 1);
        e.address.remove('store/institution'); e.add('store/infrastructure', -0.7 * c.get('store/infrastructure')); e.add('store/capital', -0.8 * c.get('store/capital'));
        e.set('pop/alive', 0); e.note('collapse', { removed: ['institution'], damaged: ['infrastructure', 'capital'] });
      } },
      { id: 'recovery', clock: 'gen', tii: true, when: (c) => c.get('pop/alive') === 0 && c.t >= col + 30, then: (c, e) => {
        e.set('pop/alive', 1); e.set('store/institution', 0);
        e.note('re-ignition', { from: STORES.filter((s) => c.has(`store/${s}`) && c.get(`store/${s}`) > 1) });
      } },
    ];
    return {
      id: 'civ.cicgi', seed: n(p, 'seed', 71), horizon: n(p, 'horizon', 600), state, rules,
      config: [{ key: 'inheritance', value: inh, status: 'specified' }, { key: 'civilization-boundary', status: 'unknown' }],
      addresses: Object.fromEntries(STORES.map((s) => [`store/${s}`, { medium: s === 'machine' ? 'machine-readable' : s === 'archive' ? 'archival' : s, scale: 'civilizational' }])),
      clocks: [{ id: 'gen', period: 10, label: 'civilizational (generation)' }, { id: 'shock', period: 10, phase: 5, label: 'collapse events' }],
      probes: [{ id: 'cumulative', test: (c) => c.get('gen/capacity') > 3 }, { id: 'recovered-cumulative', test: (c) => c.t > col + 30 && c.get('gen/capacity') > 3, monotone: true }],
      reach: { every: 100, horizon: 100 },
    };
  },
};

/** Windows where capacity with inheritance exceeds capacity without it: cumulative generation is internal. */
export function cicgiIntervals(p: Record<string, unknown> = {}, windows = 12) {
  const H = n({ ...cicgi.defaults, ...p }, 'horizon', 600);
  const out: { t0: number; t1: number; withInheritance: number; without: number; cicgi: boolean }[] = [];
  for (let w = 0; w < windows; w++) {
    const t1 = ((w + 1) * H) / windows;
    const a = runLight({ ...cicgi.build({ ...cicgi.defaults, ...p }), horizon: t1 }), z = runLight({ ...cicgi.build({ ...cicgi.defaults, ...p, inheritance: false }), horizon: t1 });
    const ca = sc(a.state['gen/capacity']), cz = sc(z.state['gen/capacity']);
    out.push({ t0: (w * H) / windows, t1, withInheritance: ca, without: cz, cicgi: ca > cz * 1.5 });
  }
  return out;
}

// ---------------------------------------------------------------- xeno-capital

const KINDS = ['energy', 'compute', 'housing', 'maintenance', 'waiting', 'repair', 'access', 'sensor'] as const;
const NEEDS: Record<string, Partial<Record<(typeof KINDS)[number], number>>> = {
  households: { energy: 1, housing: 1, maintenance: 0.5, waiting: 0.5, access: 0.5 },
  fleet: { energy: 1.5, compute: 1, repair: 0.8, sensor: 0.5 },
  hybrid: { energy: 1, compute: 0.5, housing: 0.3, repair: 0.4, access: 0.4, sensor: 0.3 },
};

export const xenoCapital: Preset = {
  id: 'capital.xeno', title: 'Xeno-capital: resource redistribution without money primitives', area: 'capital', layer: 13,
  summary: 'Households, a machine fleet and a hybrid configuration need different resources. Production and redistribution move energy, compute, housing, maintenance, waiting capacity, repair, access and sensors. Is a single fungible "capital" scalar an adequate description, or does it erase non-redundant differences?',
  defaults: { seed: 81, horizon: 120, fungible: false, shock: 'repair' },
  build: (p): WorldSpec => {
    const fung = b(p, 'fungible', false), shock = String(p.shock ?? 'repair');
    const state: Record<string, number> = {};
    for (const g of Object.keys(NEEDS)) for (const k of KINDS) state[`${g}/${k}`] = 5;
    for (const g of Object.keys(NEEDS)) state[`${g}/unmet`] = 0;
    for (const k of KINDS) state[`pool/${k}`] = 3;
    const demand: Record<string, number> = {};
    for (const g of Object.keys(NEEDS)) for (const [k, v] of Object.entries(NEEDS[g])) demand[k] = (demand[k] ?? 0) + (v as number);
    const rules: RuleSpec[] = [
      { id: 'production', clock: 'cycle', when: () => true, then: (c, e) => { for (const k of KINDS) e.add(`pool/${k}`, k === shock && c.t > 40 && c.t < 80 ? 0 : 1.15 * (demand[k] ?? 0.2)); } },
      { id: 'spoilage', clock: 'cycle', when: () => true, then: (c, e) => { for (const k of KINDS) if (c.get(`pool/${k}`) > 0) e.add(`pool/${k}`, -0.3 * c.get(`pool/${k}`)); } },
    ];
    for (const g of Object.keys(NEEDS)) {
      rules.push({ id: `${g}.consume`, clock: 'cycle', when: () => true, then: (c, e) => {
        let unmet = 0;
        for (const [k, need] of Object.entries(NEEDS[g]) as [string, number][]) {
          const have = c.get(`${g}/${k}`);
          if (have >= need) e.add(`${g}/${k}`, -need);
          else if (fung) {
            // fungible description: any holding can stand in for any other
            const total = KINDS.reduce((s, kk) => s + c.get(`${g}/${kk}`), 0);
            if (total >= need) { e.add(`${g}/${k}`, -have); let rest = need - have; for (const kk of KINDS) { if (rest <= 0) break; const v = c.get(`${g}/${kk}`); if (kk !== k && v > 0) { const take = Math.min(v, rest); e.add(`${g}/${kk}`, -take); rest -= take; } } }
            else unmet += need;
          } else { e.add(`${g}/${k}`, -have); unmet += need - have; }
        }
        if (unmet > 0) e.add(`${g}/unmet`, unmet);
      } });
      rules.push({ id: `${g}.acquire`, clock: 'cycle', when: () => true, then: (c, e) => {
        for (const [k, need] of Object.entries(NEEDS[g]) as [string, number][]) { const avail = c.get(`pool/${k}`); const take = Math.min(avail / 3, need * 1.2); if (take > 0) { e.add(`pool/${k}`, -take); e.add(`${g}/${k}`, take); } }
      } });
    }
    return {
      id: 'capital.xeno', seed: n(p, 'seed', 81), horizon: n(p, 'horizon', 120), state, rules,
      config: [{ key: 'capital-description', value: fung ? 'single fungible scalar' : 'distinct resources', status: 'specified' }],
      clocks: [{ id: 'cycle', period: 1, label: 'economic' }],
      probes: Object.keys(NEEDS).map((g) => ({ id: `${g}:deprived`, test: (c: Ctx) => c.get(`${g}/unmet`) > 10, monotone: true })),
    };
  },
};

export function capitalCategoryTest(seeds = [81, 82, 83]) {
  const base = xenoCapital.build({ ...xenoCapital.defaults, fungible: false });
  return nonRedundancy({ subject: 'distinct resource kinds (vs. one fungible capital scalar)', base, seeds, tolerance: 1,
    variant: () => xenoCapital.build({ ...xenoCapital.defaults, fungible: true }),
    metric: (e) => Object.fromEntries(Object.keys(NEEDS).map((g) => [`${g}.unmet`, sc(e.state[`${g}/unmet`])])) });
}

// ---------------------------------------------------------------- cross-scale coupling

export const heatCropPolicy: Preset = {
  id: 'cross.heat-crop-policy', title: 'Cross-scale coupling: heat → crop → price → policy → aquifer', area: 'cross-scale', layer: 13,
  summary: 'Weather (daily), crop growth (seasonal), market (weekly), policy (quarterly) and an aquifer (geological) run on separate clocks. A heat difference penetrates biology, economy and institutions and returns as groundwater depletion and emissions.',
  defaults: { seed: 91, horizon: 720, subsidy: true, heatPulseAt: 200 },
  build: (p): WorldSpec => {
    const sub = b(p, 'subsidy', true);
    return {
      id: 'cross.heat-crop-policy', seed: n(p, 'seed', 91), horizon: n(p, 'horizon', 720),
      state: { 'phys/heat': 0, 'phys/aquifer': 60, 'phys/emissions': 0, 'bio/crop': 0, 'bio/harvest': 0, 'eco/price': 10, 'eco/supply': 10, 'inst/subsidy': 0, 'soc/irrigation': 0.2 },
      addresses: {
        'phys/heat': { medium: 'atmosphere', scale: 'regional' }, 'phys/aquifer': { medium: 'groundwater', scale: 'geological', tags: ['resource'] }, 'phys/emissions': { medium: 'atmosphere', scale: 'global' },
        'bio/crop': { medium: 'biological', scale: 'field' }, 'bio/harvest': { medium: 'biological', scale: 'field' }, 'eco/price': { medium: 'market', scale: 'national' },
        'eco/supply': { medium: 'market', scale: 'national' }, 'inst/subsidy': { medium: 'policy', scale: 'national' }, 'soc/irrigation': { medium: 'practice', scale: 'farm' },
      },
      clocks: [
        { id: 'day', period: 1, label: 'weather' }, { id: 'season', period: 30, phase: 30, label: 'crop cycle' }, { id: 'week', period: 7, label: 'market' },
        { id: 'quarter', period: 90, label: 'policy' }, { id: 'geo', period: 60, label: 'geological recharge' },
      ],
      rules: [
        { id: 'weather', clock: 'day', when: () => true, then: (c, e) => e.add('phys/heat', 0.05 * (c.rng() * 2 - 1) - 0.02 * c.get('phys/heat') + 0.0004 * c.get('phys/emissions')) },
        { id: 'crop.grow', clock: 'day', when: () => true, then: (c, e) => {
          const water = 0.4 + (c.get('phys/aquifer') > 5 ? c.get('soc/irrigation') : 0);
          e.add('bio/crop', Math.max(0, 0.1 * water - 0.08 * Math.max(0, c.get('phys/heat'))));
          if (c.get('phys/aquifer') > 5) e.add('phys/aquifer', -0.25 * c.get('soc/irrigation'));
        } },
        { id: 'harvest', clock: 'season', when: () => true, then: (c, e) => { e.set('bio/harvest', c.get('bio/crop')); e.set('eco/supply', c.get('bio/crop')); e.set('bio/crop', 0); e.add('phys/emissions', 0.3 * c.get('bio/crop')); } },
        { id: 'market.price', clock: 'week', when: () => true, then: (c, e) => e.add('eco/price', 0.3 * (10 * 10 / Math.max(1, c.get('eco/supply')) - c.get('eco/price'))) },
        { id: 'policy.subsidy', clock: 'quarter', enabled: sub, tii: true, when: (c) => c.get('eco/price') > 11, then: (_c, e) => { e.add('inst/subsidy', 1); e.note('policy', { subsidy: 'irrigation' }); } },
        { id: 'farm.irrigate', clock: 'week', when: (c) => c.get('soc/irrigation') < 0.2 + 0.25 * c.get('inst/subsidy'), then: (_c, e) => e.add('soc/irrigation', 0.05) },
        { id: 'aquifer.recharge', clock: 'geo', when: (c) => c.get('phys/aquifer') < 100, then: (_c, e) => e.add('phys/aquifer', 0.5) },
      ],
      interventions: [{ id: 'heat-pulse', t: n(p, 'heatPulseAt', 200), kind: 'add', address: 'phys/heat', value: 1.5 }],
      apparatus: [{ id: 'agency', label: 'national statistics', channels: [{ id: 'price', clock: 'week', reads: ['eco/price'], resolution: 0.1 }, { id: 'harvest', clock: 'season', reads: ['bio/harvest'], resolution: 0.1 }] }],
      probes: [{ id: 'aquifer-depleted', test: (c) => c.get('phys/aquifer') < 5, monotone: true }, { id: 'shortage', test: (c) => c.get('eco/supply') < 7 }],
      reach: { every: 120, horizon: 180 },
    };
  },
};

export const CIVILIZATION_PRESETS = [cicgi, xenoCapital, heatCropPolicy];
