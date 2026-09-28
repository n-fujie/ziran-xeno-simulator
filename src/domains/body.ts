// Body without commands / Xeno-14 (Layer 7).
//
// A body is not one command-centred agent. The default organization here *is* command-centred
// (a central balance controller with a coarse, delayed sensor, and endpoint-driven movement with
// run-up) — only so that it can be compared. The Xeno-14 principles are optional configuration
// bundles, not laws. Several can ignite at once; they may compete, cooperate, suppress each other,
// lock in, redistribute sensing, change movement paths and redistribute resources.
import type { Preset } from '../core/experiment.ts';
import type { WorldSpec, RuleSpec, CouplingSpec, ApparatusSpec, Ctx } from '../core/types.ts';
import { addBundle, type Bundle } from '../core/perturbations.ts';
import type { Region } from '../analysis/fragility.ts';

const N = 5;
const seg = (i: number, k: string) => `body/seg/${i}/${k}`;
const leans = (c: Ctx) => Array.from({ length: N }, (_, i) => c.get(seg(i, 'lean')));
const axisOf = (c: Ctx) => leans(c).reduce((a, b) => a + b, 0) / N;

export const XENO14 = [
  'lower-abdominal-continuity', 'whole-skin-sensing', 'axis-maintenance', 'endpoint-removal', 'low-noise-movement',
  'minimal-approach-distance', 'zero-run-up-transition', 'tensegrity', 'slow-movement', 'narrow-step-balance',
  'fingertip-tension', 'breathing-synchronization', 'anti-collapse-posture', 'long-duration-sedimentation',
] as const;
export type Xeno14 = (typeof XENO14)[number];

function base(p: Record<string, unknown>): WorldSpec {
  const state: Record<string, number> = {
    'body/lower-abdominal/tension': 0.2, 'body/energy': Number(p.energy ?? 60), 'body/base': 1, 'body/axis': 0,
    'body/move/pos': 0, 'body/move/vel': 0, 'body/move/windup': 0, 'body/endpoint/foot': 0, 'body/endpoint/hand': 0,
    'body/breath/phase': 0, 'body/sediment': 0, 'task/cue': 0, 'task/doneAt': -1, 'task/cueAt': -1, 'env/push': 0,
  };
  const addresses: WorldSpec['addresses'] = { 'body/energy': { tags: ['resource'], medium: 'metabolic' } };
  for (let i = 0; i < N; i++) {
    state[seg(i, 'lean')] = 0; state[seg(i, 'tension')] = 0.3; state[`body/skin/${i}`] = 0;
    addresses[seg(i, 'lean')] = { medium: 'mechanical', scale: 'segment' };
    addresses[seg(i, 'tension')] = { medium: 'myofascial', scale: 'segment' };
  }
  const cues = [30, 70, 110];
  const rules: RuleSpec[] = [
    { id: 'phys.gravity', clock: 'body', label: 'inverted-pendulum instability', when: () => true, then: (c, e) => {
      for (let i = 0; i < N; i++) {
        const l = c.get(seg(i, 'lean')), t = c.get(seg(i, 'tension')), below = i ? c.get(seg(i - 1, 'lean')) : 0;
        e.add(seg(i, 'lean'), 0.12 * l + 0.05 * below - 0.18 * t * l);
      }
      e.set('body/axis', axisOf(c));
    } },
    { id: 'env.perturb', clock: 'body', label: 'external pushes', when: () => Number(p.pushRate ?? 0.25),
      then: (c, e) => { const i = Math.floor(c.rng() * N); const m = Number(p.pushSize ?? 0.18) * (c.rng() * 2 - 1); e.add(seg(i, 'lean'), m); e.add('env/push', Math.abs(m)); } },
    { id: 'task.cue', clock: 'body', label: 'transition cue', when: (c) => cues.includes(c.t), then: (c, e) => { e.set('task/cue', 1); e.set('task/cueAt', c.t); e.set('task/doneAt', -1); } },
    { id: 'task.done', clock: 'body', when: (c) => c.get('task/cue') === 1 && c.get('body/move/pos') >= cues.filter((x) => x <= c.t).length,
      then: (c, e) => { e.set('task/cue', 0); e.set('task/doneAt', c.t); } },
    { id: 'move.integrate', clock: 'body', when: (c) => Math.abs(c.get('body/move/vel')) > 1e-6, then: (c, e) => {
      const v = c.get('body/move/vel'); e.add('body/move/pos', v); e.add('body/move/vel', -v * 0.5);
      e.add(seg(0, 'lean'), 0.15 * v); e.consume('body/energy', 0.2 * Math.abs(v));
    } },
    { id: 'metabolism', clock: 'slow', when: () => true, then: (c, e) => { const tt = Array.from({ length: N }, (_, i) => c.get(seg(i, 'tension'))).reduce((a, b) => a + b, 0); e.consume('body/energy', 0.02 * tt); } },
    // --- default command-centred organization (removable) ---
    { id: 'cmd.balance', clock: 'body', label: 'central balance command', tags: ['command'], delay: 2,
      when: (c) => { const o = c.obs('center', 'axis').value; return o !== null && Math.abs(o) > 0.05; },
      then: (c, e) => { const o = c.obs('center', 'axis').value ?? 0; e.add(seg(2, 'lean'), -1.5 * o); e.consume('body/energy', 0.1); } },
    { id: 'cmd.endpoint.windup', clock: 'body', label: 'endpoint run-up', tags: ['command'],
      when: (c) => c.get('task/cue') === 1 && c.get('body/move/windup') < 3, then: (_c, e) => { e.add('body/move/windup', 1); e.add('body/endpoint/foot', 0.3); } },
    { id: 'cmd.endpoint.go', clock: 'body', label: 'endpoint-driven step', tags: ['command'],
      when: (c) => c.get('task/cue') === 1 && c.get('body/move/windup') >= 3,
      then: (c, e) => { e.add('body/move/vel', 1.6); e.set('body/move/windup', 0); e.add(seg(0, 'lean'), 0.25 * c.get('body/endpoint/foot')); e.set('body/endpoint/foot', 0); } },
  ];
  const apparatus: ApparatusSpec[] = [{ id: 'center', label: 'central coarse axis sensor', channels: [{ id: 'axis', clock: 'body', reads: ['body/axis'], resolution: 0.05 }] }];
  return {
    id: 'body.xeno14', title: 'Body without commands', seed: Number(p.seed ?? 12), horizon: Number(p.horizon ?? 150),
    config: [{ key: 'organizations', value: [], status: 'specified' }, { key: 'ground', value: 'flat', status: 'partial' }],
    state, addresses, rules, couplings: [], apparatus,
    clocks: [{ id: 'body', period: 1, label: 'body' }, { id: 'slow', period: 5, label: 'posture' }, { id: 'sediment', period: 25, label: 'long-duration' }],
    probes: [
      { id: 'collapse', test: (c) => leans(c).some((l) => Math.abs(l) > c.get('body/base')), monotone: true },
      { id: 'transition-late', test: (c) => c.get('task/cue') === 1 && c.t - c.get('task/cueAt') > 5 },
      { id: 'energy-depleted', test: (c) => c.get('body/energy') < 1, monotone: true },
    ],
    reach: { every: 30, horizon: 30 },
  };
}

function bundle(id: Xeno14): Bundle {
  const R = (rid: string, r: Omit<RuleSpec, 'id'>): RuleSpec => ({ id: `${id}.${rid}`, tags: [id], ...r });
  switch (id) {
    case 'lower-abdominal-continuity': {
      const couplings: CouplingSpec[] = Array.from({ length: N }, (_, i) => ({ id: `lac.${i}`, from: 'body/lower-abdominal/tension', to: seg(i, 'tension'), gain: 0.5, delay: 0.2, medium: 'myofascial' }));
      return { id, couplings, rules: [R('maintain', { clock: 'slow', when: (c) => c.get('body/lower-abdominal/tension') < 0.6, then: (_c, e) => { e.add('body/lower-abdominal/tension', 0.1); e.consume('body/energy', 0.1); } })] };
    }
    case 'whole-skin-sensing':
      return { id, apparatus: [{ id: 'skin', label: 'whole-skin distributed sensing', channels: Array.from({ length: N }, (_, i) => ({ id: `s${i}`, clock: 'body', reads: [seg(i, 'lean')], resolution: 0.02, modality: 'pressure' })) }],
        rules: [R('local', { clock: 'body', when: (c) => Array.from({ length: N }, (_, i) => Math.abs(c.obs('skin', `s${i}`).value ?? 0)).some((x) => x > 0.03),
          then: (c, e) => { for (let i = 0; i < N; i++) { const v = c.obs('skin', `s${i}`).value ?? 0; if (Math.abs(v) > 0.03) e.add(seg(i, 'lean'), -0.35 * v); } e.consume('body/energy', 0.03); } })] };
    case 'axis-maintenance':
      return { id, rules: [R('axis', { clock: 'body', when: (c) => Math.abs(c.get('body/axis')) > 0.02, then: (c, e) => { const a = c.get('body/axis'); for (let i = 0; i < N; i++) e.add(seg(i, 'lean'), -0.3 * a); e.consume('body/energy', 0.04); } })] };
    case 'endpoint-removal':
      return { id, rules: [
        R('disable', { clock: 'body', when: (c) => c.ruleEnabled('cmd.endpoint.windup'), then: (_c, e) => { e.rule.disable('cmd.endpoint.windup'); e.rule.disable('cmd.endpoint.go'); e.note('organization', { removed: 'endpoint command' }); } }),
        R('whole-body-step', { clock: 'body', when: (c) => c.get('task/cue') === 1 && c.get('body/move/vel') < 0.2,
          then: (c, e) => { e.add('body/move/vel', 1.2); for (let i = 0; i < N; i++) e.add(seg(i, 'lean'), 0.03 * (c.get('body/lower-abdominal/tension') < 0.4 ? 1 : 0.2)); } }),
      ] };
    case 'low-noise-movement':
      return { id, rules: [R('damp', { clock: 'body', when: (c) => c.get('env/push') > 0.01, then: (c, e) => { e.add('env/push', -c.get('env/push')); for (let i = 0; i < N; i++) e.add(seg(i, 'lean'), -0.1 * c.get(seg(i, 'lean'))); } })] };
    case 'minimal-approach-distance':
      return { id, rules: [R('shorten', { clock: 'body', when: (c) => c.get('body/move/vel') > 1.0, then: (c, e) => e.add('body/move/vel', -0.3 * (c.get('body/move/vel') - 1.0)) })] };
    case 'zero-run-up-transition':
      return { id, rules: [R('go', { clock: 'body', when: (c) => c.get('task/cue') === 1 && c.get('body/move/vel') < 0.2 && c.get('body/move/windup') === 0,
        then: (c, e) => { e.add('body/move/vel', 1.4); if (c.get('body/lower-abdominal/tension') < 0.5) e.add(seg(0, 'lean'), 0.35); } })] };
    case 'tensegrity': {
      const couplings: CouplingSpec[] = [];
      for (let i = 0; i < N - 1; i++) {
        couplings.push({ id: `tg.${i}.up`, from: seg(i, 'lean'), to: seg(i + 1, 'tension'), gain: 0.4, delay: 0.3, medium: 'tensegrity', transform: 'square' });
        couplings.push({ id: `tg.${i}.dn`, from: seg(i + 1, 'lean'), to: seg(i, 'tension'), gain: 0.4, delay: 0.3, medium: 'tensegrity', transform: 'square' });
      }
      return { id, couplings, rules: [R('distribute', { clock: 'slow', when: () => true, then: (c, e) => {
        const t = Array.from({ length: N }, (_, i) => c.get(seg(i, 'tension'))); const m = t.reduce((a, b) => a + b, 0) / N;
        for (let i = 0; i < N; i++) e.add(seg(i, 'tension'), 0.5 * (m - t[i]) - 0.05 * t[i] + 0.02);
      } })] };
    }
    case 'slow-movement':
      return { id, rules: [R('slow', { clock: 'body', when: (c) => c.get('body/move/vel') > 0.6, then: (c, e) => e.add('body/move/vel', -0.4 * (c.get('body/move/vel') - 0.6)) })] };
    case 'narrow-step-balance':
      return { id, state: { 'body/base': 0.7 } };
    case 'fingertip-tension':
      return { id, couplings: [{ id: 'fingertip→lac', from: 'body/endpoint/hand', to: 'body/lower-abdominal/tension', gain: 0.4, delay: 0.5, medium: 'myofascial' }],
        apparatus: [{ id: 'fingertip', label: 'fingertip tension sensing', channels: [{ id: 'hand', clock: 'body', reads: ['body/endpoint/hand'], resolution: 0.05 }] }],
        rules: [R('hold', { clock: 'slow', when: (c) => (c.obs('fingertip', 'hand').value ?? 0) < 0.4, then: (_c, e) => { e.add('body/endpoint/hand', 0.1); e.consume('body/energy', 0.05); } })] };
    case 'breathing-synchronization':
      return { id, clocks: [{ id: 'breath', period: 4, label: 'breath cycle' }], rules: [
        R('cycle', { clock: 'breath', when: () => true, then: (c, e) => { const ph = c.get('body/breath/phase') === 0 ? 1 : 0; e.set('body/breath/phase', ph); for (let i = 0; i < N; i++) e.add(seg(i, 'tension'), ph ? 0.05 : -0.05); } }),
        R('exhale-release', { clock: 'body', when: (c) => c.get('body/breath/phase') === 0 && Math.abs(c.get('body/axis')) > 0.04, then: (c, e) => { for (let i = 0; i < N; i++) e.add(seg(i, 'lean'), -0.15 * c.get(seg(i, 'lean'))); } }),
      ] };
    case 'anti-collapse-posture':
      return { id, rules: [R('catch', { clock: 'body', when: (c) => leans(c).some((l) => Math.abs(l) > 0.55 * c.get('body/base')),
        then: (c, e) => { for (let i = 0; i < N; i++) { const l = c.get(seg(i, 'lean')); if (Math.abs(l) > 0.55 * c.get('body/base')) e.add(seg(i, 'lean'), -0.6 * l); } e.consume('body/energy', 0.8); } })] };
    case 'long-duration-sedimentation':
      return { id, rules: [R('sediment', { clock: 'sediment', when: () => true, then: (c, e) => {
        e.add('body/sediment', 1);
        for (let i = 0; i < N; i++) if (c.coupling(`lac.${i}`)) e.coupling.patch(`lac.${i}`, { gain: 0.5 + 0.1 * (c.get('body/sediment') + 1) });
        e.add('body/lower-abdominal/tension', 0.05);
      } })] };
  }
}

export function bodySpec(p: Record<string, unknown>): WorldSpec {
  let spec = base(p);
  const orgs = (Array.isArray(p.organizations) ? p.organizations : []) as Xeno14[];
  for (const o of orgs) if ((XENO14 as readonly string[]).includes(o)) spec = addBundle(spec, bundle(o));
  spec.config = [...(spec.config ?? []).filter((d) => d.key !== 'organizations'), { key: 'organizations', value: orgs, status: 'specified' }];
  return spec;
}

export const BODY_REGIONS: Region[] = [
  { id: 'axis', prefixes: ['body/seg/', 'body/axis'], failureProbes: ['collapse'], limits: Array.from({ length: N }, (_, i) => ({ address: seg(i, 'lean'), limit: 1, dir: 'above' as const })) },
  { id: 'core', prefixes: ['body/lower-abdominal/'] },
  { id: 'energy', prefixes: ['body/energy'], resources: ['body/energy'], failureProbes: ['energy-depleted'] },
  { id: 'movement', prefixes: ['body/move/', 'task/'], failureProbes: ['transition-late'] },
  { id: 'endpoints', prefixes: ['body/endpoint/'] },
];

export const bodyPreset: Preset = {
  id: 'body.xeno14', title: 'Body without commands (Xeno-14 bundles)', area: 'body', layer: 7,
  summary: 'A five-segment body under pushes and transition cues. The default organization is command-centred (central coarse sensor, endpoint run-up). Any subset of the 14 Xeno-14 bundles can be switched on; several ignite at once.',
  questions: ['Which bundles compete, cooperate or suppress each other?', 'Does one organization lock in?', 'Does removing endpoints move fragility to the core or to energy?'],
  defaults: { seed: 12, horizon: 150, energy: 60, pushRate: 0.25, pushSize: 0.18, organizations: [] },
  options: { organizations: XENO14 },
  build: bodySpec,
};

export const BODY_PRESETS = [bodyPreset];
