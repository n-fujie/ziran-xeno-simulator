// Markets without rational agents, stable preferences or fixed boundaries (Layer 10, XXXII, XLIV).
//
// The market is a clearing rule over order flow, a depletable liquidity, and a hidden fundamental with
// regime switches and a seasonal driver. Participants are *configurations*: an apparatus (what can be
// detected), rules (what ignites), resources (cash/position/attention) and a clock (timescale).
// The comparison is about detection, ignition, timing, reachability, closure, feedback, observation
// change, goal transformation, fragility movement and market penetration — not only profit.
import type { Preset } from '../core/experiment.ts';
import type { WorldSpec, RuleSpec, Ctx, Emit, ApparatusSpec, ProbeSpec } from '../core/types.ts';
import { addBundle, type Bundle } from '../core/perturbations.ts';
import type { Trace } from '../core/trace.ts';
import { penetration } from '../core/penetration.ts';
import { runSpec, nonRedundancy } from '../core/counterfactual.ts';
import { fragilityTransfer, type Region } from '../analysis/fragility.ts';
import { RECONSTRUCTIONS, reconstructionStatement } from './thought.ts';
import { sc } from '../core/values.ts';
import { canonical } from '../core/hash.ts';

export const PARTICIPANTS = ['aristotle', 'human', 'rule', 'adaptive', 'hybrid'] as const;
export type Participant = (typeof PARTICIPANTS)[number] | 'generic-flow' | 'role-bundles';
const PREFIX: Record<string, string> = { aristotle: 'arist', human: 'human', rule: 'rule', adaptive: 'ai', hybrid: 'hyb', 'generic-flow': 'flow', 'role-bundles': 'role' };
/** Display labels: the reconstruction is shown as a reconstruction, never as the historical person. */
export const DISPLAY: Record<string, string> = { aristotle: 'R-aristotle-oikonomia-v1 (historically constrained operational reconstruction)', human: 'contemporary human trading configuration', rule: 'rule-based system', adaptive: 'adaptive AI configuration', hybrid: 'human–AI hybrid configuration', 'generic-flow': 'matched aggregate flow', 'role-bundles': 'operational bundle descriptions (no trader units)' };
const CASH0 = 1000;

const wealth = (c: Ctx, P: string) => c.get(`${P}/cash`) + c.get(`${P}/pos`) * c.get('mkt/price');

function trade(c: Ctx, e: Emit, P: string, q: number): void {
  const px = c.get('mkt/price');
  if (q > 0) { e.consume(`${P}/cash`, q * px); e.add(`${P}/pos`, q); }
  else if (q < 0) { e.consume(`${P}/pos`, -q); e.add(`${P}/cash`, -q * px); }
  e.add('mkt/flow', q);
  e.add(`${P}/trades`, 1);
}

function marketBase(p: Record<string, unknown>): WorldSpec {
  const sw = Number(p.regimeSwitch ?? 0.015);
  return {
    id: 'market.synthetic', title: 'Synthetic market', seed: Number(p.seed ?? 44), horizon: Number(p.horizon ?? 400),
    config: [{ key: 'market-boundary', value: 'single venue', status: 'partial' }, { key: 'participants', value: [], status: 'specified' }, { key: 'asset', value: 'unspecified', status: 'unknown' }],
    state: { 'mkt/price': 100, 'mkt/fundamental': 100, 'mkt/regime': 1, 'mkt/flow': 0, 'mkt/liquidity': 100, 'mkt/news': 100, 'env/season': 0, 'mkt/lastFlow': 0 },
    addresses: {
      'mkt/fundamental': { medium: 'economic', scale: 'hidden' }, 'mkt/regime': { medium: 'economic', scale: 'hidden' }, 'mkt/price': { medium: 'market', scale: 'market' },
      'mkt/liquidity': { medium: 'market', scale: 'market', tags: ['resource'] }, 'mkt/news': { medium: 'media', scale: 'public' }, 'env/season': { medium: 'ecological', scale: 'seasonal' },
    },
    clocks: [
      { id: 'season', period: 1, label: 'ecological' }, { id: 'fast', period: 1, phase: 0.2, label: 'machine' },
      { id: 'human', period: 5, phase: 0.3, label: 'human' }, { id: 'mkt', period: 1, phase: 0.5, label: 'market clearing' },
    ],
    rules: [
      { id: 'world.season', clock: 'season', when: () => true, then: (c, e) => e.set('env/season', Math.sin((2 * Math.PI * c.t) / 80)) },
      { id: 'world.regime', clock: 'season', tii: true, analyze: true, when: () => sw, then: (c, e) => e.set('mkt/regime', -c.get('mkt/regime')) },
      { id: 'world.fundamental', clock: 'season', when: () => true, then: (c, e) => {
        const ds = Math.sin((2 * Math.PI * c.t) / 80) - c.get('env/season');
        e.add('mkt/fundamental', 0.12 * c.get('mkt/regime') + 6 * ds + 0.3 * (c.rng() * 2 - 1));
      } },
      { id: 'mkt.clear', clock: 'mkt', label: 'clearing', when: () => true, then: (c, e) => {
        const f = c.get('mkt/flow'), L = Math.max(5, c.get('mkt/liquidity'));
        e.add('mkt/price', (1.2 * f) / (L / 100) + 0.08 * (c.get('mkt/fundamental') - c.get('mkt/price')) + 0.25 * (c.rng() * 2 - 1));
        e.add('mkt/liquidity', -0.8 * Math.abs(f) + 0.06 * (100 - L));
        e.set('mkt/lastFlow', f); e.set('mkt/flow', 0);
      } },
    ],
    couplings: [{ id: 'news', from: 'mkt/fundamental', to: 'mkt/news', gain: 1, delay: 3, medium: 'media' }],
    // A neutral market-level observer (not attached to any participant) for observational comparisons.
    apparatus: [{ id: 'market-observer', label: 'neutral market observer', aliasing: false, channels: [
      { id: 'price', clock: 'mkt', reads: ['mkt/price'], resolution: 1 }, { id: 'liquidity', clock: 'mkt', reads: ['mkt/liquidity'], resolution: 5 },
    ] }],
    interventions: p.liquidityShockAt ? [{ id: 'liquidity-shock', t: Number(p.liquidityShockAt) + 0.4, kind: 'set', address: 'mkt/liquidity', value: 40 }] : [],
    probes: [
      { id: 'crash', test: (c) => c.get('mkt/price') < 80, monotone: true },
      { id: 'liquidity-crisis', test: (c) => c.get('mkt/liquidity') < 30 },
    ],
    reach: { every: 50, horizon: 30 },
  };
}

function account(P: string, extra: Record<string, number> = {}): Record<string, number> {
  return { [`${P}/cash`]: CASH0, [`${P}/pos`]: 0, [`${P}/trades`]: 0, ...extra };
}
function ruinProbe(P: string): ProbeSpec { return { id: `${P}:ruin`, test: (c) => wealth(c, P) < 0.8 * CASH0, monotone: true }; }

// ---------------------------------------------------------------- historically constrained operational reconstruction (R-aristotle-oikonomia-v1)

function aristotle(): Bundle {
  const P = 'arist', W = 1.06 * CASH0;
  const app: ApparatusSpec = { id: 'arist.eye', label: 'nature + slow need-measure', aliasing: false, channels: [
    { id: 'season', clock: 'human', reads: ['env/season'], resolution: 0.05, modality: 'observation of nature' },
    { id: 'measure', clock: 'human', reads: ['mkt/price'], window: 30, resolution: 0.5, modality: 'need-measure (slow average)' },
    { id: 'price', clock: 'human', reads: ['mkt/price'], resolution: 0.5 },
  ] };
  const o = (c: Ctx, ch: string) => c.obs('arist.eye', ch).value;
  const rules: RuleSpec[] = [
    { id: 'arist.thales', clock: 'human', tags: ['aristotle'], tii: true, label: RECONSTRUCTIONS.aristotle.patterns['arist.thales'],
      when: (c) => { const s = o(c, 'season'); return s !== null && s > 0.2 && s < 0.7 && c.get(`${P}/prevSeason`) < s && c.get(`${P}/pos`) === 0 && c.get(`${P}/thalesDone`) === 0; },
      then: (c, e) => { trade(c, e, P, 4); e.set(`${P}/thalesDone`, 1); e.note('pattern', { reconstruction: RECONSTRUCTIONS.aristotle.id, pattern: 'arist.thales' }); } },
    { id: 'arist.release', clock: 'human', tags: ['aristotle'], label: RECONSTRUCTIONS.aristotle.patterns['arist.release'],
      when: (c) => (o(c, 'season') ?? 0) > 0.9 && c.get(`${P}/pos`) > 0, then: (c, e) => trade(c, e, P, -c.get(`${P}/pos`)) },
    { id: 'arist.measure', clock: 'human', tags: ['aristotle'], label: RECONSTRUCTIONS.aristotle.patterns['arist.measure'],
      when: (c) => { const m = o(c, 'measure'), px = o(c, 'price'); return m !== null && px !== null && Math.abs(px - m) > 4; },
      then: (c, e) => { const d = (o(c, 'price') ?? 0) - (o(c, 'measure') ?? 0); if (d < 0) trade(c, e, P, 1); else if (c.get(`${P}/pos`) >= 1) trade(c, e, P, -1); } },
    { id: 'arist.season-memory', clock: 'human', tags: ['aristotle'], when: () => true, then: (c, e) => e.set(`${P}/prevSeason`, o(c, 'season') ?? 0) },
    { id: 'arist.sufficiency', clock: 'human', tags: ['aristotle'], tii: true, label: RECONSTRUCTIONS.aristotle.patterns['arist.sufficiency'],
      when: (c) => wealth(c, P) >= W && c.ruleEnabled('arist.measure'),
      then: (c, e) => {
        e.rule.disable('arist.measure'); e.rule.disable('arist.thales');
        if (c.get(`${P}/pos`) > 0) trade(c, e, P, -c.get(`${P}/pos`));
        e.note('goal.transformed', { goal: 'acquisition', into: 'maintenance of sufficiency', reconstruction: RECONSTRUCTIONS.aristotle.id });
      } },
  ];
  return { id: 'aristotle', rules, apparatus: [app], state: account(P, { [`${P}/prevSeason`]: 0, [`${P}/thalesDone`]: 0 }), probes: [ruinProbe(P), { id: `${P}:sufficient`, test: (c) => wealth(c, P) >= W, monotone: true }] };
}

// ---------------------------------------------------------------- contemporary human trader

function human(): Bundle {
  const P = 'human';
  const app: ApparatusSpec = { id: 'human.eye', label: 'screen + news, attention-limited', aliasing: false, channels: [
    { id: 'price', clock: 'human', reads: ['mkt/price'], resolution: 0.5 },
    { id: 'news', clock: 'human', reads: ['mkt/news'], window: 5, resolution: 1 },
  ] };
  const o = (c: Ctx, ch: string) => c.obs('human.eye', ch).value;
  const rules: RuleSpec[] = [
    { id: 'human.decide', clock: 'human', delay: 1, tags: ['human'], label: 'momentum + news with loss aversion',
      when: (c) => o(c, 'price') !== null && c.get(`${P}/attention`) >= 1,
      then: (c, e) => {
        e.consume(`${P}/attention`, 1);
        const px = o(c, 'price')!, last = c.get(`${P}/lastPrice`) || px, news = (o(c, 'news') ?? px) - px;
        if (px - last > 1 && news > 0) { trade(c, e, P, 2); e.set(`${P}/entry`, px); }
        else if (px - last < -1 && news < 0 && c.get(`${P}/pos`) >= 2 && (px >= c.get(`${P}/entry`) || news < -4)) trade(c, e, P, -2);
        e.set(`${P}/lastPrice`, px);
      } },
    { id: 'human.rest', clock: 'human', tags: ['human'], when: (c) => c.get(`${P}/attention`) < 3, then: (_c, e) => e.add(`${P}/attention`, 0.6) },
  ];
  return { id: 'human', rules, apparatus: [app], state: account(P, { [`${P}/attention`]: 3, [`${P}/lastPrice`]: 0, [`${P}/entry`]: 0 }), addresses: { [`${P}/attention`]: { tags: ['resource'], medium: 'body' } }, probes: [ruinProbe(P)] };
}

// ---------------------------------------------------------------- rule-based system

function ruleBased(): Bundle {
  const P = 'rule';
  const app: ApparatusSpec = { id: 'rule.feed', label: 'price feed with two moving windows', aliasing: false, channels: [
    { id: 'fast', clock: 'fast', reads: ['mkt/price'], window: 3 }, { id: 'slow', clock: 'fast', reads: ['mkt/price'], window: 12 },
  ] };
  const g = (c: Ctx) => (c.obs('rule.feed', 'fast').value ?? 0) - (c.obs('rule.feed', 'slow').value ?? 0);
  return { id: 'rule', apparatus: [app], state: account(P), probes: [ruinProbe(P)], rules: [
    { id: 'rule.cross', clock: 'fast', tags: ['rule'], label: 'moving-window crossover', when: (c) => (g(c) > 0.3 && c.get(`${P}/pos`) < 5) || (g(c) < -0.3 && c.get(`${P}/pos`) > 0),
      then: (c, e) => trade(c, e, P, g(c) > 0 ? 1 : -1) },
  ] };
}

// ---------------------------------------------------------------- adaptive AI (loss → gradient → parameter → output kept separate)

function aiPipeline(P: string, mode: 'trade' | 'propose'): Bundle {
  const app: ApparatusSpec = { id: `${P}.feed`, label: 'price + news feed', aliasing: false, channels: [
    { id: 'price', clock: 'fast', reads: ['mkt/price'] }, { id: 'news', clock: 'fast', reads: ['mkt/news'], resolution: 0.5 },
  ] };
  const o = (c: Ctx, ch: string) => c.obs(`${P}.feed`, ch).value;
  const lr = 0.02;
  const rules: RuleSpec[] = [
    { id: `${P}.encode`, clock: 'fast', tags: ['ai', 'input-encoding'], when: (c) => o(c, 'price') !== null, then: (c, e) => {
      const px = o(c, 'price')!; e.set(`${P}/x0`, px - (c.get(`${P}/lastPx`) || px)); e.set(`${P}/x1`, ((o(c, 'news') ?? 100) - px) / 10); e.set(`${P}/lastPx`, px);
    } },
    { id: `${P}.output`, clock: 'fast', tags: ['ai', 'output'], when: () => true, then: (c, e) => {
      e.set(`${P}/prevPred`, c.get(`${P}/pred`)); e.set(`${P}/prevX0`, c.get(`${P}/x0`)); e.set(`${P}/prevX1`, c.get(`${P}/x1`));
      e.set(`${P}/pred`, c.get(`${P}/w0`) * c.get(`${P}/x0`) + c.get(`${P}/w1`) * c.get(`${P}/x1`) + c.get(`${P}/w2`));
    } },
    { id: `${P}.loss`, clock: 'fast', tags: ['ai', 'loss'], when: () => true, then: (c, e) => {
      const err = c.get(`${P}/prevPred`) - c.get(`${P}/x0`); e.set(`${P}/err`, err); e.set(`${P}/loss`, 0.95 * c.get(`${P}/loss`) + 0.05 * err * err);
    } },
    { id: `${P}.gradient`, clock: 'fast', tags: ['ai', 'gradient'], when: () => true, then: (c, e) => {
      const err = c.get(`${P}/err`); e.set(`${P}/g0`, 2 * err * c.get(`${P}/prevX0`)); e.set(`${P}/g1`, 2 * err * c.get(`${P}/prevX1`)); e.set(`${P}/g2`, 2 * err);
    } },
    { id: `${P}.update`, clock: 'fast', tags: ['ai', 'parameter-update'], when: () => true, then: (c, e) => {
      for (const k of [0, 1, 2]) e.add(`${P}/w${k}`, -lr * Math.max(-5, Math.min(5, c.get(`${P}/g${k}`))));
    } },
    { id: `${P}.act`, clock: 'fast', tags: ['ai', 'output-to-effect'], when: (c) => Math.abs(c.get(`${P}/pred`)) > 0.35 && c.get(`${P}/loss`) < 1.5,
      then: (c, e) => {
        const q = c.get(`${P}/pred`) > 0 ? 1 : c.get(`${P}/pos`) >= 1 ? -1 : 0;
        if (!q) return;
        if (mode === 'trade') trade(c, e, P, q); else e.set(`${P}/proposal`, q);
      } },
  ];
  const state: Record<string, number> = account(P);
  for (const k of ['x0', 'x1', 'lastPx', 'pred', 'prevPred', 'prevX0', 'prevX1', 'err', 'loss', 'g0', 'g1', 'g2', 'w0', 'w1', 'w2', 'proposal']) state[`${P}/${k}`] = 0;
  return { id: P, rules, apparatus: [app], state, probes: [ruinProbe(P)] };
}

function hybrid(): Bundle {
  const P = 'hyb';
  const b = aiPipeline(P, 'propose');
  b.apparatus!.push({ id: 'hyb.human', label: 'human reviewer screen', aliasing: false, channels: [{ id: 'news', clock: 'human', reads: ['mkt/news'], window: 5, resolution: 1 }, { id: 'price', clock: 'human', reads: ['mkt/price'], resolution: 0.5 }] });
  b.rules!.push({ id: 'hyb.review', clock: 'human', delay: 1, tags: ['hybrid', 'human-gate'], label: 'human approval of AI proposal',
    when: (c) => c.get(`${P}/proposal`) !== 0,
    then: (c, e) => {
      const q = c.get(`${P}/proposal`); const news = (c.obs('hyb.human', 'news').value ?? 0) - (c.obs('hyb.human', 'price').value ?? 0);
      if (Math.sign(news) === Math.sign(q) || Math.abs(news) < 2) trade(c, e, P, 2 * q); else e.note('veto', { proposal: q, news });
      e.set(`${P}/proposal`, 0);
    } });
  b.id = 'hybrid';
  return b;
}

function genericFlow(sigma: number): Bundle {
  return { id: 'generic-flow', state: { 'flow/ar': 0 }, rules: [
    { id: 'flow.ar', clock: 'fast', tags: ['generic-flow'], label: 'matched aggregate order flow', when: () => true,
      then: (c, e) => { const v = 0.5 * c.get('flow/ar') + sigma * (c.rng() * 2 - 1) * Math.sqrt(3); e.set('flow/ar', v); e.add('mkt/flow', v); } },
  ] };
}

export function marketSpec(p: Record<string, unknown>): WorldSpec {
  let spec = marketBase(p);
  const parts = (Array.isArray(p.participants) ? p.participants : PARTICIPANTS) as Participant[];
  for (const x of parts) {
    const b = x === 'aristotle' ? aristotle() : x === 'human' ? human() : x === 'rule' ? ruleBased() : x === 'adaptive' ? aiPipeline('ai', 'trade') : x === 'hybrid' ? hybrid() : x === 'generic-flow' ? genericFlow(Number(p.flowSigma ?? 1)) : x === 'role-bundles' ? roleBundles() : null;
    if (b) spec = addBundle(spec, b);
  }
  spec.config = spec.config!.map((d) => (d.key === 'participants' ? { ...d, value: parts } : d));
  return spec;
}

export const marketPreset: Preset = {
  id: 'market.synthetic', title: 'Synthetic market: five configurations', area: 'markets', layer: 10,
  summary: 'A historically constrained operational reconstruction (R-aristotle-oikonomia-v1), a contemporary human trading configuration, a rule-based system, an adaptive AI configuration and a human–AI hybrid in one synthetic market with hidden regime switches, a seasonal driver, delayed news and depletable liquidity.',
  questions: ['What does each configuration detect, and what stays unavailable to it?', 'Whose interventions penetrate the market, and how?', 'Does "trader" remain a non-redundant category at market level?'],
  defaults: { seed: 44, horizon: 400, participants: [...PARTICIPANTS], regimeSwitch: 0.015 },
  options: { participants: [...PARTICIPANTS, 'generic-flow', 'role-bundles'] },
  build: marketSpec,
};

// ---------------------------------------------------------------- comparison

export function compareParticipants(tr: Trace, parts: string[] = [...PARTICIPANTS]) {
  const ev = tr.events;
  const switches = ev.filter((e) => e.kind === 'effect' && e.address === 'mkt/regime');
  return parts.map((x) => {
    const P = PREFIX[x];
    const apps = (tr.initial.apparatus as ApparatusSpec[]).filter((a) => a.id.startsWith(P + '.'));
    const reads = [...new Set(apps.flatMap((a) => a.channels.flatMap((c) => c.reads)))];
    const detections = ev.filter((e) => e.kind === 'detection' && apps.some((a) => a.id === e.apparatus)).length;
    const unavailable: Record<string, Record<string, number>> = {};
    for (const addr of ['mkt/fundamental', 'mkt/regime', 'env/season', 'mkt/liquidity', 'mkt/news']) {
      const c: Record<string, number> = {};
      for (const e of ev) if (e.kind === 'effect' && e.address === addr) for (const a of apps) { const st = tr.epistemic[a.id]?.[e.seq]; if (st) c[st] = (c[st] ?? 0) + 1; }
      unavailable[addr] = c;
    }
    const ign: Record<string, number> = {};
    for (const e of ev) if (e.kind === 'ignition' && !e.suppressed && e.rule.startsWith(P + '.')) ign[e.rule] = (ign[e.rule] ?? 0) + 1;
    const trades = ev.filter((e) => e.kind === 'effect' && e.address === 'mkt/flow' && String(e.via).startsWith(`rule:${P}.`));
    const lat: number[] = [];
    for (const s of switches) {
      const dir = s.after;
      const hit = trades.find((t) => t.t > s.t && Math.sign(t.delta) === Math.sign(dir));
      if (hit) lat.push(hit.t - s.t);
    }
    const loops = (tr.loops as { originRule: string; key: string; kind: string; count: number }[]).filter((l) => l.originRule.startsWith(P + '.'));
    const marketLoops = loops.filter((l) => l.key.startsWith('o:') || l.key === 'a:mkt/price');
    const blocked = ev.filter((e) => e.kind === 'blocked' && String(e.rule).startsWith(P + '.')).length;
    const notes = ev.filter((e) => e.kind === 'note' && String(e.via).startsWith(`rule:${P}.`)).map((e) => ({ t: e.t, note: e.note, data: e.data }));
    const obsChanges = ev.filter((e) => e.kind === 'reorganization' && e.target === 'apparatus' && apps.some((a) => String(e.key).startsWith(a.id))).length;
    const ruleChanges = ev.filter((e) => e.kind === 'reorganization' && e.target === 'rule' && String(e.key).startsWith(P + '.')).map((e) => ({ t: e.t, key: e.key, op: e.op }));
    const first = trades[0];
    const pen = first ? penetration(tr, first.seq, { maxDepth: 12, maxNodes: 1500 }) : null;
    const W = sc(tr.final.state[`${P}/cash`]) + sc(tr.final.state[`${P}/pos`]) * sc(tr.final.state['mkt/price']);
    const reach = tr.probeRelativeReachability.map((r) => ({ t: r.t, ruin: r.probes[`${P}:ruin`]?.status }));
    const statements = x === 'aristotle'
      ? notes.filter((n) => n.note === 'pattern' || n.note === 'goal.transformed').map((n) => reconstructionStatement(RECONSTRUCTIONS.aristotle, 'C=market.synthetic', String((n.data as any)?.pattern ?? 'arist.sufficiency'), `${n.note}@t=${n.t}`))
      : [];
    return {
      participant: x, display: DISPLAY[x] ?? x, reconstructionUncertainty: x === 'aristotle' ? RECONSTRUCTIONS.aristotle.uncertainty : null, detects: { channels: apps.flatMap((a) => a.channels.map((c) => a.id + '/' + c.id)), reads, detections },
      unavailable, ignitions: ign, trades: trades.length, blocked,
      timing: { regimeSwitches: switches.length, responded: lat.length, meanLatency: lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : null },
      feedback: { loops: loops.length, throughMarket: [...new Set(marketLoops.map((l) => `${l.originRule}→${l.key}`))] },
      observationChanged: obsChanges > 0, goalTransformations: notes.filter((n) => String(n.note).startsWith('goal.')), ruleChanges,
      penetration: pen ? { reached: pen.reached.filter((a) => !a.startsWith(P + '/')).slice(0, 20), media: pen.media, ignitionsTriggered: pen.ignitionsTriggered, otherParticipantsReached: [...new Set(pen.reached.filter((a) => /\/(pos|cash)$/.test(a) && !a.startsWith(P + '/')).map((a) => a.split('/')[0]))] } : null,
      wealth: W, reachability: reach, reconstructionStatements: statements,
    };
  });
}

const flowSigma = (tr: Trace) => {
  const fs = tr.events.filter((e) => e.kind === 'effect' && e.address === 'mkt/lastFlow').map((e) => sc(e.after));
  const m = fs.reduce((a, b) => a + b, 0) / (fs.length || 1);
  return Math.sqrt(fs.reduce((a, b) => a + (b - m) ** 2, 0) / (fs.length || 1));
};

// ---------------------------------------------------------------- lower-level operational descriptions (no trader units)

/**
 * Five order sources described only operationally — no persistent trader units, no per-unit accounts:
 * a feedback-sensitive flow generator, an observation-conditioned order source, a latency-sensitive
 * intervention process, a resource-bounded market actuator (shared budget), and an adaptive execution bundle.
 */
function roleBundles(): Bundle {
  const P = 'role';
  const px = (c: Ctx) => c.get('mkt/price');
  return { id: 'role-bundles', state: { [`${P}/lastPx`]: 100, [`${P}/budget`]: 30, [`${P}/w`]: 0, [`${P}/prev`]: 0 }, addresses: { [`${P}/budget`]: { tags: ['resource'] } }, rules: [
    { id: `${P}.feedback-sensitive`, clock: 'fast', tags: ['feedback-sensitive'], when: (c) => Math.abs(px(c) - c.get(`${P}/lastPx`)) > 0.4,
      then: (c, e) => { e.add('mkt/flow', 0.6 * Math.sign(px(c) - c.get(`${P}/lastPx`))); e.set(`${P}/lastPx`, px(c)); } },
    { id: `${P}.observation-conditioned`, clock: 'human', tags: ['observation-conditioned'], when: (c) => Math.abs(c.get('mkt/news') - px(c)) > 2,
      then: (c, e) => e.add('mkt/flow', 1.2 * Math.sign(c.get('mkt/news') - px(c))) },
    { id: `${P}.latency-sensitive`, clock: 'fast', delay: 3, tags: ['latency-sensitive'], when: (c) => Math.abs(c.get('mkt/lastFlow')) > 1.5,
      then: (c, e) => e.add('mkt/flow', -0.5 * Math.sign(c.get('mkt/lastFlow'))) },
    { id: `${P}.resource-bounded`, clock: 'fast', tags: ['resource-bounded'], when: (c) => c.get(`${P}/budget`) >= 1 && c.get('mkt/fundamental') > px(c) + 1,
      then: (_c, e) => { e.consume(`${P}/budget`, 1); e.add('mkt/flow', 0.8); } },
    { id: `${P}.budget-refill`, clock: 'human', tags: ['resource-bounded'], when: (c) => c.get(`${P}/budget`) < 30, then: (_c, e) => e.add(`${P}/budget`, 2) },
    { id: `${P}.adaptive`, clock: 'fast', tags: ['adaptive'], when: () => true, then: (c, e) => {
      const d = px(c) - c.get(`${P}/prev`); const w = c.get(`${P}/w`);
      e.set(`${P}/w`, 0.98 * w + 0.02 * Math.sign(d)); e.set(`${P}/prev`, px(c));
      if (Math.abs(w) > 0.2) e.add('mkt/flow', 0.5 * Math.sign(w));
    } },
  ] };
}

/** Market-level metrics grouped by non-redundancy axis. */
function axisMetrics(tr: Trace, shockAt: number): Record<string, Record<string, number>> {
  const series = (addr: string) => { const out: [number, number][] = [[0, sc(tr.initial.state[addr])]]; for (const e of tr.events) if (e.kind === 'effect' && e.address === addr) out.push([e.t, sc(e.after)]); return out; };
  const at = (xs: [number, number][], t: number) => { let v = xs[0][1]; for (const [tt, vv] of xs) { if (tt > t) break; v = vv; } return v; };
  const price = series('mkt/price'), fund = series('mkt/fundamental');
  const pv = price.map((x) => x[1]); const m = pv.reduce((a, b) => a + b, 0) / pv.length;
  const H = tr.meta.horizon;
  const mis = Array.from({ length: 20 }, (_, i) => Math.abs(at(price, (i + 1) * H / 21) - at(fund, (i + 1) * H / 21))).reduce((a, b) => a + b, 0) / 20;
  const obsE = tr.summary.epistemic['market-observer'] ?? {};
  return {
    predictive: { priceVariance: pv.reduce((a, b) => a + (b - m) ** 2, 0) / pv.length, meanMispricing: mis },
    interventional: { shockPriceResponse: Math.abs(at(price, shockAt + 20) - at(price, shockAt)), shockLiquidityRecovery: at(series('mkt/liquidity'), shockAt + 20) },
    reachability: { crashFirst: tr.probes['crash']?.first ?? H + 1, liquidityCrisisFirst: tr.probes['liquidity-crisis']?.first ?? H + 1 },
    observational: { observerDetected: obsE['detected'] ?? 0, observerBelowResolution: obsE['below-resolution'] ?? 0 },
    penetration: { flowSources: new Set(tr.events.filter((e) => e.kind === 'effect' && e.address === 'mkt/flow').map((e) => e.via)).size, marketLoops: (tr.loops as any[]).filter((l) => l.key === 'a:mkt/price').length },
  };
}

function axisCompare(A: Record<string, Record<string, number>>[], B: Record<string, Record<string, number>>[], k = 2) {
  const out: Record<string, { differs: boolean; metrics: Record<string, { a: number; b: number; delta: number; spread: number; differs: boolean }> }> = {};
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1)); };
  for (const ax of Object.keys(A[0])) {
    const metrics: Record<string, { a: number; b: number; delta: number; spread: number; differs: boolean }> = {};
    for (const mk of Object.keys(A[0][ax])) {
      const a = A.map((x) => x[ax][mk]), b = B.map((x) => x[ax][mk]);
      const delta = mean(b) - mean(a), spread = Math.max(sd(a), sd(b));
      metrics[mk] = { a: mean(a), b: mean(b), delta, spread, differs: Math.abs(delta) > Math.max(1e-6, k * spread, 0.05 * Math.abs(mean(a))) };
    }
    out[ax] = { differs: Object.values(metrics).some((x) => x.differs), metrics };
  }
  return out;
}

/** Event-level test: does the trader partition add difference beyond the operational-role partition? */
function traderBeyondRoles(tr: Trace, eps = 0.02) {
  const ev = tr.events;
  const ruleFeat: Record<string, Set<string>> = {};
  for (const e of ev) if (e.kind === 'ignition' && !e.suppressed) {
    const f = (ruleFeat[e.rule] ??= new Set());
    const reads = [...(e.reads ?? []), ...(e.opReads ?? [])] as string[];
    if (reads.some((r) => r.includes('news'))) f.add('observation-conditioned');
    if (reads.some((r) => r.startsWith('o:') && r.includes('price')) || reads.includes('a:mkt/price')) f.add('feedback-sensitive');
    const rule = tr.initial.rules.find((r) => r.id === e.rule);
    if ((rule?.delay ?? 0) > 0) f.add('latency-sensitive');
    if (rule?.tags?.some((t) => ['ai', 'gradient', 'parameter-update', 'adaptive'].includes(t))) f.add('adaptive');
  }
  for (const e of ev) if (e.kind === 'blocked' || (e.kind === 'effect' && e.delta < 0 && /\/(cash|pos|budget|attention)$/.test(e.address))) { const r = String(e.via ?? '').replace('rule:', ''); if (ruleFeat[r]) ruleFeat[r].add('resource-bounded'); }
  const price: [number, number][] = [[0, sc(tr.initial.state['mkt/price'])]]; for (const e of ev) if (e.kind === 'effect' && e.address === 'mkt/price') price.push([e.t, sc(e.after)]);
  const at = (t: number) => { let v = price[0][1]; for (const [tt, vv] of price) { if (tt > t) break; v = vv; } return v; };
  const fwd = new Map<number, number[]>(); for (const e of ev) for (const c of (e.cause ?? []) as number[]) (fwd.get(c) ?? fwd.set(c, []).get(c)!).push(e.seq);
  const reach = (s0: number) => { const seen = new Set([s0]); let fr = [s0]; for (let d = 0; d < 5 && fr.length; d++) { const nx: number[] = []; for (const s of fr) for (const k of fwd.get(s) ?? []) if (!seen.has(k)) { seen.add(k); nx.push(k); } fr = nx; } return seen.size - 1; };
  const detectedAfter = (t: number) => ev.some((e) => e.kind === 'detection' && e.apparatus === 'market-observer' && e.t > t && e.t <= t + 2) ? 1 : 0;
  const trades = ev.filter((e) => e.kind === 'effect' && e.address === 'mkt/flow' && String(e.via).startsWith('rule:'));
  const rows = trades.map((e) => { const rule = String(e.via).slice(5); return { trader: rule.split('.')[0], role: [...(ruleFeat[rule] ?? [])].sort().join('+') || 'none', y: { predictive: at(e.t + 5) - at(e.t), penetration: reach(e.seq), observational: detectedAfter(e.t) } }; });
  const eta = (lab: string[], y: number[]) => {
    const n = y.length; if (n < 8) return 0; const m = y.reduce((a, b) => a + b, 0) / n; const tot = y.reduce((a, b) => a + (b - m) ** 2, 0); if (tot < 1e-12) return 0;
    const g = new Map<string, number[]>(); lab.forEach((l, i) => (g.get(l) ?? g.set(l, []).get(l)!).push(y[i]));
    let w = 0; for (const v of g.values()) { const mm = v.reduce((a, b) => a + b, 0) / v.length; w += v.reduce((a, b) => a + (b - mm) ** 2, 0); }
    const k = g.size; const r2 = 1 - w / tot; return n - k > 0 ? 1 - (1 - r2) * (n - 1) / (n - k) : 0;
  };
  const axes: Record<string, { role: number; roleAndTrader: number; traderAdds: number; nonRedundant: boolean }> = {};
  for (const ax of ['predictive', 'penetration', 'observational'] as const) {
    const y = rows.map((r) => r.y[ax]); const role = eta(rows.map((r) => r.role), y); const joint = eta(rows.map((r) => r.role + '∧' + r.trader), y);
    axes[ax] = { role, roleAndTrader: joint, traderAdds: joint - role, nonRedundant: joint - role > eps };
  }
  const roleClasses = new Set(rows.map((r) => r.role)).size, traderClasses = new Set(rows.map((r) => r.trader)).size;
  return { trades: rows.length, roleClasses, traderClasses, axes, notEvaluable: ['interventional', 'reachability'], traderAdds: Object.values(axes).some((a) => a.nonRedundant) };
}

/**
 * Revised "trader" category test.
 *  1. Is matched aggregate flow operationally insufficient (on any axis)?
 *  2. Do lower-level operational bundle descriptions (no trader units) reproduce the market on all axes?
 *  3. Does the trader partition add difference beyond the operational-role partition of order events?
 * Only if the trader partition survives (3) *and* the bundle description fails (2) is "trader" reported
 * non-redundant. Aggregate-flow failure alone never establishes the category.
 */
export function traderCategoryTest(p: Record<string, unknown> = {}, seeds = [44, 45, 46]) {
  const shockAt = Number(p.liquidityShockAt ?? 200);
  const H = Number(p.horizon ?? 300);
  const mk = (over: Record<string, unknown>, seed: number) => marketSpec({ ...marketPreset.defaults, horizon: H, liquidityShockAt: shockAt, ...p, ...over, seed });
  const traced = (over: Record<string, unknown>) => seeds.map((sd) => runSpec(mk(over, sd), { reachability: false }));
  const traders = traced({});
  const sigma = flowSigma(traders[0]);
  const aggregate = traced({ participants: ['generic-flow'], flowSigma: sigma });
  const bundles = traced({ participants: ['role-bundles'] });
  const M = (ts: Trace[]) => ts.map((t) => axisMetrics(t, shockAt));
  const vsAggregate = axisCompare(M(traders), M(aggregate));
  const vsBundles = axisCompare(M(traders), M(bundles));
  const aggregateInsufficient = Object.values(vsAggregate).some((a) => a.differs);
  const bundlesReproduce = !Object.values(vsBundles).some((a) => a.differs);
  const eventLevel = traderBeyondRoles(traders[0]);
  let verdict: string;
  if (!aggregateInsufficient) verdict = 'matched aggregate flow sufficient on the measured axes; trader category not needed here';
  else if (eventLevel.traderAdds && !bundlesReproduce) verdict = 'trader non-redundant given the tested bundle descriptions';
  else if (!eventLevel.traderAdds && bundlesReproduce) verdict = 'trader vocabulary redundant given operational bundle description';
  else verdict = 'aggregate-flow model insufficient; trader-category necessity unresolved';
  return {
    verdict, matchedSigma: sigma, seeds, aggregateInsufficient, bundlesReproduce,
    vsAggregate, vsBundles, eventLevel,
    note: 'Aggregate-flow failure shows only that first-order flow statistics are operationally insufficient. The bundle descriptions tested here are one choice of lower-level vocabulary; failure to reproduce with them does not establish the trader category.',
    signature: canonical({ a: aggregateInsufficient, b: bundlesReproduce, e: eventLevel.traderAdds }),
  };
}

/** Fragility movement caused by one configuration: market with vs. without it. */
export function participantFragility(x: Participant, p: Record<string, unknown> = {}) {
  const all = (p.participants as Participant[] | undefined) ?? [...PARTICIPANTS];
  const withP = runSpec(marketSpec({ ...marketPreset.defaults, ...p, participants: all }), { reachability: false });
  const without = runSpec(marketSpec({ ...marketPreset.defaults, ...p, participants: all.filter((y) => y !== x) }), { reachability: false });
  const regions: Region[] = [
    { id: 'market', prefixes: ['mkt/price', 'mkt/liquidity'], resources: ['mkt/liquidity'], failureProbes: ['crash', 'liquidity-crisis'], limits: [{ address: 'mkt/liquidity', limit: 30, dir: 'below' }] },
    ...all.filter((y) => y !== x).map((y) => ({ id: y, prefixes: [PREFIX[y] + '/'], failureProbes: [`${PREFIX[y]}:ruin`] })),
  ];
  return fragilityTransfer(without, withP, regions, 'market', () => true);
}

export const MARKET_PRESETS = [marketPreset];
