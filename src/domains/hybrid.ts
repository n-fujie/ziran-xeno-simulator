// Human / AI / hybrid configurations (Layer 12, XXIII).
// "Human" is not assumed to be a non-redundant unit. A recall-and-act task is carried by body, nervous
// memory, phone memory, an AI drafter, and an institutional approval step in different combinations.
// The test: where does intervening on the human-addressed part change outcomes (interventionally
// necessary), and where is it redundant?
import type { Preset } from '../core/experiment.ts';
import type { WorldSpec, RuleSpec } from '../core/types.ts';
import { nonRedundancy } from '../core/counterfactual.ts';
import { sc } from '../core/values.ts';

const n = (p: Record<string, unknown>, k: string, d: number) => (typeof p[k] === 'number' ? (p[k] as number) : d);

export const HYBRID_CONFIGS = ['body+nervous', 'with-phone', 'with-phone-ai', 'ai-direct', 'institutional-hybrid'] as const;
export type HybridConfig = (typeof HYBRID_CONFIGS)[number];

export const distributedTask: Preset = {
  id: 'hybrid.distributed-task', title: 'Human / machine / hybrid recall-and-act', area: 'human-ai', layer: 12,
  summary: 'Information appears, must be held, and must be acted on by a deadline. Nervous memory decays; phone memory persists but needs retrieval; an AI can draft from the phone; an institution can require approval on a slow cycle.',
  defaults: { seed: 61, horizon: 160, config: 'with-phone-ai', due: 12, approvalPeriod: 9 },
  options: { config: HYBRID_CONFIGS },
  build: (p): WorldSpec => {
    const cfg = String(p.config ?? 'with-phone-ai') as HybridConfig, due = n(p, 'due', 12);
    const phone = cfg !== 'body+nervous', ai = cfg === 'with-phone-ai' || cfg === 'ai-direct' || cfg === 'institutional-hybrid';
    const body = cfg !== 'ai-direct', inst = cfg === 'institutional-hybrid';
    const cues = [10, 40, 70, 100, 130];
    const rules: RuleSpec[] = [
      { id: 'world.cue', clock: 'tick', when: (c) => cues.includes(c.t), then: (c, e) => { const v = 1 + Math.floor(c.rng() * 5); e.set('world/info', v); e.set('task/target', v); e.set('task/due', c.t + due); e.set('task/open', 1); } },
      { id: 'human.nervous.store', clock: 'tick', tags: ['human'], when: (c) => c.get('world/info') > 0 && c.get('human/nervous/mem') !== c.get('world/info') && c.get('task/open') === 1 && c.get('human/nervous/fresh') === 0,
        then: (c, e) => { e.set('human/nervous/mem', c.get('world/info')); e.set('human/nervous/fresh', 1); } },
      { id: 'human.nervous.drift', clock: 'tick', tags: ['human'], when: (c) => c.get('human/nervous/mem') > 0, then: (c, e) => e.add('human/nervous/mem', 0.3 * (c.rng() * 2 - 1)) },
      { id: 'task.close', clock: 'tick', when: (c) => c.get('task/open') === 1 && c.t >= c.get('task/due'), then: (c, e) => {
        const ok = Math.round(c.get('act/value')) === c.get('task/target');
        e.add(ok ? 'task/success' : 'task/fail', 1); e.set('task/open', 0); e.set('act/value', 0); e.set('human/nervous/fresh', 0); e.set('world/info', 0);
      } },
    ];
    if (phone) rules.push(
      { id: 'phone.store', clock: 'tick', tags: ['phone'], delay: 1, when: (c) => c.get('world/info') > 0 && c.get('phone/mem') !== c.get('world/info'), then: (c, e) => e.set('phone/mem', c.get('world/info')) },
    );
    if (ai) rules.push({ id: 'ai.draft', clock: 'tick', tags: ['ai'], delay: 0.5, when: (c) => c.get('task/open') === 1 && c.get('ai/draft') !== c.get('phone/mem'), then: (c, e) => e.set('ai/draft', c.get('phone/mem')) });
    if (inst) rules.push({ id: 'inst.approve', clock: 'office', tags: ['institution'], when: (c) => c.get('task/open') === 1 && c.get('ai/draft') > 0, then: (_c, e) => e.set('inst/approved', 1) });
    if (body) rules.push({ id: 'human.body.act', clock: 'tick', tags: ['human'], label: 'act near the deadline',
      when: (c) => c.get('task/open') === 1 && c.t >= c.get('task/due') - 2 && c.get('act/value') === 0 && (!inst || c.get('inst/approved') === 1),
      then: (c, e) => {
        const src = ai ? c.get('ai/draft') : phone ? c.get('phone/mem') : c.get('human/nervous/mem');
        e.set('act/value', src || c.get('human/nervous/mem')); if (inst) e.set('inst/approved', 0);
      } });
    else rules.push({ id: 'ai.actuate', clock: 'tick', tags: ['ai'], when: (c) => c.get('task/open') === 1 && c.t >= c.get('task/due') - 2 && c.get('act/value') === 0, then: (c, e) => e.set('act/value', c.get('ai/draft')) });
    return {
      id: 'hybrid.distributed-task', seed: n(p, 'seed', 61), horizon: n(p, 'horizon', 160),
      config: [{ key: 'configuration', value: cfg, status: 'specified' }, { key: 'human-boundary', status: 'unknown' }],
      state: { 'world/info': 0, 'task/target': 0, 'task/due': -1, 'task/open': 0, 'task/success': 0, 'task/fail': 0, 'act/value': 0, 'human/nervous/mem': 0, 'human/nervous/fresh': 0, 'phone/mem': 0, 'ai/draft': 0, 'inst/approved': 0 },
      addresses: { 'human/nervous/mem': { medium: 'neural' }, 'phone/mem': { medium: 'digital' }, 'ai/draft': { medium: 'model' }, 'inst/approved': { medium: 'procedure' }, 'act/value': { medium: 'body' } },
      rules, clocks: [{ id: 'tick', period: 1 }, { id: 'office', period: n(p, 'approvalPeriod', 9), phase: 4, label: 'institutional' }],
      probes: [{ id: 'any-failure', test: (c) => c.get('task/fail') > 0, monotone: true }],
    };
  },
};

/** Is the human-addressed part interventionally necessary in this configuration? */
export function humanNecessity(cfg: HybridConfig, seeds = [61, 62, 63, 64]) {
  const base = distributedTask.build({ ...distributedTask.defaults, config: cfg });
  const wipe = [10, 40, 70, 100, 130].map((t, i) => ({ type: 'reorganization-trigger' as const, at: t + 3, label: `human intervention ${i}`, apply: (_c: any, e: any) => { e.set('human/nervous/mem', 0); e.rule.disable('human.body.act'); } }));
  const restore = [10, 40, 70, 100, 130].map((t) => ({ type: 'reorganization-trigger' as const, at: t + 11.5, apply: (_c: any, e: any) => e.rule.enable('human.body.act') }));
  const r = nonRedundancy({ subject: `human address in ${cfg}`, base, variant: [...wipe, ...restore], seeds, tolerance: 0.5,
    metric: (e) => ({ success: sc(e.state['task/success']), fail: sc(e.state['task/fail']) }) });
  return { config: cfg, humanInterventionallyNecessary: !r.redundant, perMetric: r.perMetric };
}

export const HYBRID_PRESETS = [distributedTask];
