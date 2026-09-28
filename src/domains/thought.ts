// Xenothinking, historical reconstruction, remnant configurations and media re-ignition
// (Layer 11, XXI, XXII, XXVIII, XXXIII, XVI).
//
// A thought is not owned by a person. Commitments are intensities at addresses inside address
// domains; they are inscribed into media, survive the death of the domain that produced them, and may
// re-ignite — transformed, split or lost — wherever a later configuration can read the medium.
// Historical thinkers are test configurations — "historically constrained operational reconstructions" —
// never person simulations. Every reconstruction separates source evidence, historical configuration,
// reconstruction model, inference assumptions, uncertainty and newly generated simulated behaviour, and the
// simulator cannot convert generated behaviour into a historical factual claim.
import type { Preset } from '../core/experiment.ts';
import type { WorldSpec, RuleSpec, CouplingSpec, ChannelSpec, Ctx } from '../core/types.ts';
import type { Vocabulary } from '../analysis/vocabulary.ts';

const n = (p: Record<string, unknown>, k: string, d: number) => (typeof p[k] === 'number' ? (p[k] as number) : d);

// ---------------------------------------------------------------- reconstruction records

export interface SourceEvidence { citation: string; claim: string; confidence: 'high' | 'medium' | 'low' }

export interface Reconstruction {
  id: string;
  /** A label for a body of texts, not a person being simulated. */
  thinker: string;
  sources: SourceEvidence[];
  historicalConfiguration: string[];
  model: string[];
  inferenceRules: string[];
  uncertainty: { level: 'high' | 'medium' | 'low'; notes: string[] };
  /** Operational patterns the model makes available (rule ids in the simulator). */
  patterns: Record<string, string>;
}

export const RECONSTRUCTIONS: Record<string, Reconstruction> = {
  aristotle: {
    id: 'R-aristotle-oikonomia-v1', thinker: 'Aristotle (Politics I; Nicomachean Ethics V)',
    sources: [
      { citation: 'Politics I.8–10 (1256a–1258b)', claim: 'Distinguishes acquisition bounded by the needs of the household from money-making without limit (chrematistics).', confidence: 'high' },
      { citation: 'Nicomachean Ethics V.5 (1133a)', claim: 'Need (chreia) holds exchange together; money serves as a conventional measure that makes goods commensurable.', confidence: 'high' },
      { citation: 'Politics I.11 (1259a)', claim: 'Thales anecdote: foreseeing a large olive harvest, he secured the presses in advance and let them out at his own price.', confidence: 'high' },
    ],
    historicalConfiguration: ['household (oikos) economy', 'polis', 'seasonal agrarian production', 'coinage', 'no continuous electronic market'],
    model: [
      'acquisition stops once a sufficiency level is reached (bounded goal)',
      'exchange judged against a slow, need-based measure rather than the momentary price',
      'foresight of a natural (seasonal) cycle can be used once to secure capacity ahead of demand',
    ],
    inferenceRules: [
      'sufficiency level := initial holdings × (1 + modest margin) — a modelling choice, not in the text',
      'need-based measure := long-window average of observed price — a modelling choice',
      'seasonal foresight := observation channel on the seasonal driver, not on price',
    ],
    uncertainty: { level: 'high', notes: ['The texts do not describe trading on a continuous market.', 'Thresholds and windows are reconstruction parameters, not textual claims.', 'Translating chreia into a price average is contestable.'] },
    patterns: { 'arist.thales': 'seasonal capacity acquisition', 'arist.release': 'letting out capacity at the peak', 'arist.measure': 'exchange against need-measure', 'arist.sufficiency': 'bounded acquisition (goal transformation)' },
  },
  spinoza: {
    id: 'R-spinoza-conatus-v1', thinker: 'Spinoza (Ethics III)',
    sources: [{ citation: 'Ethics III, P6–P7', claim: 'Each thing, as far as it can by its own power, strives to persevere in its being; this striving is its actual essence.', confidence: 'high' }],
    historicalConfiguration: ['17th-century Dutch Republic', 'geometric-method treatise', 'manuscript circulation, posthumous print (1677)'],
    model: ['a commitment configuration maintains its own intensity against decay in proportion to its current intensity'],
    inferenceRules: ['self-maintenance gain := parameter; persistence is modelled as rule, not as substance'],
    uncertainty: { level: 'medium', notes: ['Operationalizing conatus as intensity maintenance is one of many readings.'] },
    patterns: { 'persevere': 'self-maintenance of intensity' },
  },
  wittgenstein: {
    id: 'R-wittgenstein-practice-v1', thinker: 'Wittgenstein (Philosophical Investigations)',
    sources: [{ citation: 'Philosophical Investigations §§199–202', claim: 'Following a rule is a practice; one cannot follow a rule "privately".', confidence: 'high' }],
    historicalConfiguration: ['Cambridge lectures', 'typescripts', 'posthumous publication (1953)'],
    model: ['a commitment stays operative only where a coupled community practice sustains it'],
    inferenceRules: ['practice support := coupling from a community-practice address; without it the commitment decays'],
    uncertainty: { level: 'medium', notes: ['Community reading vs. individual reading is contested.'] },
    patterns: { 'practice': 'practice-dependent maintenance' },
  },
  sellarsBrandom: {
    id: 'R-sellars-brandom-reasons-v1', thinker: 'Sellars / Brandom (space of reasons; deontic scorekeeping)',
    sources: [
      { citation: 'Sellars, Empiricism and the Philosophy of Mind (1956), §36', claim: 'Characterizing an episode as knowing places it in the logical space of reasons, of justifying and being able to justify.', confidence: 'high' },
      { citation: 'Brandom, Making It Explicit (1994)', claim: 'Discursive practice as keeping score of commitments and entitlements.', confidence: 'high' },
    ],
    historicalConfiguration: ['analytic philosophy seminar culture', 'journal and book media'],
    model: ['a reason-giving vocabulary classifies states by commitment/entitlement status'],
    inferenceRules: ['vocabulary applies only where scorekeeping addresses are active'],
    uncertainty: { level: 'medium', notes: ['Used only as a vocabulary tested for non-redundancy, not as a model of cognition.'] },
    patterns: {},
  },
};

/** The only form in which the simulator reports a reconstruction's behaviour. */
export function reconstructionStatement(r: Reconstruction, configuration: string, pattern: string, transition: string): string {
  const s = `Under reconstruction ${r.id} and configuration ${configuration}, operational pattern ${pattern} re-ignited and produced transition ${transition} (reconstruction uncertainty: ${r.uncertainty.level}; simulation-internal, not a historical claim).`;
  assertNoCertainty(s);
  return s;
}

/** Structured form: generated behaviour stays attached to its evidence status and uncertainty. */
export interface ReconstructionClaim {
  statement: string; reconstruction: string; configuration: string; pattern: string; transition: string;
  uncertainty: Reconstruction['uncertainty']; sources: SourceEvidence[]; inferenceAssumptions: string[];
  simulationInternal: true; historicalFactualClaim: false; claimStatus: 'reconstruction inference';
}

export function reconstructionClaim(r: Reconstruction, configuration: string, pattern: string, transition: string): ReconstructionClaim {
  return { statement: reconstructionStatement(r, configuration, pattern, transition), reconstruction: r.id, configuration, pattern, transition,
    uncertainty: r.uncertainty, sources: r.sources, inferenceAssumptions: r.inferenceRules, simulationInternal: true, historicalFactualClaim: false, claimStatus: 'reconstruction inference' };
}

const THINKERS = '(aristotle|spinoza|marx|wittgenstein|sellars|brandom|wolfendale|brassier|negarestani)';
const FORBIDDEN = [/would definitely/i, /\bwould certainly\b/i, new RegExp(`\\bthe real ${THINKERS}\\b`, 'i'),
  new RegExp(`\\b${THINKERS} (thinks|believes|wants|predicts|chooses|decides|would)\\b`, 'i'), new RegExp(`\\bwhat ${THINKERS} would do\\b`, 'i'), new RegExp(`\\b${THINKERS} simulation\\b`, 'i')];
export function assertNoCertainty(text: string): void {
  for (const f of FORBIDDEN) if (f.test(text)) throw new Error('reconstruction claim exceeds evidence: ' + text);
}

// ---------------------------------------------------------------- address-domain re-ignition

const DOMAINS = [
  { id: 'lyceum', from: 0, to: 40, reads: ['manuscript'], writes: 'manuscript', label: 'ancient school' },
  { id: 'commentary', from: 30, to: 120, reads: ['manuscript'], writes: 'manuscript', label: 'commentary tradition' },
  { id: 'academy', from: 110, to: 200, reads: ['manuscript', 'print'], writes: 'print', label: 'print academy' },
  { id: 'machine', from: 190, to: 1e9, reads: ['digital'], writes: 'digital', label: 'machine corpus' },
];
const COMMITMENTS = ['c.telos', 'c.persevere', 'c.practice'];

export const reignition: Preset = {
  id: 'thought.reignition', title: 'Address-domain re-ignition of commitments', area: 'historical-thought', layer: 11,
  summary: 'Commitments arise in one address domain, are inscribed into media, survive the domain’s disappearance, and re-ignite — transformed, split, or lost — in later domains that can read the medium. A fire destroys manuscripts; print and digitization decide what remains re-ignitable.',
  questions: ['Which commitments remain capable of re-ignition after their origin domain disappears?', 'Which become permanently inaccessible?', 'Does machine reactivation preserve the commitment or transform it?'],
  defaults: { seed: 31, horizon: 260, fireAt: 125, printCopy: 1, digitize: 1, split: 1 },
  build: (p): WorldSpec => {
    const state: Record<string, number> = { 'practice/community': 0 };
    const addresses: WorldSpec['addresses'] = {};
    const rules: RuleSpec[] = [];
    const couplings: CouplingSpec[] = [];
    for (const m of ['manuscript', 'print', 'digital']) for (const c of COMMITMENTS) { state[`archive/${m}/${c}`] = 0; addresses[`archive/${m}/${c}`] = { medium: m, scale: 'external-memory' }; }
    // origin: commitments ignite in the lyceum
    state['domain/lyceum/active/c.telos'] = 1; state['domain/lyceum/active/c.practice'] = 0.6;
    state['domain/commentary/active/c.persevere'] = 0;
    for (const d of DOMAINS) {
      state[`domain/${d.id}/alive`] = 0;
      for (const c of COMMITMENTS) { const a = `domain/${d.id}/active/${c}`; state[a] ??= 0; addresses[a] = { medium: 'practice', scale: 'address-domain' }; }
      rules.push(
        { id: `${d.id}.appear`, clock: 'era', tii: true, when: (c) => c.t >= d.from && c.t < d.to && c.get(`domain/${d.id}/alive`) === 0, then: (_c, e) => { e.set(`domain/${d.id}/alive`, 1); e.note('address-domain.appeared', { domain: d.id }); } },
        { id: `${d.id}.vanish`, clock: 'era', tii: true, when: (c) => c.t >= d.to && c.get(`domain/${d.id}/alive`) === 1, then: (_c, e) => { e.address.remove(`domain/${d.id}/`); e.note('address-domain.lost', { domain: d.id }); } },
        { id: `${d.id}.practice`, clock: 'era', label: 'maintain + inscribe', when: (c) => c.get(`domain/${d.id}/alive`) === 1, then: (c, e) => {
          for (const k of COMMITMENTS) {
            const a = `domain/${d.id}/active/${k}`; const v = c.get(a); if (v <= 1e-3) continue;
            const support = k === 'c.practice' ? 0.5 + 0.5 * Math.min(1, c.get('practice/community')) : 1; // practice-dependence (reconstruction)
            e.add(a, -0.02 * v * (2 - support));
            if (k === 'c.persevere') e.add(a, 0.015 * v); // self-maintenance (reconstruction)
            const arch = `archive/${d.writes}/${k}`; if (c.get(arch) < v) e.add(arch, 0.2 * (v - c.get(arch)));
          }
        } },
      );
      for (const m of d.reads) for (const k of COMMITMENTS) rules.push({
        id: `${d.id}.reignite.${m}.${k}`, clock: 'era', tii: true, label: `re-ignition from ${m}`,
        when: (c) => c.get(`domain/${d.id}/alive`) === 1 && c.get(`archive/${m}/${k}`) > 0.3 && c.get(`domain/${d.id}/active/${k}`) < 0.05,
        then: (c, e) => {
          const src = c.get(`archive/${m}/${k}`);
          const fidelity = d.id === 'machine' ? 0.7 : m === 'print' ? 0.9 : 0.8; // commitment transformation on re-ignition
          e.set(`domain/${d.id}/active/${k}`, fidelity * src);
          e.note('re-ignition', { domain: d.id, commitment: k, medium: m, fidelity });
          if (k === 'c.telos' && d.id === 'commentary' && n(p, 'split', 1) > 0) { // commitment splitting
            e.set(`domain/${d.id}/active/c.persevere`, 0.5 * fidelity * src); e.note('commitment.split', { from: k, into: ['c.telos', 'c.persevere'] });
          }
        },
      });
    }
    for (const k of COMMITMENTS) state[`seen/${k}`] = 0;
    rules.push(
      { id: 'mark.existed', clock: 'era', label: 'bookkeeping: commitment has existed', when: (c) => COMMITMENTS.some((k) => c.get(`seen/${k}`) === 0 && c.addresses('domain/').some((a) => a.endsWith('/active/' + k) && c.get(a) > 0.05)),
        then: (c, e) => { for (const k of COMMITMENTS) if (c.get(`seen/${k}`) === 0 && c.addresses('domain/').some((a) => a.endsWith('/active/' + k) && c.get(a) > 0.05)) e.set(`seen/${k}`, 1); } },
      { id: 'community.practice', clock: 'era', when: (c) => c.addresses('domain/').some((a) => a.endsWith('/alive') && c.get(a) === 1), then: (c, e) => e.set('practice/community', Math.min(1, 0.3 + 0.2 * c.addresses('domain/').filter((a) => a.endsWith('/alive') && c.get(a) === 1).length)) },
      { id: 'fire', clock: 'era', tii: true, analyze: true, when: (c) => c.t === n(p, 'fireAt', 125), then: (_c, e) => { e.address.remove('archive/manuscript/'); e.note('medium.destroyed', { medium: 'manuscript' }); } },
    );
    if (n(p, 'printCopy', 1) > 0) for (const k of COMMITMENTS) couplings.push({ id: `print.${k}`, from: `archive/manuscript/${k}`, to: `archive/print/${k}`, gain: 0.9, delay: 5, medium: 'print', lossThreshold: 0.01 });
    if (n(p, 'digitize', 1) > 0) for (const k of COMMITMENTS) couplings.push({ id: `digitize.${k}`, from: `archive/print/${k}`, to: `archive/digital/${k}`, gain: 0.95, delay: 3, medium: 'digital', lossThreshold: 0.01 });
    const readable = (c: Ctx, k: string) => ['manuscript', 'print', 'digital'].some((m) => c.has(`archive/${m}/${k}`) && c.get(`archive/${m}/${k}`) > 0.3);
    const channels: ChannelSpec[] = ['manuscript', 'print', 'digital'].map((m) => ({ id: m, clock: 'era', reads: [`archive/${m}/*`], aggregate: 'sum' as const, resolution: 0.05 }));
    return {
      id: 'thought.reignition', seed: n(p, 'seed', 31), horizon: n(p, 'horizon', 260),
      config: [{ key: 'address-domains', value: DOMAINS.map((d) => d.id), status: 'partial' }, { key: 'media', value: ['manuscript', 'print', 'digital'], status: 'specified' }],
      state, addresses, rules, couplings,
      clocks: [{ id: 'era', period: 1, label: 'civilizational (1 tick ≈ a generation)' }],
      apparatus: [{ id: 'archivist', label: 'archive survey', channels }],
      probes: [
        ...COMMITMENTS.map((k) => ({ id: `${k}:re-ignitable`, test: (c: Ctx) => readable(c, k) })),
        ...COMMITMENTS.map((k) => ({ id: `${k}:active`, test: (c: Ctx) => c.addresses('domain/').some((a) => a.endsWith('/active/' + k) && c.get(a) > 0.05) })),
        ...COMMITMENTS.map((k) => ({ id: `${k}:inaccessible`, monotone: true, test: (c: Ctx) => c.get(`seen/${k}`) === 1 && !readable(c, k) && !c.addresses('domain/').some((a) => a.endsWith('/active/' + k) && c.get(a) > 0.05) })),
      ],
      reach: { every: 20, horizon: 40 },
    };
  },
  perturbations: [
    { label: 'no printing (medium removal)', list: [{ type: 'configuration', key: 'media', patch: { value: ['manuscript', 'digital'] } }] },
  ],
};

// ---------------------------------------------------------------- songline / landscape as external memory

export const songline: Preset = {
  id: 'media.songline', title: 'Landscape memory (songline-like traversal)', area: 'media', layer: 11,
  summary: 'Differences are stored in landscape sites and re-ignite in a travelling body only when traversal passes the site. Destroying a site or changing the route closes what can be re-ignited; writing stores the same differences in a portable medium with different failure modes.',
  defaults: { seed: 41, horizon: 120, sites: 6, destroySite: 3, destroyAt: 60, writing: 0 },
  build: (p): WorldSpec => {
    const K = n(p, 'sites', 6);
    const state: Record<string, number> = { 'body/pos': 0, 'body/recall': 0 };
    const rules: RuleSpec[] = [
      { id: 'walk', clock: 'day', when: () => true, then: (c, e) => e.set('body/pos', (c.get('body/pos') + 1) % K) },
      { id: 'recall.decay', clock: 'day', when: (c) => c.get('body/recall') > 0, then: (c, e) => e.add('body/recall', -0.3 * c.get('body/recall')) },
    ];
    for (let i = 0; i < K; i++) {
      state[`land/${i}/mark`] = 1; state[`mem/${i}`] = 0;
      rules.push({ id: `site.${i}.reignite`, clock: 'day', when: (c) => c.get('body/pos') === i && c.has(`land/${i}/mark`) && c.get(`land/${i}/mark`) > 0.5,
        then: (_c, e) => { e.set(`mem/${i}`, 1); e.add('body/recall', 1); } });
      rules.push({ id: `mem.${i}.fade`, clock: 'day', when: (c) => c.get(`mem/${i}`) > 0.01, then: (c, e) => e.add(`mem/${i}`, -0.08 * c.get(`mem/${i}`)) });
      if (n(p, 'writing', 0) > 0) { state[`text/${i}`] = 1; rules.push({ id: `read.${i}`, clock: 'day', when: (c) => c.has(`text/${i}`) && c.get(`mem/${i}`) < 0.2, then: (_c, e) => e.set(`mem/${i}`, 0.6) }); }
    }
    const ds = n(p, 'destroySite', 3);
    return {
      id: 'media.songline', seed: n(p, 'seed', 41), horizon: n(p, 'horizon', 120), state, rules,
      clocks: [{ id: 'day', period: 1, label: 'traversal' }],
      interventions: [{ id: 'destroy-site', t: n(p, 'destroyAt', 60), kind: 'emit', label: 'site destroyed', apply: (_c, e) => e.address.remove(`land/${ds}/`) }],
      apparatus: [{ id: 'walker', channels: [{ id: 'recall', clock: 'day', reads: ['body/recall'], resolution: 0.1 }] }],
      probes: Array.from({ length: K }, (_, i) => ({ id: `site${i}-reachable`, test: (c: Ctx) => c.get(`mem/${i}`) > 0.3 })),
      reach: { every: 20, horizon: 12 },
    };
  },
};

// ---------------------------------------------------------------- reason-giving vocabulary (Sellars / Brandom)

/** Applies only where a scorekeeping practice is alive (a domain whose practice address is active). */
export const reasonVocabulary: Vocabulary = {
  id: 'space-of-reasons', label: 'commitment/entitlement status', source: RECONSTRUCTIONS.sellarsBrandom.id,
  applies: (s) => (s['practice/community'] ?? 0) > 0.45,
  classify: (s) => {
    const committed = Object.keys(s).filter((a) => a.includes('/active/') && s[a] > 0.3).length;
    const entitled = Object.keys(s).filter((a) => a.startsWith('archive/') && s[a] > 0.3).length;
    return `${committed > 1 ? 'C' : 'c'}${entitled > 2 ? 'E' : 'e'}`;
  },
};

export const mediumVocabulary: Vocabulary = {
  id: 'surviving-media', label: 'which media still hold inscriptions',
  classify: (s) => ['manuscript', 'print', 'digital'].map((m) => (Object.keys(s).some((a) => a.startsWith(`archive/${m}/`) && s[a] > 0.3) ? m[0] : '-')).join(''),
};

export const THOUGHT_PRESETS = [reignition, songline];
