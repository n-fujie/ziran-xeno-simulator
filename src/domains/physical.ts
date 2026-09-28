// Nonequilibrium / biophysical dynamics and medium substitution (Layers 6, XXXV, XXXVI, XII).
// Nothing is forced into agent-language: units, sites, segments, addresses.
import type { Preset } from '../core/experiment.ts';
import type { WorldSpec, RuleSpec, CouplingSpec } from '../core/types.ts';
import type { MediumTable } from '../core/perturbations.ts';
import { runLight } from '../core/counterfactual.ts';
import { sc } from '../core/values.ts';

const n = (p: Record<string, unknown>, k: string, d: number) => (typeof p[k] === 'number' ? (p[k] as number) : d);
const s = (p: Record<string, unknown>, k: string, d: string) => (typeof p[k] === 'string' ? (p[k] as string) : d);

/** Transfer characteristics per medium. Illustrative orders of magnitude, not measured constants. */
export const MEDIA: MediumTable = {
  electrical: { gain: 1, delay: 0.1, loss: 1e-4 },
  'liquid-metal': { gain: 0.98, delay: 0.15, loss: 1e-4 },
  optical: { gain: 0.95, delay: 0.05, loss: 2e-3 },
  ionic: { gain: 0.9, delay: 0.6, loss: 1e-3 },
  tensegrity: { gain: 0.85, delay: 0.3, loss: 5e-3 },
  hydrogel: { gain: 0.8, delay: 1.5, loss: 5e-3 },
  mechanical: { gain: 0.75, delay: 0.8, loss: 1e-2 },
  chemical: { gain: 0.8, delay: 2.5, loss: 5e-3 },
  ionogel: { gain: 0.85, delay: 0.9, loss: 2e-3 },
};

// ---------------------------------------------------------------- nonreciprocal excitable chain

export const nonreciprocalChain: Preset = {
  id: 'physical.nonreciprocal-chain', title: 'Nonreciprocal excitable chain', area: 'physical', layer: 6,
  summary: 'Excitable units coupled one-way (nonreciprocal) carry travelling pulses from a periodic drive; making coupling reciprocal, or substituting the medium, changes what arrives where and when.',
  defaults: { seed: 1, horizon: 80, units: 8, medium: 'electrical', reciprocal: 0 },
  options: { medium: Object.keys(MEDIA) },
  build: (p): WorldSpec => {
    const N = n(p, 'units', 8), med = s(p, 'medium', 'electrical'), row = MEDIA[med] ?? {};
    const state: Record<string, number> = { drive: 0 };
    const rules: RuleSpec[] = [{ id: 'drive', clock: 'c', when: (c) => c.t > 20 && c.tick % 10 === 1, then: (_c, e) => e.add('spike/0', 1) }];
    const couplings: CouplingSpec[] = [];
    for (let i = 0; i < N; i++) {
      state[`u/${i}`] = 0; state[`spike/${i}`] = 0; state[`refr/${i}`] = 0;
      if (i > 0) rules.push({ id: `fire.${i}`, clock: 'c', when: (c) => c.get(`u/${i}`) >= 1 && c.get(`refr/${i}`) <= 0,
        then: (c, e) => { e.add(`spike/${i}`, 1); e.add(`u/${i}`, -c.get(`u/${i}`)); e.set(`refr/${i}`, 3); } });
      rules.push({ id: `recover.${i}`, clock: 'c', when: (c) => c.get(`refr/${i}`) > 0 || Math.abs(c.get(`u/${i}`)) > 1e-3,
        then: (c, e) => { if (c.get(`refr/${i}`) > 0) e.add(`refr/${i}`, -1); if (Math.abs(c.get(`u/${i}`)) > 1e-3) e.add(`u/${i}`, -0.3 * c.get(`u/${i}`)); } });
      if (i < N - 1) couplings.push({ id: `fwd.${i}`, from: `spike/${i}`, to: `u/${i + 1}`, gain: 1.3 * (row.gain ?? 1), delay: row.delay ?? 0.1, medium: med, lossThreshold: row.loss });
      if (i > 0 && n(p, 'reciprocal', 0) > 0) couplings.push({ id: `back.${i}`, from: `spike/${i}`, to: `u/${i - 1}`, gain: 1.3 * n(p, 'reciprocal', 0) * (row.gain ?? 1), delay: row.delay ?? 0.1, medium: med });
    }
    const addresses = Object.fromEntries(Object.keys(state).map((a) => [a, { medium: a.startsWith('spike') || a.startsWith('u') ? med : 'internal', scale: 'unit' }]));
    return {
      id: 'physical.nonreciprocal-chain', seed: n(p, 'seed', 1), horizon: n(p, 'horizon', 80), state, addresses,
      clocks: [{ id: 'c', period: 1, label: 'unit cycle' }], rules, couplings,
      apparatus: [{ id: 'end', label: 'end-of-chain detector', channels: [{ id: 'last', clock: 'c', reads: [`spike/${N - 1}`] }] }],
      // A pulse injected mid-chain before the drive starts: does it reach upstream units?
      interventions: [{ id: 'mid-injection', t: 5, kind: 'add', address: `spike/${Math.floor(N / 2)}`, value: 1 }],
      probes: [
        { id: 'downstream-reached', test: (c) => c.t < 20 && c.get(`spike/${N - 1}`) >= 1, monotone: true },
        { id: 'upstream-reached', test: (c) => c.t < 20 && c.get('spike/1') >= 1, monotone: true },
        { id: 'pulse-arrives', test: (c) => c.get(`spike/${N - 1}`) >= 2, monotone: true },
      ],
    };
  },
};

// ---------------------------------------------------------------- bistable ramp

export const bistableRamp: Preset = {
  id: 'physical.bistable-ramp', title: 'Multistability, hysteresis, critical transition', area: 'physical', layer: 13,
  summary: 'dx = (r + x − x³)dt + noise with a slowly ramped control r. The state tips at a critical point; ramping back does not return it at the same r (hysteresis, history dependence). Variance rises before the tip.',
  defaults: { seed: 2, horizon: 400, noise: 0.03, rampUp: 1, rampDown: 1 },
  build: (p): WorldSpec => {
    const H = n(p, 'horizon', 400);
    return {
      id: 'physical.bistable-ramp', seed: n(p, 'seed', 2), horizon: H,
      state: { x: -1, r: -0.8 },
      addresses: { x: { scale: 'state' }, r: { scale: 'control' } },
      clocks: [{ id: 'dyn', period: 1, label: 'fast relaxation' }, { id: 'ctl', period: 5, label: 'slow control' }],
      rules: [
        { id: 'flow', clock: 'dyn', when: () => true, then: (c, e) => { const x = c.get('x'), r = c.get('r'); e.add('x', 0.1 * (r + x - x * x * x) + n(p, 'noise', 0.03) * (c.rng() * 2 - 1)); } },
        { id: 'ramp', clock: 'ctl', when: () => true, then: (c, e) => {
          const up = c.t < H / 2; const step = 1.6 / (H / 2 / 5);
          e.add('r', up ? step * n(p, 'rampUp', 1) : -step * n(p, 'rampDown', 1));
        } },
      ],
      apparatus: [{ id: 'X', channels: [{ id: 'x', clock: 'dyn', reads: ['x'], resolution: 0.01 }, { id: 'r', clock: 'ctl', reads: ['r'], resolution: 0.01 }] }],
      probes: [{ id: 'upper-branch', test: (c) => c.get('x') > 0.5 }, { id: 'tipped', test: (c) => c.get('x') > 0.5, monotone: true }],
      reach: { every: 50, horizon: 60 },
    };
  },
};

/** Hysteresis: r at which x crosses 0 going up vs going down; early-warning variance before the tip. */
export function hysteresis(tr: { observations: any; meta: { horizon: number } }) {
  const xs: [number, number | null, string][] = tr.observations.X.x;
  const rs: [number, number | null, string][] = tr.observations.X.r;
  const rAt = (t: number) => { let v = rs[0]?.[1] ?? 0; for (const [tt, vv] of rs) { if (tt > t) break; if (vv !== null) v = vv; } return v; };
  let up: number | null = null, down: number | null = null;
  for (let i = 1; i < xs.length; i++) {
    const [t, v] = xs[i], pv = xs[i - 1][1];
    if (v === null || pv === null) continue;
    if (up === null && pv < 0 && v >= 0 && t < tr.meta.horizon / 2 + 5) up = rAt(t);
    if (down === null && up !== null && pv > 0 && v <= 0 && t > tr.meta.horizon / 2) down = rAt(t);
  }
  const tipT = xs.find(([, v]) => v !== null && v > 0)?.[0] ?? null;
  const win = (t0: number, t1: number) => { const vs = xs.filter(([t, v]) => t >= t0 && t < t1 && v !== null).map(([, v]) => v as number); const m = vs.reduce((a, b) => a + b, 0) / (vs.length || 1); return vs.reduce((a, b) => a + (b - m) ** 2, 0) / (vs.length || 1); };
  return { upCrossingR: up, downCrossingR: down, hysteresisWidth: up !== null && down !== null ? up - down : null, tipT,
    earlyVariance: tipT ? win(10, 60) : null, preTipVariance: tipT ? win(Math.max(0, tipT - 40), tipT - 2) : null };
}

// ---------------------------------------------------------------- chaotic lattice

export const chaoticLattice: Preset = {
  id: 'physical.chaotic-lattice', title: 'Chaotic divergence (coupled logistic lattice)', area: 'physical', layer: 13,
  summary: 'A coupled logistic lattice at r≈3.9. Two runs differing by 1e-9 in one site diverge exponentially: identical observation at t=0 does not fix later reachability.',
  defaults: { seed: 4, horizon: 60, sites: 6, r: 3.9, eps: 0.2, perturb: 0 },
  build: (p): WorldSpec => {
    const N = n(p, 'sites', 6), r = n(p, 'r', 3.9), eps = n(p, 'eps', 0.2);
    const state: Record<string, number> = {};
    for (let i = 0; i < N; i++) state[`x/${i}`] = 0.1 + 0.07 * i;
    state['x/0'] += n(p, 'perturb', 0);
    return {
      id: 'physical.chaotic-lattice', seed: n(p, 'seed', 4), horizon: n(p, 'horizon', 60), state,
      clocks: [{ id: 'map', period: 1 }],
      rules: [{ id: 'lattice', clock: 'map', when: () => true, then: (c, e) => {
        const f = (x: number) => r * x * (1 - x);
        const x = Array.from({ length: N }, (_, i) => c.get(`x/${i}`));
        for (let i = 0; i < N; i++) e.set(`x/${i}`, (1 - eps) * f(x[i]) + (eps / 2) * (f(x[(i + N - 1) % N]) + f(x[(i + 1) % N])));
      } }],
      apparatus: [{ id: 'L', channels: [{ id: 'mean', clock: 'map', reads: ['x/*'], resolution: 1e-3 }] }],
      probes: [{ id: 'site0-high', test: (c) => c.get('x/0') > 0.9 }],
    };
  },
};

export function divergence(base: WorldSpec, perturbed: WorldSpec, steps = 40) {
  const out: { t: number; d: number }[] = [];
  for (let t = 1; t <= steps; t++) {
    const a = runLight({ ...base, horizon: t }), b = runLight({ ...perturbed, horizon: t });
    out.push({ t, d: Math.sqrt(Object.keys(a.state).reduce((s, k) => s + (sc(a.state[k]) - sc(b.state[k])) ** 2, 0)) });
  }
  const pts = out.filter((x) => x.d > 1e-14 && x.d < 0.1);
  const lyap = pts.length > 3 ? (Math.log(pts[pts.length - 1].d) - Math.log(pts[0].d)) / (pts[pts.length - 1].t - pts[0].t) : null;
  return { series: out, lyapunovEstimate: lyap };
}

// ---------------------------------------------------------------- repair / regeneration / homeostasis

export const repairTissue: Preset = {
  id: 'physical.repair-tissue', title: 'Homeostasis, repair, regeneration', area: 'physical', layer: 13,
  summary: 'A ring of sites keeps a regulated variable near a set point, repairs integrity using a shared energy store, and regenerates lost sites from neighbours. Damage is delivered as interventions.',
  defaults: { seed: 6, horizon: 160, sites: 6, energy: 40, damageAt: 40, regenerate: 1 },
  build: (p): WorldSpec => {
    const N = n(p, 'sites', 6);
    const state: Record<string, number> = { energy: n(p, 'energy', 40), 'env/heat': 0 };
    const rules: RuleSpec[] = [
      { id: 'env.heat', clock: 't', when: () => true, then: (c, e) => e.set('env/heat', 0.5 * Math.sin(c.t / 9)) },
    ];
    for (let i = 0; i < N; i++) {
      state[`site/${i}/integrity`] = 1; state[`site/${i}/temp`] = 0;
      rules.push(
        { id: `homeo.${i}`, clock: 't', tags: ['homeostasis'], when: (c) => c.has(`site/${i}/integrity`) && Math.abs(c.get(`site/${i}/temp`) - 0) > 0.05,
          then: (c, e) => { e.consume('energy', 0.02); e.add(`site/${i}/temp`, -0.5 * c.get(`site/${i}/temp`)); } },
        { id: `drift.${i}`, clock: 't', when: (c) => c.has(`site/${i}/integrity`), then: (c, e) => e.add(`site/${i}/temp`, 0.3 * c.get('env/heat')) },
        { id: `repair.${i}`, clock: 'slow', tags: ['repair'], when: (c) => c.has(`site/${i}/integrity`) && c.get(`site/${i}/integrity`) < 0.95 && c.get(`site/${i}/integrity`) > 0.1,
          then: (c, e) => { e.consume('energy', 0.5); e.add(`site/${i}/integrity`, Math.min(0.2, 1 - c.get(`site/${i}/integrity`))); } },
        { id: `die.${i}`, clock: 't', when: (c) => c.has(`site/${i}/integrity`) && c.get(`site/${i}/integrity`) <= 0.1, then: (_c, e) => { e.address.remove(`site/${i}/`); e.note('site-lost', { site: i }); } },
        { id: `regen.${i}`, clock: 'slow', tags: ['regeneration'], enabled: n(p, 'regenerate', 1) > 0,
          when: (c) => !c.has(`site/${i}/integrity`) && c.has(`site/${(i + 1) % N}/integrity`) && c.get(`site/${(i + 1) % N}/integrity`) > 0.8 && c.get('energy') > 3,
          then: (_c, e) => { e.consume('energy', 3); e.set(`site/${i}/integrity`, 0.4); e.set(`site/${i}/temp`, 0); e.note('site-regenerated', { site: i }); } },
      );
    }
    const dmg = n(p, 'damageAt', 40);
    return {
      id: 'physical.repair-tissue', seed: n(p, 'seed', 6), horizon: n(p, 'horizon', 160), state,
      addresses: { energy: { tags: ['resource'] } },
      clocks: [{ id: 't', period: 1, label: 'metabolic' }, { id: 'slow', period: 4, label: 'repair cycle' }], rules,
      interventions: [
        { id: 'wound-1', t: dmg, kind: 'set', address: 'site/2/integrity', value: 0.3 },
        { id: 'wound-2', t: dmg + 30, kind: 'set', address: 'site/4/integrity', value: 0.05 },
      ],
      apparatus: [{ id: 'T', channels: [{ id: 'integrity', clock: 'slow', reads: ['site/*'], aggregate: 'mean', resolution: 0.05 }] }],
      probes: [{ id: 'energy-exhausted', test: (c) => c.get('energy') < 0.5, monotone: true }, { id: 'site-missing', test: (c) => c.addresses('site/').filter((a) => a.endsWith('integrity')).length < N }],
      reach: { every: 40, horizon: 40 },
    };
  },
};

// ---------------------------------------------------------------- xeno-body coordination (medium substitution)

export const xenoCoordination: Preset = {
  id: 'xenobody.coordination', title: 'Xeno-body coordination under medium substitution', area: 'xeno-body', layer: 6,
  summary: 'A cue must reach all segments of a body within a deadline (fast coordination) and a holding posture must be maintained (slow holding). Segments may be tissue, hydrogel, liquid-metal, optical, … Which functions survive substituting the transfer medium?',
  questions: ['Where does electricity become non-redundant?', 'Which functions can chemical/optical/mechanical/ionic media take over?'],
  defaults: { seed: 8, horizon: 60, segments: 6, medium: 'electrical', deadline: 3 },
  options: { medium: Object.keys(MEDIA) },
  build: (p): WorldSpec => {
    const N = n(p, 'segments', 6), med = s(p, 'medium', 'electrical'), row = MEDIA[med] ?? {};
    const deadline = n(p, 'deadline', 3), cueAt = 10;
    const state: Record<string, number> = { cue: 0, 'hold/load': 0 };
    const addresses: WorldSpec['addresses'] = {};
    const rules: RuleSpec[] = [
      { id: 'cue', clock: 'b', when: (c) => c.t === cueAt, then: (_c, e) => e.set('seg/0/signal', 1.2) },
      { id: 'load', clock: 'b', when: () => true, then: (c, e) => e.set('hold/load', 0.5 + 0.3 * Math.sin(c.t / 6)) },
    ];
    const couplings: CouplingSpec[] = [];
    for (let i = 0; i < N; i++) {
      state[`seg/${i}/signal`] = 0; state[`seg/${i}/active`] = 0; state[`seg/${i}/at`] = -1; state[`seg/${i}/hold`] = 0;
      addresses[`seg/${i}/signal`] = { medium: med, scale: 'segment' };
      rules.push(
        { id: `seg.${i}.activate`, clock: 'local', when: (c) => c.get(`seg/${i}/signal`) >= 0.5 && c.get(`seg/${i}/active`) === 0,
          then: (c, e) => { e.set(`seg/${i}/active`, 1); e.set(`seg/${i}/at`, c.t); e.add(`seg/${i}/relay`, 1); } },
        { id: `seg.${i}.hold`, clock: 'slow', when: () => true,
          then: (c, e) => { const target = c.get('hold/load'); e.add(`seg/${i}/hold`, 0.5 * (target - c.get(`seg/${i}/hold`)) + (i > 0 ? 0.2 * (c.get(`seg/${i - 1}/hold`) - c.get(`seg/${i}/hold`)) : 0)); } },
      );
      state[`seg/${i}/relay`] = 0;
      if (i < N - 1) couplings.push({ id: `link.${i}`, from: `seg/${i}/relay`, to: `seg/${i + 1}/signal`, gain: 1.2 * (row.gain ?? 1), delay: row.delay ?? 0.1, medium: med });
    }
    const coordinated = (c: import('../core/types.ts').Ctx) => { let mx = -1; for (let i = 0; i < N; i++) { const a = c.get(`seg/${i}/at`); if (a < 0) return false; mx = Math.max(mx, a); } return mx - cueAt <= deadline; };
    return {
      id: 'xenobody.coordination', seed: n(p, 'seed', 8), horizon: n(p, 'horizon', 60),
      config: [{ key: 'medium', value: med, status: 'specified' }, { key: 'body-boundary', value: `${N} segments`, status: 'partial' }],
      state, addresses, rules, couplings,
      clocks: [{ id: 'b', period: 1, label: 'body' }, { id: 'local', period: 0.1, label: 'local segment' }, { id: 'slow', period: 3, label: 'posture' }],
      apparatus: [{ id: 'skin', channels: [{ id: 'active', clock: 'b', reads: ['seg/*'], aggregate: 'sum', resolution: 1 }] }],
      probes: [
        { id: 'fast-coordination', test: coordinated, monotone: true },
        { id: 'all-activated', test: (c) => Array.from({ length: N }, (_, i) => c.get(`seg/${i}/active`)).every((x) => x === 1), monotone: true },
        { id: 'holding', test: (c) => c.t > 20 && Math.abs(c.get(`seg/${N - 1}/hold`) - c.get('hold/load')) < 0.15 },
      ],
    };
  },
};

export const PHYSICAL_PRESETS = [nonreciprocalChain, bistableRamp, chaoticLattice, repairTissue, xenoCoordination];
