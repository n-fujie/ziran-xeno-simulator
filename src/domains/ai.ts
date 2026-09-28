// AI / LLM operational separation (XXIV).
// real-world difference → input encoding → label implementation → objective/loss → credit assignment
// (gradient) → parameter update → activation → output → institutional effect → new training data.
// Each stage is a separate rule on its own phase-shifted clock, so every transition is a distinct,
// traceable ignition. A loss is a condition that converts differences into update directions — it is
// not a representation of a concept. The preset makes that visible: loss can fall while the parameters
// track an annotation artifact instead of the world difference.
import type { Preset } from '../core/experiment.ts';
import type { WorldSpec, RuleSpec } from '../core/types.ts';
import type { Trace } from '../core/trace.ts';
import { sc } from '../core/values.ts';

const n = (p: Record<string, unknown>, k: string, d: number) => (typeof p[k] === 'number' ? (p[k] as number) : d);
const b = (p: Record<string, unknown>, k: string, d: boolean) => (typeof p[k] === 'boolean' ? (p[k] as boolean) : d);
const sig = (x: number) => 1 / (1 + Math.exp(-x));

export const STAGES = ['world', 'encode', 'label', 'forward', 'loss', 'credit', 'update', 'decide', 'data'] as const;

export const aiPipeline: Preset = {
  id: 'ai.pipeline', title: 'AI operational separation (shortcut learning)', area: 'ai', layer: 12,
  summary: 'Items carry a hidden world difference z. Encodings contain a weak causal cue and an annotation artifact. Labels are implemented by an annotator who (optionally) follows the artifact. Loss falls, parameters move, outputs change institutional decisions, and only approved items return as new training data. After a shift the artifact decorrelates.',
  questions: ['Does falling loss mean the concept is represented?', 'Where does the output penetrate institutions?', 'How does selection feedback reshape later training data?'],
  defaults: { seed: 51, horizon: 300, artifact: true, shiftAt: 180, lr: 0.3, selection: true },
  build: (p): WorldSpec => {
    const art = b(p, 'artifact', true), shift = n(p, 'shiftAt', 180), lr = n(p, 'lr', 0.3), sel = b(p, 'selection', true);
    const rules: RuleSpec[] = [
      { id: 'world.item', clock: 'w', tags: ['real-world-difference'], when: () => true, then: (c, e) => {
        const z = c.rng() < 0.5 ? 1 : 0;
        e.set('world/z', z); e.set('world/cue', z + 0.9 * (c.rng() * 2 - 1));
        e.set('world/marker', c.t < shift ? (c.rng() < 0.95 ? z : 1 - z) : (c.rng() < 0.5 ? 1 : 0));
      } },
      { id: 'encode', clock: 'enc', tags: ['input-encoding'], when: () => true, then: (c, e) => { e.set('enc/f1', c.get('world/cue')); e.set('enc/f2', c.get('world/marker')); } },
      { id: 'label.implement', clock: 'lab', tags: ['concept-to-label'], when: (c) => !sel || c.get('data/available') > 0, then: (c, e) => {
        const lab = art ? c.get('world/marker') : c.rng() < 0.9 ? c.get('world/z') : 1 - c.get('world/z');
        e.set('obj/label', lab); e.set('obj/hasLabel', 1);
      } },
      { id: 'forward', clock: 'fwd', tags: ['activation', 'output-distribution'], when: () => true, then: (c, e) => {
        const h = c.get('param/w1') * c.get('enc/f1') + c.get('param/w2') * c.get('enc/f2') + c.get('param/b');
        e.set('act/h', h); e.set('out/p', sig(h));
      } },
      { id: 'objective.loss', clock: 'los', tags: ['label-to-objective'], when: (c) => c.get('obj/hasLabel') === 1, then: (c, e) => {
        const pp = Math.min(1 - 1e-6, Math.max(1e-6, c.get('out/p'))), y = c.get('obj/label');
        e.set('obj/loss', 0.97 * c.get('obj/loss') + 0.03 * -(y * Math.log(pp) + (1 - y) * Math.log(1 - pp)));
        e.set('obj/residual', pp - y);
      } },
      { id: 'credit.assign', clock: 'crd', tags: ['objective-to-gradient'], when: (c) => c.get('obj/hasLabel') === 1, then: (c, e) => {
        const r = c.get('obj/residual'); e.set('grad/w1', r * c.get('enc/f1')); e.set('grad/w2', r * c.get('enc/f2')); e.set('grad/b', r);
      } },
      { id: 'param.update', clock: 'upd', tags: ['gradient-to-parameter'], when: (c) => c.get('obj/hasLabel') === 1, then: (c, e) => {
        for (const k of ['w1', 'w2', 'b']) e.add(`param/${k}`, -lr * c.get(`grad/${k}`));
        e.set('obj/hasLabel', 0);
      } },
      { id: 'institution.decide', clock: 'dec', tags: ['output-to-institutional-effect'], when: () => true, then: (c, e) => {
        const ok = c.get('out/p') > 0.5;
        e.set('inst/approve', ok ? 1 : 0);
        if (ok) { e.consume('inst/budget', 1); e.add(c.get('world/z') === 1 ? 'outcome/good' : 'outcome/bad', 1); }
      } },
      { id: 'data.collect', clock: 'dat', tags: ['effect-to-training-data'], when: () => true, then: (c, e) => e.set('data/available', c.get('inst/approve') > 0 ? 1 : c.rng() < 0.1 ? 1 : 0) },
      { id: 'budget.refill', clock: 'w', when: () => true, then: (_c, e) => e.add('inst/budget', 0.6) },
      { id: 'metric.alignment', clock: 'dat', tags: ['analysis'], when: () => true, then: (c, e) => {
        const w1 = c.get('param/w1'), w2 = c.get('param/w2'); e.set('metric/alignment', Math.abs(w1) / (Math.abs(w1) + Math.abs(w2) + 1e-9));
      } },
    ];
    const phases = ['w', 'enc', 'lab', 'fwd', 'los', 'crd', 'upd', 'dec', 'dat'];
    return {
      id: 'ai.pipeline', seed: n(p, 'seed', 51), horizon: n(p, 'horizon', 300),
      config: [{ key: 'annotation', value: art ? 'artifact-following' : 'concept-following', status: 'specified' }, { key: 'distribution-shift', value: shift, status: 'specified' }],
      state: {
        'world/z': 0, 'world/cue': 0, 'world/marker': 0, 'enc/f1': 0, 'enc/f2': 0, 'obj/label': 0, 'obj/hasLabel': 0, 'obj/loss': 0.7, 'obj/residual': 0,
        'grad/w1': 0, 'grad/w2': 0, 'grad/b': 0, 'param/w1': 0, 'param/w2': 0, 'param/b': 0, 'act/h': 0, 'out/p': 0.5, 'inst/approve': 0, 'inst/budget': 20,
        'outcome/good': 0, 'outcome/bad': 0, 'data/available': 1, 'metric/alignment': 0,
      },
      addresses: {
        'world/z': { medium: 'world', scale: 'item' }, 'enc/f1': { medium: 'encoding' }, 'enc/f2': { medium: 'encoding' }, 'obj/label': { medium: 'annotation' },
        'obj/loss': { medium: 'objective' }, 'grad/w1': { medium: 'gradient' }, 'param/w1': { medium: 'parameters' }, 'param/w2': { medium: 'parameters' },
        'out/p': { medium: 'output' }, 'inst/approve': { medium: 'institution' }, 'data/available': { medium: 'dataset' }, 'inst/budget': { tags: ['resource'] },
      },
      clocks: phases.map((id, i) => ({ id, period: 1, phase: i / 10, label: i === 0 ? 'world' : 'machine stage' })),
      rules,
      apparatus: [{ id: 'ops', label: 'operator dashboard (loss only)', channels: [{ id: 'loss', clock: 'dat', reads: ['obj/loss'], resolution: 0.01 }] }],
      probes: [{ id: 'harm-spike', test: (c) => c.get('outcome/bad') > c.get('outcome/good') * 0.5 + 10, monotone: true }],
    };
  },
};

/** Loss and concept alignment, before and after the shift, plus the stage sequence found in the trace. */
export function separationReport(tr: Trace, shiftAt = 180) {
  const at = (addr: string, t: number): number => { let v = sc(tr.initial.state[addr]); for (const e of tr.events) { if (e.t > t) break; if (e.kind === 'effect' && e.address === addr) v = e.after; } return v; };
  const tags = Object.fromEntries(tr.initial.rules.map((r) => [r.id, r.tags?.[0] ?? '']));
  const stageEvents: Record<string, number> = {};
  for (const e of tr.events) if (e.kind === 'ignition') stageEvents[tags[e.rule] || e.rule] = (stageEvents[tags[e.rule] || e.rule] ?? 0) + 1;
  const outcome = (t0: number, t1: number) => {
    let g = 0, bd = 0; for (const e of tr.events) if (e.kind === 'effect' && e.t >= t0 && e.t < t1) { if (e.address === 'outcome/good') g++; if (e.address === 'outcome/bad') bd++; }
    return { good: g, bad: bd, precision: g + bd ? g / (g + bd) : null };
  };
  return {
    lossEarly: at('obj/loss', 20), lossBeforeShift: at('obj/loss', shiftAt - 1), lossEnd: at('obj/loss', tr.meta.horizon),
    alignmentBeforeShift: at('metric/alignment', shiftAt - 1), w1: at('param/w1', shiftAt - 1), w2: at('param/w2', shiftAt - 1),
    outcomesBeforeShift: outcome(0, shiftAt), outcomesAfterShift: outcome(shiftAt, tr.meta.horizon),
    stages: stageEvents,
    lossFellButConceptNotTracked: at('obj/loss', shiftAt - 1) < at('obj/loss', 20) && at('metric/alignment', shiftAt - 1) < 0.5,
  };
}

export const AI_PRESETS = [aiPipeline];
