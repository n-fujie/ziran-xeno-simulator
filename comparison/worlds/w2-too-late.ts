// World 2 — Too-late correction.
//
// A tracked quantity y integrates corrections that land after an actuator delay La; the target r = φ switches
// sign on the environment's own clock (intervals uniform in [8, 16], unknown to every framework). y and r are
// observed with a one-step sensor delay. A correction can be correct when issued (sign matches r − y) but land
// after the environment has reorganized. The evaluator measures separately, for every issued correction:
//   correctness  — sign(c) = sign(r_t − y_t) at issue time (true values),
//   timing       — whether φ changed in (t, t+La] (reorganization before landing),
//   realized effect — |e| one step after landing with vs without this correction (exact: effects are additive).
import { rng, gauss, next, type RngState, mean, round, QTable, binOf } from '../frameworks/lib.ts';
import { baseRecord, statement, distinctionRow, type ComparisonRecord, type WorldResult, type FairnessCheck, type MatchedConditions } from '../core/schema.ts';

export const W2 = { La: 3, Ls: 1, noise: 0.05, horizon: 400, evalFrom: 20, minI: 8, maxI: 16, trainEpisodes: 20 };
export const W2_SEEDS = [1, 2, 3, 4, 5];
const C = [-0.4, -0.2, 0, 0.2, 0.4] as const;

export interface W2Obs { t: number; y: number; r: number }

export function scheduleFor(seed: number, horizon = W2.horizon): number[] {
  const r = rng(seed, 21); const flips: number[] = []; let t = 0;
  while (t < horizon) { t += W2.minI + Math.floor(next(r) * (W2.maxI - W2.minI + 1)); flips.push(t); }
  return flips;
}

export class W2Env {
  t = 0; y = 0; phi = 1; flips: number[]; r: RngState; queue: number[] = []; hist: { y: number; r: number }[] = [];
  issued: { t: number; c: number; e: number; landing: number; phiAtIssue: number }[] = []; landedEffects = new Map<number, number>();
  constructor(seed: number) { this.flips = scheduleFor(seed); this.r = rng(seed, 7); this.queue = new Array(W2.La).fill(0); this.hist.push({ y: 0, r: 1 }); }
  obs(): W2Obs { const h = this.hist[Math.max(0, this.hist.length - 1 - W2.Ls)]; return { t: this.t, y: h.y, r: h.r }; }
  step(c: number): W2Obs {
    if (c !== 0) this.issued.push({ t: this.t, c, e: this.phi - this.y, landing: this.t + W2.La, phiAtIssue: this.phi });
    this.queue.push(c); const v = this.queue.shift()!;
    this.y = this.y + v + gauss(this.r) * W2.noise; this.t++;
    if (this.flips.includes(this.t)) this.phi = -this.phi;
    this.hist.push({ y: this.y, r: this.phi }); return this.obs();
  }
}

interface W2Agent { act(o: W2Obs): number; selfClass?: () => Record<string, number>; modelRevisions: string[]; evaluations: number; memory: number; clockModel?: () => string }
const q = (x: number) => C.reduce((b, c) => (Math.abs(c - x) < Math.abs(b - x) ? c : b), 0 as number);

function syncControl(k = 0.5): W2Agent {
  const a: W2Agent = { modelRevisions: [], evaluations: 0, memory: 0, act: (o) => { a.evaluations++; return q(k * (o.r - o.y)); } }; return a;
}
/** Smith-predictor style: compensates the known sensor and actuator delays with the in-flight corrections. */
function delayCompensated(k = 0.5): W2Agent {
  const inflight: number[] = [];
  const a: W2Agent = { modelRevisions: [], evaluations: 0, memory: W2.La + W2.Ls, act(o) { const pend = inflight.slice(-(W2.La + W2.Ls)).reduce((s, x) => s + x, 0); const c = q(k * (o.r - (o.y + pend))); inflight.push(c); a.evaluations++; return c; } }; return a;
}
/**
 * Asynchronous control: separate models for the actuator/sensor delays and the environment's switching clock.
 * The switching-interval support is learned online from observed target changes (no schedule is supplied).
 * The correction minimizes the expected |r − y| at landing under the predicted distribution of φ at landing.
 */
function asyncControl(o0: { selfClassify?: boolean; singleClock?: boolean } = {}): W2Agent {
  const inflight: number[] = []; let lastR: number | null = null, lastFlip: number | null = null; const intervals: number[] = [];
  const rSeen = new Map<number, number>();
  const own: { t: number; c: number; premise: number; rIssue: number; done: boolean }[] = []; const cls: Record<string, number> = { 'correct-in-time': 0, 'correct-but-too-late': 0, incorrect: 0 };
  const a: W2Agent = { modelRevisions: [], evaluations: 0, memory: 0,
    act(o) {
      rSeen.set(o.t - W2.Ls, o.r);
      if (!o0.singleClock && lastR !== null && o.r !== lastR) { const tf = o.t - W2.Ls; if (lastFlip !== null) { intervals.push(tf - lastFlip); a.modelRevisions.push(`t=${o.t}: environment-clock interval support [${Math.min(...intervals)}, ${Math.max(...intervals)}]`); } lastFlip = tf; }
      lastR = o.r;
      // Premise evaluated at issue (sign of the predicted error) and re-evaluated once the landing time is observable.
      if (o0.selfClassify) for (const x of own) if (!x.done && rSeen.has(x.t + W2.La)) { x.done = true; if (Math.sign(x.c) !== Math.sign(x.premise)) cls.incorrect++; else if (rSeen.get(x.t + W2.La) !== x.rIssue) cls['correct-but-too-late']++; else cls['correct-in-time']++; }
      const pend = o0.singleClock ? 0 : inflight.slice(-(W2.La + W2.Ls)).reduce((sm, x) => sm + x, 0); const yPred = o.y + pend;
      const since = lastFlip === null ? 0 : o.t - lastFlip; const until = since + W2.La + W2.Ls;
      let pFlip = 0;
      if (!o0.singleClock && intervals.length) { const lo = Math.min(...intervals), hi = Math.max(...intervals); if (since >= hi) pFlip = 1; else { const first = Math.max(lo, since + 1); const survive = hi - first + 1; const hits = Math.max(0, Math.min(hi, until) - first + 1); pFlip = survive > 0 ? hits / survive : 1; } }
      let best = 0, bc = Infinity;
      for (const c of C) { const y2 = yPred + c; const cost = (1 - pFlip) * Math.abs(o.r - y2) + pFlip * Math.abs(-o.r - y2); a.evaluations++; if (cost < bc - 1e-12) { bc = cost; best = c; } }
      inflight.push(best); if (o0.selfClassify && best !== 0) own.push({ t: o.t, c: best, premise: o.r - yPred, rIssue: o.r, done: false });
      a.memory = inflight.length + intervals.length; return best;
    }, selfClass: o0.selfClassify ? () => ({ ...cls }) : undefined, clockModel: () => (intervals.length ? `[${Math.min(...intervals)}, ${Math.max(...intervals)}]` : 'none') };
  return a;
}

// ------------------------------------------------------------------ reinforcement learning
const EE = [-1.5, -0.9, -0.5, -0.2, 0.2, 0.5, 0.9, 1.5];
type RLMode = 'fixed-state' | 'goal-conditioned' | 'clock-feature' | 'options';
function key(mode: RLMode, o: W2Obs, since: number, pend: number) {
  if (mode === 'fixed-state') return `${binOf(o.r - o.y, EE)}`;
  if (mode === 'goal-conditioned') return `${binOf(o.y, EE)}|g${o.r}`;
  if (mode === 'clock-feature') return `${binOf(o.r - o.y - pend, EE)}|${Math.min(since, 16) >> 1}`;
  return `${binOf(o.r - o.y - pend, EE)}`;
}
/** Options (temporal abstraction): each option holds one correction level for k ∈ {1, 3} steps. */
const OPTIONS = C.flatMap((c) => [1, 3].map((k) => ({ c, k })));
function trainRL(mode: RLMode, seed: number, episodes = W2.trainEpisodes): QTable {
  const nA = mode === 'options' ? OPTIONS.length : C.length; const Q = new QTable(nA, 0.2, 0.8); const r = rng(seed, 31);
  for (let ep = 0; ep < episodes; ep++) {
    const env = new W2Env(2000 + seed * 100 + ep); let o = env.obs(); const eps = Math.max(0.05, 0.5 * (1 - ep / episodes)); let lastR = o.r, since = 0; const inflight: number[] = [];
    while (env.t < W2.horizon) {
      const pend = inflight.slice(-(W2.La + W2.Ls)).reduce((s, x) => s + x, 0);
      const s = key(mode, o, since, pend); const ai = Q.act(s, eps, r);
      const { c, k } = mode === 'options' ? OPTIONS[ai] : { c: C[ai], k: 1 }; let rew = 0;
      for (let i = 0; i < k && env.t < W2.horizon; i++) { o = env.step(c); inflight.push(c); rew += -Math.abs(env.phi - env.y) * 0.8 ** i; if (o.r !== lastR) { since = 0; lastR = o.r; } else since++; }
      const pend2 = inflight.slice(-(W2.La + W2.Ls)).reduce((s2, x) => s2 + x, 0);
      Q.learn(s, ai, rew, env.t >= W2.horizon ? null : key(mode, o, since, pend2));
    }
  }
  return Q;
}
function rlAgent(mode: RLMode, Q: QTable, seed: number): W2Agent {
  const r = rng(seed, 41); let lastR: number | null = null, since = 0; const inflight: number[] = []; let hold = 0, holdC = 0;
  const a: W2Agent = { modelRevisions: [], evaluations: 0, memory: 0,
    act(o) {
      if (lastR !== null && o.r !== lastR) since = 0; else since++; lastR = o.r;
      if (hold > 0) { hold--; inflight.push(holdC); return holdC; }
      const pend = inflight.slice(-(W2.La + W2.Ls)).reduce((s, x) => s + x, 0);
      const ai = Q.act(key(mode, o, since, pend), 0, r); a.evaluations++; a.memory = Q.Q.size * Q.nActions;
      if (mode === 'options') { const op = OPTIONS[ai]; hold = op.k - 1; holdC = op.c; inflight.push(op.c); return op.c; }
      inflight.push(C[ai]); return C[ai];
    } };
  return a;
}

// ------------------------------------------------------------------ active inference
/**
 * Hidden factors: φ ∈ {+,−} and the time since its last switch (semi-Markov duration). The duration likelihood of a
 * switch is learned online from observed switches (same information as the asynchronous controller; no schedule
 * supplied). Preferences: ln P̃(e) ∝ −e²/(2·0.2²) on the error at landing. Policies: the five correction levels.
 * G(c) = −E_Q[ln P̃(e_landing)] − epistemic term; the epistemic term is zero here because no action changes what
 * is observed about φ — recorded rather than assumed away.
 */
function aifAgent(): W2Agent {
  const inflight: number[] = []; let lastR: number | null = null, lastFlip: number | null = null; const intervals: number[] = [];
  const a: W2Agent = { modelRevisions: [], evaluations: 0, memory: 0,
    act(o) {
      if (lastR !== null && o.r !== lastR) { const tf = o.t - W2.Ls; if (lastFlip !== null) { intervals.push(tf - lastFlip); a.modelRevisions.push(`t=${o.t}: duration likelihood updated (${intervals.length} intervals)`); } lastFlip = tf; }
      lastR = o.r;
      const pend = inflight.slice(-(W2.La + W2.Ls)).reduce((s, x) => s + x, 0); const yPred = o.y + pend;
      const since = lastFlip === null ? 0 : o.t - lastFlip; const until = since + W2.La + W2.Ls;
      // Bayesian predictive P(switch in (since, until] | no switch by since) under a Laplace-smoothed empirical duration distribution
      let pFlip = 0;
      if (intervals.length) { const hist = new Map<number, number>(); for (const d of intervals) hist.set(d, (hist.get(d) ?? 0) + 1); const tot = intervals.length + 1; const p = (d: number) => ((hist.get(d) ?? 0) + (d >= 1 && d <= 40 ? 1 / 40 : 0)) / tot; let surv = 0, hit = 0; for (let d = since + 1; d <= 40; d++) { surv += p(d); if (d <= until) hit += p(d); } pFlip = surv > 0 ? hit / surv : 1; }
      let best = 0, bG = Infinity;
      for (const c of C) { const y2 = yPred + c; const lnp = (e: number) => -(e * e) / (2 * 0.2 * 0.2); const G = -((1 - pFlip) * lnp(o.r - y2) + pFlip * lnp(-o.r - y2)); a.evaluations++; if (G < bG - 1e-12) { bG = G; best = c; } }
      inflight.push(best); a.memory = inflight.length + intervals.length; return best;
    } };
  return a;
}

// ------------------------------------------------------------------ evaluation
interface Out { perCorrection: { correct: boolean; reorganized: boolean; effect: 'effective' | 'ineffective' | 'harmful' }[]; meanAbsErr: number; within: number; selfClass: Record<string, number> | null; truthClass: Record<string, number>; evaluations: number; memory: number; revisions: string[]; clock: string | null }

function runW2(agent: W2Agent, seed: number): Out {
  const env = new W2Env(seed); let o = env.obs(); const err: number[] = [];
  const yAt: number[] = [0], phiAt: number[] = [1];
  while (env.t < W2.horizon) { o = agent.act ? env.step(agent.act(o)) : o; yAt.push(env.y); phiAt.push(env.phi); if (env.t >= W2.evalFrom) err.push(Math.abs(env.phi - env.y)); }
  const per = env.issued.filter((x) => x.t >= W2.evalFrom && x.landing + 1 < yAt.length).map((x) => {
    const correct = Math.sign(x.c) === Math.sign(x.e);
    let reorganized = false; for (let t = x.t + 1; t <= x.landing; t++) if (phiAt[t] !== phiAt[x.t]) reorganized = true;
    const L = x.landing + 1; const withE = Math.abs(phiAt[L] - yAt[L]), without = Math.abs(phiAt[L] - (yAt[L] - x.c));
    const d = without - withE; const effect: Out['perCorrection'][number]['effect'] = d > 0.05 ? 'effective' : d < -0.05 ? 'harmful' : 'ineffective';
    return { correct, reorganized, effect };
  });
  const truthClass = { 'correct-in-time': per.filter((p) => p.correct && !p.reorganized).length, 'correct-but-too-late': per.filter((p) => p.correct && p.reorganized && p.effect !== 'effective').length, 'correct-reorganized-still-effective': per.filter((p) => p.correct && p.reorganized && p.effect === 'effective').length, incorrect: per.filter((p) => !p.correct).length };
  return { perCorrection: per, meanAbsErr: mean(err), within: err.filter((e) => e < 0.3).length / err.length, selfClass: agent.selfClass?.() ?? null, truthClass, evaluations: agent.evaluations, memory: agent.memory, revisions: agent.modelRevisions, clock: agent.clockModel?.() ?? null };
}

interface Config { framework: ComparisonRecord['framework']; configuration: string; role: ComparisonRecord['role']; make: (seed: number) => W2Agent; dataSteps: number; describe: (r: ComparisonRecord) => void }
const RLCACHE = new Map<string, QTable>();
const rl = (mode: RLMode, episodes = W2.trainEpisodes) => (seed: number) => { const k = `${mode}|${seed}|${episodes}`; if (!RLCACHE.has(k)) RLCACHE.set(k, trainRL(mode, seed, episodes)); const src = RLCACHE.get(k)!; const Q = new QTable(src.nActions, src.alpha, src.gamma); for (const [s, v] of src.Q) Q.Q.set(s, [...v]); return rlAgent(mode, Q, seed); };
const DELAYS = { item: 'dynamics' as const, supplied: 'integrator plant, actuator delay 3, sensor delay 1', enabled: 'prediction of y at landing', prevented: '—' };

export const W2_CONFIGS: Config[] = [
  { framework: 'control-mpc', configuration: 'synchronous P control (single clock, delays ignored)', role: 'primary', make: () => syncControl(), dataSteps: 0, describe: (r) => { r.representationSupplied = ['error e = r − y', 'gain 0.5']; r.burden = [{ item: 'dynamics', supplied: 'none beyond gain', enabled: 'simplicity', prevented: 'delay compensation' }]; r.profile.cannotExpress = ['delay', 'environment clock']; } },
  { framework: 'control-mpc', configuration: 'delay-compensated control (Smith-predictor style)', role: 'primary', make: () => delayCompensated(), dataSteps: 0, describe: (r) => { r.representationSupplied = ['plant delays', 'in-flight corrections']; r.burden = [DELAYS]; r.profile.preserves = ['in-flight corrections']; r.profile.cannotExpress = ['environment reorganization']; } },
  { framework: 'control-mpc', configuration: 'asynchronous MPC (delays + learned environment-clock model)', role: 'primary', make: () => asyncControl(), dataSteps: 0, describe: (r) => { r.representationSupplied = ['plant delays', 'switching-interval model (uniform support, learned online)']; r.representationGenerated = ['interval support']; r.burden = [DELAYS, { item: 'schedule', supplied: 'model class: renewal process with uniform intervals', enabled: 'switch prediction', prevented: 'non-renewal switching', wrongWhen: 'not tested here' }]; r.profile.canRevise = ['clock model']; } },
  { framework: 'reinforcement-learning', configuration: 'tabular Q, fixed state (observed error bin)', role: 'primary', make: rl('fixed-state'), dataSteps: W2.trainEpisodes * W2.horizon, describe: (r) => { r.representationSupplied = ['state: error bin', 'reward −|e|', '5 actions']; r.burden = [{ item: 'state-variables', supplied: 'observed error bin', enabled: 'learning', prevented: 'in-flight corrections and clock phase', wrongWhen: 'the same observed error calls for different corrections depending on what is in flight' }, { item: 'reward', supplied: '−|r − y|', enabled: 'learning', prevented: '—' }]; r.profile.merges = ['states with equal observed error and different in-flight corrections']; } },
  { framework: 'reinforcement-learning', configuration: 'goal-conditioned Q (state y bin, goal r)', role: 'primary', make: rl('goal-conditioned'), dataSteps: W2.trainEpisodes * W2.horizon, describe: (r) => { r.representationSupplied = ['state y bin', 'goal r']; r.burden = [{ item: 'goals', supplied: 'goal = observed target', enabled: 'goal-conditioned policy', prevented: '—' }]; } },
  { framework: 'reinforcement-learning', configuration: 'hierarchical Q with options (hold correction 1 or 3 steps)', role: 'primary', make: rl('options'), dataSteps: W2.trainEpisodes * W2.horizon, describe: (r) => { r.representationSupplied = ['options (temporal abstraction)', 'state: predicted error bin (incl. in-flight)']; r.burden = [{ item: 'action-set', supplied: '10 options', enabled: 'temporal abstraction', prevented: '—' }]; } },
  { framework: 'reinforcement-learning', configuration: 'tabular Q with clock feature (time since observed switch)', role: 'fairness', make: rl('clock-feature'), dataSteps: W2.trainEpisodes * W2.horizon, describe: (r) => { r.representationSupplied = ['state: predicted error bin × time-since-switch']; r.burden = [{ item: 'state-variables', supplied: 'clock feature added by the designer', enabled: 'implicit timing', prevented: '—' }]; } },
  { framework: 'active-inference', configuration: 'AIF: hidden φ + semi-Markov duration, learned duration likelihood', role: 'primary', make: () => aifAgent(), dataSteps: 0, describe: (r) => { r.representationSupplied = ['hidden φ', 'duration factor', 'delays', 'preferences over landing error']; r.representationGenerated = ['duration likelihood']; r.burden = [DELAYS, { item: 'hidden-factors', supplied: 'φ and time since switch', enabled: 'belief about switching', prevented: '—' }, { item: 'preferences', supplied: 'ln P̃(e) ∝ −e²/0.08', enabled: 'risk', prevented: '—' }]; r.profile.preserves = ['uncertainty about the switch']; r.notes.push('Epistemic value is zero in this world: no action changes what is observed about φ. AIF therefore reduces to Bayesian decision under preferences here.'); } },
  { framework: 'ziran-xeno', configuration: 'Ziran / Xeno adapter (sensor, actuator and environment clocks; premise at issue and landing)', role: 'primary', make: () => asyncControl({ selfClassify: true }), dataSteps: 0, describe: (r) => { r.representationSupplied = ['three clocks', 'delays', 'premise function']; r.representationGenerated = ['environment-clock interval support', 'self-classification of corrections']; r.burden = [DELAYS, { item: 'schedule', supplied: 'renewal clock model class', enabled: 'switch prediction', prevented: 'non-renewal switching' }]; r.profile.preserves = ['correction premise at issue and at landing']; } },
  { framework: 'ziran-xeno', configuration: 'ablation: no multiple clocks (single clock, self-classification kept)', role: 'ablation', make: () => asyncControl({ selfClassify: true, singleClock: true }), dataSteps: 0, describe: (r) => { r.representationSupplied = ['single clock: no delay model, no environment clock; self-classification kept']; } },
];

export function runWorld2(seeds = W2_SEEDS): WorldResult {
  const records: ComparisonRecord[] = [];
  for (const c of W2_CONFIGS) {
    const t0 = performance.now(); const outs = seeds.map((s) => runW2(c.make(s), s)); const ms = performance.now() - t0;
    const r = baseRecord('W2-too-late-correction', c.framework, c.configuration, c.role); c.describe(r);
    const per = outs.flatMap((o) => o.perCorrection);
    const sum = (f: (p: (typeof per)[number]) => boolean) => per.filter(f).length;
    const tc = outs.reduce((acc, o) => { for (const [k, v] of Object.entries(o.truthClass)) acc[k] = (acc[k] ?? 0) + v; return acc; }, {} as Record<string, number>);
    r.observationsSupplied = ['y (delay 1)', 'r (delay 1)']; r.interventions = ['correction c ∈ {−0.4,−0.2,0,0.2,0.4}, lands after 3 steps'];
    r.measurements = {
      corrections: per.length,
      correctness_correctFraction: round(sum((p) => p.correct) / per.length, 3),
      timing_reorganizedBeforeLandingFraction: round(sum((p) => p.reorganized) / per.length, 3),
      environmentalReconfiguration_correctButReorganized: sum((p) => p.correct && p.reorganized),
      realizedEffect_effectiveFraction: round(sum((p) => p.effect === 'effective') / per.length, 3),
      realizedEffect_harmfulFraction: round(sum((p) => p.effect === 'harmful') / per.length, 3),
      correctButTooLate: tc['correct-but-too-late'] ?? 0,
      correctReorganizedStillEffective: tc['correct-reorganized-still-effective'] ?? 0,
      meanAbsTrackingError: round(mean(outs.map((o) => o.meanAbsErr)), 3),
      fractionWithin0_3: round(mean(outs.map((o) => o.within)), 3),
      selfClassification: outs[0].selfClass ? JSON.stringify(outs.reduce((acc, o) => { for (const [k, v] of Object.entries(o.selfClass!)) acc[k] = (acc[k] ?? 0) + v; return acc; }, {} as Record<string, number>)) : null,
    };
    r.timing = { correctButTooLate: tc['correct-but-too-late'] ?? 0, clockModelSeed1: outs[0].clock };
    r.detectedDifferences = outs[0].selfClass ? ['correct-but-too-late corrections (self-classified)'] : [];
    r.inaccessibleDifferences = outs[0].selfClass ? [] : ['whether an issued correction became too late (not represented by the framework; evaluator only)'];
    r.modelRevisions = outs[0].revisions.slice(0, 4);
    r.cost = { computeMs: round(ms, 1), modelEvaluations: Math.round(mean(outs.map((o) => o.evaluations))), dataSteps: c.dataSteps, observationsUsed: W2.horizon, interventionCount: Math.round(per.length / seeds.length), memoryItems: Math.round(mean(outs.map((o) => o.memory))), representationComplexity: null, note: 'per run; computeMs covers all seeds incl. training' };
    r.conversions = [{ from: 'true (y, φ)', to: 'observation (y, r) delayed 1', retained: ['y, r one step old'], lost: ['current y, φ'], newlyAvailable: [], unresolved: [] }];
    records.push(r);
  }
  for (const r of records) if (/asynchronous|AIF|Ziran/.test(r.configuration) && r.role !== 'ablation') r.notes.push('Anticipatory corrections (issued toward the predicted target at landing) count as incorrect under the at-issue premise even when they are effective at landing; correctness at issue and realized effect are therefore reported separately.');
  const z = records.find((r) => r.framework === 'ziran-xeno' && r.role === 'primary')!;
  for (const r of records) if (r !== z) {
    const a = r.measurements.correctButTooLate as number, b = z.measurements.correctButTooLate as number;
    r.profile.interventionDifferences.push(`correct-but-too-late ${a} vs Ziran adapter ${b}; mean |e| ${r.measurements.meanAbsTrackingError} vs ${z.measurements.meanAbsTrackingError}`);
  }
  const find = (p: string) => records.find((r) => r.configuration.includes(p))!;
  const fairness: FairnessCheck[] = [
    { distinction: 'too-late corrections avoided', firstConfiguration: find('fixed state').configuration, alternativeConfiguration: find('clock feature').configuration, alternativeTested: true, retainedUnderAlternative: (find('clock feature').measurements.correctButTooLate as number) < (find('fixed state').measurements.correctButTooLate as number), note: `too-late ${find('fixed state').measurements.correctButTooLate} → ${find('clock feature').measurements.correctButTooLate}` },
    { distinction: 'too-late corrections avoided', firstConfiguration: find('synchronous P').configuration, alternativeConfiguration: find('asynchronous MPC').configuration, alternativeTested: true, retainedUnderAlternative: (find('asynchronous MPC').measurements.correctButTooLate as number) < (find('synchronous P').measurements.correctButTooLate as number), note: `too-late ${find('synchronous P').measurements.correctButTooLate} → ${find('asynchronous MPC').measurements.correctButTooLate}` },
    { distinction: 'self-classification of too-late corrections', firstConfiguration: find('asynchronous MPC').configuration, alternativeConfiguration: 'asynchronous MPC + post-hoc premise check at landing (same as the Ziran adapter\'s classifier)', alternativeTested: false, retainedUnderAlternative: null, note: 'Not separately run: the Ziran adapter\'s decision rule is the asynchronous MPC rule plus this classifier, so adding the classifier to MPC would reproduce it exactly. The classifier is therefore not evidence of a capability MPC lacks.' },
  ];
  const statements = records.map((r) => statement(r.configuration, r.framework, 'correct-but-too-late correction', r.measurements.selfClassification !== null, `evaluator count ${r.measurements.correctButTooLate}; realized-effective fraction ${r.measurements.realizedEffect_effectiveFraction}; mean |e| ${r.measurements.meanAbsTrackingError}`));
  const matched: MatchedConditions = { world: 'W2-too-late-correction', inputData: 'same environment instances (seeds 1–5); RL uses 20 training episodes (8000 steps) from disjoint seeds', initialConditions: 'y₀ = 0, φ₀ = +1', interventionHistory: 'framework-chosen corrections', temporalHorizon: '400 steps', computationalBudget: 'not equalized; recorded', observationAvailability: 'y and r with one-step delay for all', measurementResolution: 'noise σ = 0.05 on y dynamics', resourceConstraints: 'none (corrections are free)', evaluationWindow: 't ∈ [20, 400)', sameness: [{ framework: 'all', sameRawSource: true, samePreprocessing: true, sameObservation: true, sameStateRepresentation: false, sameIntervention: true, sameOperationalEffect: null, transformation: 'RL bins observations; others use readings. The environment schedule is supplied to no framework.' }] };
  const references = { switchesPerRun: round(mean(seeds.map((s) => scheduleFor(s).length)), 1), note: 'no framework is given the switching schedule; the interval support must be learned' };
  return { references, world: 'W2-too-late-correction', question: 'When the environment reorganizes on its own clock, which frameworks avoid, register, or merely suffer corrections that are correct when issued but too late when they land?', design: 'integrator plant, actuator delay 3, sensor delay 1, target sign switches every 8–16 steps', matched, records, fairness, statements,
    distinctionTable: [distinctionRow('too-late corrections self-registered', records, (r) => r.measurements.selfClassification !== null), distinctionRow('environment clock modeled', records, (r) => /clock|AIF|asynchronous/.test(r.configuration) && r.role !== 'ablation')],
    notApplicable: [{ framework: 'agent-based-modeling', reason: 'one controller and one environment; no population' }, { framework: 'digital-twin', reason: 'not in the W2 comparison list; synchronization is covered by the delay-compensated controller' }, { framework: 'viability-reachability', reason: 'not in the W2 comparison list' }], claimStatus: 'synthetic-world result' };
}
