// Law, institutions and score ecologies (Layer 9, XXX, XXXI).
// Legal effects are not abstract rules: they ignite locally through documents, software, permissions,
// identity systems, financial access, physical enforcement and individual responses. Scores are
// operational configurations whose penetration into later measurement and resource access is tracked.
import type { Preset } from '../core/experiment.ts';
import type { WorldSpec, RuleSpec, CouplingSpec, ChannelSpec } from '../core/types.ts';

const n = (p: Record<string, unknown>, k: string, d: number) => (typeof p[k] === 'number' ? (p[k] as number) : d);

export const lawPenetration: Preset = {
  id: 'institution.law-penetration', title: 'Law penetration', area: 'institutions', layer: 9,
  summary: 'An enacted text becomes operational only where it is implemented: machine-readable rule → permission system (needs an identity record) → financial access → behaviour; deviations trigger physical enforcement. People without identity records are reached only through a slow manual procedure.',
  questions: ['Where does the law locally ignite?', 'Across which media does it penetrate?', 'Who is reached late or never, and why?'],
  defaults: { seed: 14, horizon: 120, people: 5, unregistered: 1, implementationLag: 6, software: 1 },
  build: (p): WorldSpec => {
    const P = n(p, 'people', 5), unreg = n(p, 'unregistered', 1), lag = n(p, 'implementationLag', 6);
    const state: Record<string, number> = { 'law/text': 0, 'law/machine-rule': 0, 'law/procedure': 0 };
    const addresses: WorldSpec['addresses'] = {
      'law/text': { medium: 'document', scale: 'institutional' }, 'law/machine-rule': { medium: 'software', scale: 'institutional' },
      'law/procedure': { medium: 'office-procedure', scale: 'institutional' },
    };
    const rules: RuleSpec[] = [
      { id: 'legislature.enact', clock: 'inst', tii: true, analyze: true, when: (c) => c.t === 10, then: (_c, e) => { e.set('law/text', 1); e.note('law.enacted', { text: 'activity requires permit' }); } },
    ];
    const couplings: CouplingSpec[] = [
      { id: 'codify', from: 'law/text', to: 'law/machine-rule', gain: 1, delay: lag, medium: 'software', enabled: n(p, 'software', 1) > 0 },
      { id: 'circular', from: 'law/text', to: 'law/procedure', gain: 1, delay: 3 * lag, medium: 'office-procedure' },
    ];
    for (let i = 0; i < P; i++) {
      const id = `p${i}`;
      state[`id/${id}`] = i < P - unreg ? 1 : 0; state[`perm/${id}`] = 1; state[`fin/${id}/access`] = 1; state[`act/${id}`] = 1; state[`enf/${id}`] = 0; state[`body/${id}/stress`] = 0;
      addresses[`perm/${id}`] = { medium: 'permission-system' }; addresses[`fin/${id}/access`] = { medium: 'finance' };
      addresses[`act/${id}`] = { medium: 'behaviour' }; addresses[`enf/${id}`] = { medium: 'physical-enforcement' }; addresses[`id/${id}`] = { medium: 'identity-system' };
      addresses[`body/${id}/stress`] = { medium: 'body' };
      rules.push(
        { id: `software.permit.${id}`, clock: 'inst', label: 'machine-readable rule applies via identity record',
          when: (c) => c.get('law/machine-rule') > 0.5 && c.get(`id/${id}`) === 1 && c.get(`perm/${id}`) === 1 && c.get(`hasPermit/${id}`) === 0,
          then: (_c, e) => e.set(`perm/${id}`, 0) },
        { id: `office.permit.${id}`, clock: 'office', label: 'manual procedure',
          when: (c) => c.get('law/procedure') > 0.5 && c.get(`id/${id}`) === 0 && c.get(`perm/${id}`) === 1, then: (_c, e) => e.set(`perm/${id}`, 0) },
        { id: `respond.${id}`, clock: 'person', label: 'individual response',
          when: (c) => c.get(`perm/${id}`) === 0 && c.get(`act/${id}`) > 0,
          then: (c, e) => { if (c.rng() < 0.4) e.set(`act/${id}`, 0); else e.add(`body/${id}/stress`, 1); } },
        { id: `enforce.${id}`, clock: 'inst', label: 'physical enforcement',
          when: (c) => c.get(`perm/${id}`) === 0 && c.get(`act/${id}`) > 0 && c.get(`fin/${id}/access`) === 0,
          then: (_c, e) => { e.add(`enf/${id}`, 1); e.set(`act/${id}`, 0); e.add(`body/${id}/stress`, 2); } },
      );
      state[`hasPermit/${id}`] = i === 0 ? 1 : 0;
      couplings.push({ id: `bank.${id}`, from: `perm/${id}`, to: `fin/${id}/access`, gain: 1, delay: 2, medium: 'finance' });
    }
    return {
      id: 'institution.law-penetration', seed: n(p, 'seed', 14), horizon: n(p, 'horizon', 120),
      config: [{ key: 'identity-system', value: 'registry', status: 'specified' }, { key: 'enforcement', value: 'physical', status: 'partial' }],
      state, addresses, rules, couplings,
      clocks: [{ id: 'inst', period: 1, label: 'institutional' }, { id: 'office', period: 7, label: 'office cycle' }, { id: 'person', period: 2, label: 'daily life' }],
      apparatus: [{ id: 'registry', label: 'state registry', channels: [{ id: 'active', clock: 'inst', reads: ['act/*'], aggregate: 'sum' }, { id: 'enforced', clock: 'inst', reads: ['enf/*'], aggregate: 'sum' }] }],
      probes: [
        { id: 'all-reached', test: (c) => c.addresses('perm/').filter((a) => c.get('hasPermit/' + a.slice(5)) === 0).every((a) => c.get(a) === 0), monotone: true },
        { id: 'enforcement-used', test: (c) => c.addresses('enf/').some((a) => c.get(a) > 0), monotone: true },
      ],
      reach: { every: 20, horizon: 40 },
    };
  },
  perturbations: [
    { label: 'no software implementation (institutional rule modification)', list: [{ type: 'physical-implementation', coupling: 'codify', patch: { enabled: false } }] },
    { label: 'register everyone (identity system change)', list: [{ type: 'resource', address: 'id/p4', value: 1 }] },
  ],
};

export const scoreEcology: Preset = {
  id: 'institution.score-ecology', title: 'Score ecology', area: 'institutions', layer: 9,
  summary: 'Behaviour produces score A; score B conditions on A and on resources; resources flow by B; low B adds surveillance channels, which detect more infractions and lower A. A small initial difference can be amplified through measurement itself.',
  questions: ['Which loops are self-reinforcing?', 'Does a score change future measurement?', 'Where does the score penetrate the body?'],
  defaults: { seed: 17, horizon: 150, people: 5, initialGap: 0.3, surveillance: 1 },
  build: (p): WorldSpec => {
    const P = n(p, 'people', 5), gap = n(p, 'initialGap', 0.3);
    const state: Record<string, number> = { 'pool/credit': 50 };
    const rules: RuleSpec[] = [];
    const channels: ChannelSpec[] = [];
    for (let i = 0; i < P; i++) {
      const id = `p${i}`;
      state[`beh/${id}`] = 0.1 * ((i * 7919) % 5); state[`res/${id}`] = 10 - (i === 0 ? gap * 10 : 0); state[`scoreA/${id}`] = 0.6; state[`scoreB/${id}`] = 0.6;
      state[`body/${id}/stress`] = 0; state[`watched/${id}`] = 0;
      channels.push({ id: `A.${id}`, clock: 'cycle', reads: [`scoreA/${id}`], resolution: 0.05 }, { id: `inf.${id}`, clock: 'cycle', reads: [`beh/${id}`], resolution: 0.1 });
      rules.push(
        { id: `behaviour.${id}`, clock: 'day', when: () => true, then: (c, e) => { const st = c.get(`body/${id}/stress`); e.set(`beh/${id}`, 0.25 * c.rng() + 0.25 * st); } },
        { id: `scoreA.${id}`, clock: 'cycle', label: 'infraction score from observed behaviour',
          when: (c) => c.obs('bureau', `inf.${id}`).value !== null,
          then: (c, e) => { const seen = (c.obs('bureau', `inf.${id}`).value ?? 0) + (c.get(`watched/${id}`) ? (c.obs('bureau', `close.${id}`).value ?? 0) : 0); e.set(`scoreA/${id}`, Math.max(0, Math.min(1, 0.7 * c.get(`scoreA/${id}`) + 0.3 * (1 - 2.5 * seen)))); } },
        { id: `scoreB.${id}`, clock: 'cycle', label: 'cross-score conditioning', when: () => true,
          then: (c, e) => e.set(`scoreB/${id}`, 0.6 * (c.obs('bureau', `A.${id}`).value ?? c.get(`scoreA/${id}`)) + 0.4 * Math.min(1, c.get(`res/${id}`) / 10)) },
        { id: `access.${id}`, clock: 'cycle', label: 'resource access by score', when: (c) => c.get('pool/credit') > 1,
          then: (c, e) => { const amt = 2 * c.get(`scoreB/${id}`); e.consume('pool/credit', amt); e.add(`res/${id}`, amt - 1.2); } },
        { id: `stress.${id}`, clock: 'day', label: 'body effect', when: () => true,
          then: (c, e) => e.set(`body/${id}/stress`, Math.max(0, 1 - c.get(`scoreB/${id}`) - 0.05 * c.get(`res/${id}`) + 0.3)) },
        { id: `surveil.${id}`, clock: 'cycle', label: 'future measurement conditioned on score', enabled: n(p, 'surveillance', 1) > 0,
          when: (c) => c.get(`scoreB/${id}`) < 0.5 && c.get(`watched/${id}`) === 0,
          then: (_c, e) => { e.set(`watched/${id}`, 1); e.apparatus.addChannel('bureau', { id: `close.${id}`, clock: 'cycle', reads: [`beh/${id}`], resolution: 0.05, modality: 'close-surveillance' }); } },
      );
    }
    rules.push({ id: 'pool.refill', clock: 'cycle', when: () => true, then: (_c, e) => e.add('pool/credit', 4) });
    return {
      id: 'institution.score-ecology', seed: n(p, 'seed', 17), horizon: n(p, 'horizon', 150), state, rules,
      addresses: { 'pool/credit': { tags: ['resource'] } },
      clocks: [{ id: 'day', period: 1, label: 'daily' }, { id: 'cycle', period: 5, label: 'scoring cycle' }],
      apparatus: [{ id: 'bureau', label: 'score bureau', channels }],
      probes: [{ id: 'someone-watched', test: (c) => c.addresses('watched/').some((a) => c.get(a) === 1), monotone: true },
        { id: 'p0-low', test: (c) => c.get('scoreB/p0') < 0.4 }],
      reach: { every: 25, horizon: 25 },
    };
  },
};

export const INSTITUTION_PRESETS = [lawPenetration, scoreEcology];
