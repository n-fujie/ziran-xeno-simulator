// World 1 — Observation aliasing.
//
// A regulated quantity x is observed; a hidden mode h ∈ {+1, −1} sets the sign of the actuator gain:
//   x' = a·x + b·h·u + d,   d ~ N(0, σd),   u ∈ {−1, 0, +1}.
// Under the initial apparatus (an x sensor) two states with the same reading are identical, but they diverge under
// the same intervention when h differs. h flips at seed-dependent times unknown to every framework. An optional h
// sensor can be installed by any framework (same cost for all). Nothing in the evaluation assumes which framework
// handles this best.
import { rng, gauss, next, type RngState, clamp, mean, round, RLS, Kalman1, QTable, binProbs, binOf, entropy } from '../frameworks/lib.ts';
import { baseRecord, statement, distinctionRow, type ComparisonRecord, type WorldResult, type FairnessCheck, type MatchedConditions } from '../core/schema.ts';
import { paretoFront, selectFrom, resolveAxes, type CandidateProfile } from '../../src/ziran/reviser.ts';

export const W1 = { a: 0.9, b: 0.4, sd: 0.15, sensorNoise: 0.02, band: 0.5, horizon: 300, energy0: 20, actCost: 0.02, hInstall: 1.0, hRun: 0.05, evalFrom: 20, trainEpisodes: 20 };
export const W1_SEEDS = [1, 2, 3, 4, 5];

export interface W1Action { u: -1 | 0 | 1; install?: 'h' }
export interface W1Obs { t: number; x: number; h?: number; energy: number }

export function flipsFor(seed: number): number[] {
  const r = rng(seed, 11); const out: number[] = [];
  while (out.length < 3) { const t = 50 + Math.floor(next(r) * 230); if (out.every((s) => Math.abs(s - t) >= 40)) out.push(t); }
  return out.sort((p, q) => p - q);
}

export class W1Env {
  t = 0; x = 0; h = 1; energy = W1.energy0; installed = new Set<string>(); flips: number[]; r: RngState; installLog: { t: number; sensor: string }[] = []; energyUsed = 0;
  seed: number;
  constructor(seed: number, flips?: number[]) { this.seed = seed; this.flips = flips ?? flipsFor(seed); this.r = rng(seed, 3); this.x = gauss(rng(seed, 5)) * 0.2; }
  obs(): W1Obs { const o: W1Obs = { t: this.t, x: this.x + gauss(this.r) * W1.sensorNoise, energy: this.energy }; if (this.installed.has('h') && this.energy > 0) o.h = this.h; return o; }
  step(a: W1Action): W1Obs {
    if (a.install === 'h' && !this.installed.has('h') && this.energy >= W1.hInstall) { this.installed.add('h'); this.spend(W1.hInstall); this.installLog.push({ t: this.t, sensor: 'h' }); }
    let u = this.energy > 0 ? a.u : 0;
    if (u !== 0) this.spend(W1.actCost);
    if (this.installed.has('h')) this.spend(W1.hRun);
    if (this.energy <= 0) u = 0;
    this.x = W1.a * this.x + W1.b * this.h * u + gauss(this.r) * W1.sd;
    this.t++;
    if (this.flips.includes(this.t)) this.h = -this.h;
    return this.obs();
  }
  spend(e: number) { const s = Math.min(this.energy, e); this.energy -= s; this.energyUsed += s; }
  /** Evaluator-only: is the band reachable within k steps by some constant action from the true state (noise-free fork)? */
  bandReachable(k = 3): boolean { for (const u of [-1, 0, 1]) { let x = this.x; for (let i = 0; i < k; i++) { x = W1.a * x + W1.b * this.h * u; if (Math.abs(x) < W1.band) return true; } } return Math.abs(this.x) < W1.band; }
}

/** A framework instance: acts on observations only; exposes what its own representation contains. */
interface W1Agent {
  act(o: W1Obs): W1Action;
  /** The framework's own estimate of h, if its representation has one (null = not represented). */
  hEstimate(): number | null;
  /** Framework-internal record of aliasing / mode change detection (null = not represented). */
  detections: number[] | null;
  modelRevisions: string[]; apparatusChanges: string[]; evaluations: number; memory: number;
  extra?: () => Record<string, unknown>;
}

// ------------------------------------------------------------------ shared planner for model-based frameworks
/** Finite-horizon MPC by enumeration over u ∈ {−1,0,1}^H under a supplied linear model with gain β. */
function mpc(x: number, beta: number, H = 4, rho = 0.01): { u: -1 | 0 | 1; evals: number } {
  let best = Infinity, bu: -1 | 0 | 1 = 0, evals = 0; const U = [-1, 0, 1] as const;
  const rec = (d: number, xx: number, cost: number, first: -1 | 0 | 1) => {
    if (d === H) { evals++; if (cost < best - 1e-12) { best = cost; bu = first; } return; }
    for (const u of U) { const xn = W1.a * xx + beta * u; rec(d + 1, xn, cost + xn * xn + rho * Math.abs(u), d === 0 ? u : first); }
  };
  rec(0, x, 0, 0); return { u: bu, evals };
}

function nominalMPC(): W1Agent {
  const a: W1Agent = { detections: null, modelRevisions: [], apparatusChanges: [], evaluations: 0, memory: 1,
    act(o) { const r = mpc(o.x, W1.b); a.evaluations += r.evals; return { u: r.u }; }, hEstimate: () => null };
  return a;
}

function adaptiveMPC(): W1Agent {
  const est = new RLS(1, 0.85, 1, [W1.b]); let px: number | null = null, pu = 0; let sign = 1;
  const a: W1Agent = { detections: [], modelRevisions: [], apparatusChanges: [], evaluations: 0, memory: 3,
    act(o) {
      if (px !== null && pu !== 0) { est.update([pu], o.x - W1.a * px); const s = Math.sign(est.w[0]) || sign; if (s !== sign) { sign = s; a.detections!.push(o.t); a.modelRevisions.push(`t=${o.t}: gain estimate changed sign → ${est.w[0].toFixed(2)}`); } }
      const beta = Math.abs(est.w[0]) < 0.05 ? sign * 0.05 : est.w[0];
      const r = mpc(o.x, beta); a.evaluations += r.evals; px = o.x; pu = r.u; return { u: r.u };
    }, hEstimate: () => sign };
  return a;
}

function digitalTwin(imm: boolean): W1Agent {
  // Physical state x ↔ digital state x̂ (Kalman filter), synchronized each step from the sensor feed.
  // Model update: event-triggered recalibration of the gain when the innovation test fails (NIS > 6.6, 3 in a row).
  // IMM variant (fairness): two modes ±b with Markov switching; mode probabilities updated each step.
  const kf = new Kalman1(W1.a, W1.b, W1.sd ** 2, W1.sensorNoise ** 2);
  let beta = W1.b, bad = 0, pu = 0, px: number | null = null; let mu = [0.99, 0.01]; let stateUpdates = 0, paramUpdates = 0; const nisLog: number[] = [];
  const recal = new RLS(1, 0.8, 1, [W1.b]);
  const a: W1Agent = { detections: [], modelRevisions: [], apparatusChanges: [], evaluations: 0, memory: imm ? 6 : 4,
    act(o) {
      if (px !== null) {
        if (imm) {
          const pr = 0.01; const prior = [mu[0] * (1 - pr) + mu[1] * pr, mu[1] * (1 - pr) + mu[0] * pr];
          const lik = [1, -1].map((h) => Math.exp(-((o.x - (W1.a * px! + W1.b * h * pu)) ** 2) / (2 * (W1.sd ** 2 + W1.sensorNoise ** 2))));
          const post = prior.map((p, i) => p * lik[i]); const s = post[0] + post[1]; const nmu = post.map((p) => p / s);
          if ((nmu[0] > 0.9) !== (mu[0] > 0.9) && Math.max(...nmu) > 0.9) { a.detections!.push(o.t); a.modelRevisions.push(`t=${o.t}: mode probability → ${nmu[0] > 0.9 ? '+' : '−'}`); }
          mu = nmu; beta = W1.b * (mu[0] > mu[1] ? 1 : -1); stateUpdates++;
        } else {
          kf.b = beta; kf.predict(pu); const nis = kf.update(o.x); stateUpdates++; nisLog.push(nis);
          if (pu !== 0) recal.update([pu], o.x - W1.a * px);
          bad = nis > 6.6 ? bad + 1 : 0;
          if (bad >= 3 || (pu !== 0 && Math.sign(recal.w[0]) !== Math.sign(beta) && Math.abs(recal.w[0]) > 0.15)) { const nb = Math.abs(recal.w[0]) > 0.05 ? recal.w[0] : beta; if (Math.sign(nb) !== Math.sign(beta)) { a.detections!.push(o.t); } a.modelRevisions.push(`t=${o.t}: parameter recalibration β ${beta.toFixed(2)} → ${nb.toFixed(2)}`); beta = nb; paramUpdates++; bad = 0; }
        }
      }
      const r = mpc(imm ? o.x : kf.x, beta); a.evaluations += r.evals; px = o.x; pu = r.u; return { u: r.u };
    }, hEstimate: () => Math.sign(beta),
    extra: () => ({ stateValueUpdates: stateUpdates, parameterUpdates: imm ? 0 : paramUpdates, modeProbabilityUpdates: imm ? stateUpdates : 0, variableStructureChanges: 0, observationStructureChanges: 0, meanNIS: imm ? null : round(mean(nisLog)) }) };
  return a;
}

// ------------------------------------------------------------------ reinforcement learning
const XE = [-1.5, -1, -0.5, -0.2, 0.2, 0.5, 1, 1.5];
type RLMode = 'fixed-state' | 'history-state' | 'sensor-action';
function rlKey(mode: RLMode, o: W1Obs, hist: { pu: number; px: number | null }, installed: boolean) {
  const xb = binOf(o.x, XE);
  if (mode === 'fixed-state') return `${xb}`;
  if (mode === 'history-state') return `${xb}|${hist.pu}|${hist.px === null ? 0 : Math.sign(Math.round((o.x - hist.px) * 10))}`;
  return `${xb}|${installed ? (o.h ?? '?') : 'no-h'}`;
}
function trainRL(mode: RLMode, seed: number, episodes: number): { Q: QTable; steps: number } {
  const nA = mode === 'sensor-action' ? 4 : 3; const Q = new QTable(nA, 0.2, 0.9); const r = rng(seed, 99); let steps = 0;
  for (let ep = 0; ep < episodes; ep++) {
    const env = new W1Env(1000 + seed * 100 + ep); let o = env.obs(); const hist = { pu: 0, px: null as number | null }; const eps = Math.max(0.05, 0.5 * (1 - ep / episodes));
    for (let t = 0; t < W1.horizon; t++) {
      const s = rlKey(mode, o, hist, env.installed.has('h')); const ai = Q.act(s, eps, r);
      const act: W1Action = ai === 3 ? { u: 0, install: 'h' } : { u: ([-1, 0, 1] as const)[ai] };
      const e0 = env.energy; hist.px = o.x; hist.pu = act.u; const o2 = env.step(act); steps++;
      const rew = -(o2.x ** 2) - 0.5 * (e0 - env.energy);
      Q.learn(s, ai, rew, t === W1.horizon - 1 ? null : rlKey(mode, o2, hist, env.installed.has('h'))); o = o2;
    }
  }
  return { Q, steps };
}
function rlAgent(mode: RLMode, Q: QTable, seed: number): W1Agent {
  const hist = { pu: 0, px: null as number | null }; let installed = false; const r = rng(seed, 123); let prevS: string | null = null, prevA = 0, prevX = 0;
  const a: W1Agent = { detections: null, modelRevisions: [], apparatusChanges: [], evaluations: 0, memory: 0,
    act(o) {
      const s = rlKey(mode, o, hist, installed);
      if (prevS !== null) Q.learn(prevS, prevA, -(o.x ** 2), s); // continues learning online (standard)
      const ai = Q.act(s, 0, r); a.evaluations++;
      const act: W1Action = ai === 3 ? { u: 0, install: 'h' } : { u: ([-1, 0, 1] as const)[ai] };
      if (act.install && !installed) { installed = true; a.apparatusChanges.push(`t=${o.t}: install h sensor (learned action)`); }
      prevS = s; prevA = ai; prevX = o.x; hist.px = o.x; hist.pu = act.u; void prevX; a.memory = Q.Q.size * Q.nActions; return act;
    }, hEstimate: () => null };
  return a;
}

// ------------------------------------------------------------------ active inference (discrete, with EFE)
/**
 * Generative model: hidden mode h ∈ {+,−} with Markov switching (p = 0.01); x observed with likelihood
 * p(x′|x,u,h) = N(a x + b h u, σ); optional outcome modality "h" once the h sensor is installed.
 * Prior preferences: ln P̃(x) ∝ −(x/0.5)² over 19 outcome bins; energy enters as a log-preference (weight 0.5 / unit).
 * Expected free energy per policy, standard decomposition: G(π) = −E_Q[ln P̃(o)] − E_Q[KL(Q(h|o) ‖ Q(h))]
 * (pragmatic + epistemic), evaluated on bins over two steps. Open-loop policies (u₁,u₂); the sensing policy is
 * evaluated with the second action chosen per sensed mode (a one-branch sophisticated evaluation), since the value
 * of sensing is only expressible when later action can depend on what is sensed.
 */
const OE = Array.from({ length: 19 }, (_, i) => -1.8 + i * 0.2);
const OC = [-2, ...OE.slice(0, -1).map((e, i) => (e + OE[i + 1]) / 2), 2];
function aifAgent(withMode: boolean, energyPref = 0.5): W1Agent {
  let q = [1, 0]; let px: number | null = null, pu = 0; let installed = false;
  const lnPrefRaw = OC.map((c) => -((c / 0.5) ** 2)); const Z = Math.log(lnPrefRaw.map((v) => Math.exp(v)).reduce((p, x) => p + x, 0)); const lnPref = lnPrefRaw.map((v) => v - Z);
  const sdX = Math.sqrt(W1.sd ** 2 + W1.sensorNoise ** 2);
  const pragmatic = (p: number[]) => p.reduce((s, pi, i) => s + pi * lnPref[i], 0);
  const infoGain = (comps: number[][], w: number[]) => { const mix = comps[0].map((_, i) => comps.reduce((s, c, k) => s + w[k] * c[i], 0)); return entropy(mix) - comps.reduce((s, c, k) => s + w[k] * entropy(c), 0); };
  const a: W1Agent = { detections: [], modelRevisions: [], apparatusChanges: [], evaluations: 0, memory: 2,
    act(o) {
      if (px !== null) {
        const prior = withMode ? [q[0] * 0.99 + q[1] * 0.01, q[1] * 0.99 + q[0] * 0.01] : [1, 0];
        let post: number[];
        if (o.h !== undefined && withMode) post = o.h > 0 ? [1, 0] : [0, 1];
        else { const lik = [1, -1].map((h) => Math.exp(-((o.x - (W1.a * px! + W1.b * h * pu)) ** 2) / (2 * sdX * sdX))); post = prior.map((p, i) => p * lik[i]); const sm = post[0] + post[1] || 1; post = post.map((p) => p / sm); }
        if (withMode && (post[0] > 0.9) !== (q[0] > 0.9) && Math.max(...post) > 0.9) { a.detections!.push(o.t); a.modelRevisions.push(`t=${o.t}: belief over h → ${post[0] > 0.9 ? '+' : '−'} (${Math.max(...post).toFixed(2)})`); }
        q = post;
      }
      const hs = withMode ? [1, -1] : [1]; const qh = withMode ? q : [1];
      const x1 = (h: number, u1: number) => W1.a * o.x + W1.b * h * u1;
      const pX2 = (h: number, u1: number, u2: number) => binProbs(W1.a * x1(h, u1) + W1.b * h * u2, sdX * Math.sqrt(1 + W1.a ** 2), OE);
      let bestG = Infinity, best: W1Action = { u: 0 };
      for (const u1 of [-1, 0, 1] as const) for (const u2 of [-1, 0, 1] as const) {
        const c1 = hs.map((h) => binProbs(x1(h, u1), sdX, OE)), c2 = hs.map((h) => pX2(h, u1, u2));
        const prag = c1.reduce((s, c, k) => s + qh[k] * pragmatic(c), 0) + c2.reduce((s, c, k) => s + qh[k] * pragmatic(c), 0);
        const epi = withMode ? infoGain(c1, qh) + infoGain(c2, qh) : 0;
        const G = -prag - epi + energyPref * ((u1 ? W1.actCost : 0) + (u2 ? W1.actCost : 0) + (installed ? 2 * W1.hRun : 0));
        a.evaluations++; if (G < bestG - 1e-12) { bestG = G; best = { u: u1 }; }
      }
      if (withMode && !installed) {
        // sensing policy: install now (u₁ = 0), then choose u₂ per sensed mode
        const c1 = hs.map((h) => binProbs(x1(h, 0), sdX, OE));
        const prag = c1.reduce((s, c, k) => s + qh[k] * pragmatic(c), 0) + hs.reduce((s, h, k) => s + qh[k] * Math.max(...[-1, 0, 1].map((u2) => pragmatic(pX2(h, 0, u2)))), 0);
        const epi = entropy(qh) + infoGain(c1, qh);
        const G = -prag - epi + energyPref * (W1.hInstall + W1.hRun * 2 + W1.actCost);
        a.evaluations++; if (G < bestG - 1e-12) { bestG = G; best = { u: 0, install: 'h' }; }
      }
      if (best.install) { installed = true; a.apparatusChanges.push(`t=${o.t}: install h sensor (expected free energy)`); }
      px = o.x; pu = best.u; return best;
    }, hEstimate: () => (withMode ? (q[0] >= q[1] ? 1 : -1) : null) };
  return a;
}

// ------------------------------------------------------------------ viability / reachability
const GRID = Array.from({ length: 401 }, (_, i) => -1 + i * 0.005);
/** Viability kernel of K = {|x| < band} under |d| ≤ dMax (grid), with known mode or robust over both modes. */
export function viabilityKernel(robust: boolean, dMax = 0.3): { kernel: number[]; iterations: number } {
  let V = GRID.filter((x) => Math.abs(x) < W1.band); let it = 0;
  const inV = (x: number, S: number[]) => S.length > 0 && x >= S[0] - 1e-9 && x <= S[S.length - 1] + 1e-9;
  for (;;) {
    it++;
    const nv = V.filter((x) => [-1, 0, 1].some((u) => (robust ? [1, -1] : [1]).every((h) => [-dMax, dMax].every((d) => inV(W1.a * x + W1.b * h * u + d, V)))));
    if (nv.length === V.length || it > 200) return { kernel: nv, iterations: it }; V = nv;
  }
}
function viabilityAgent(withEstimate: boolean): W1Agent {
  let hs = 1; let px: number | null = null, pu = 0;
  const known = viabilityKernel(false).kernel, lo = known[0] ?? 0, hi = known.at(-1) ?? 0;
  const a: W1Agent = { detections: withEstimate ? [] : null, modelRevisions: [], apparatusChanges: [], evaluations: 0, memory: GRID.length,
    act(o) {
      if (withEstimate && px !== null && pu !== 0) { const r = o.x - W1.a * px; if (Math.abs(r) > 0.25) { const s = Math.sign(r * pu); if (s !== hs) { hs = s; a.detections!.push(o.t); a.modelRevisions.push(`t=${o.t}: information state h → ${s > 0 ? '+' : '−'}`); } } }
      // choose u maximizing the worst-case (|d| ≤ 0.3) distance of the successor to the kernel boundary, under the current mode belief
      let best: -1 | 0 | 1 = 0, bm = -Infinity;
      for (const u of [0, -1, 1] as const) { const m = Math.min(...[-0.3, 0.3].map((d) => { const xn = W1.a * o.x + W1.b * hs * u + d; return Math.min(xn - lo, hi - xn); })); a.evaluations++; if (m > bm + 1e-12) { bm = m; best = u; } }
      px = o.x; pu = best; return { u: best };
    }, hEstimate: () => (withEstimate ? hs : null) };
  return a;
}

// ------------------------------------------------------------------ Ziran / Xeno adapter
/**
 * Uses the v0.3.0 observation-revision logic: an aliasing record is created when two observation-histories with
 * the same quantized reading and the same intervention diverge; candidate apparatus changes are profiled and passed
 * to v0.3.0 `paretoFront` / `selectFrom` (default policy pareto-min-loss, origin recorded). Transformation for the
 * comparison: v0.3.0 evaluates candidates by lookahead on retained *physical* snapshots; that is privileged access
 * no baseline has, so here candidates are evaluated only on the adapter's own retained observation history.
 */
function ziranAgent(o0: { revise: boolean; policy?: 'pareto-min-loss' | 'cheapest' | 'none'; forceSensor?: boolean }): W1Agent {
  const table = new Map<string, number[]>(); let px: number | null = null, pu: -1 | 0 | 1 = 0; let mode: 'initial' | 'constructed' | 'h-sensor' = 'initial'; let hs = 1; let aliasAt: number | null = null; const hist: { x: number; u: number; nx: number }[] = [];
  let paretoLog: unknown = null;
  const a: W1Agent = { detections: [], modelRevisions: [], apparatusChanges: [], evaluations: 0, memory: 0,
    act(o) {
      let install: 'h' | undefined;
      if (px !== null) {
        hist.push({ x: px, u: pu, nx: o.x });
        if (pu !== 0) {
          const key = `${Math.round(px * 5)}|${pu}`; const resp = o.x - W1.a * px; const v = table.get(key) ?? []; v.push(resp); table.set(key, v);
          if (aliasAt === null && v.length >= 2 && Math.max(...v) - Math.min(...v) > 4 * W1.sd && Math.sign(Math.max(...v)) !== Math.sign(Math.min(...v))) {
            aliasAt = o.t; a.detections!.push(o.t); // an aliasing record is a detection, not a model revision
            if (o0.revise) {
              // candidates, profiled on retained observation history only
              const informative = hist.filter((r) => r.u !== 0);
              const constructedSeparates = informative.length >= 2 && new Set(informative.map((r) => Math.sign((r.nx - W1.a * r.x) * r.u))).size > 1;
              const mk = (kind: string, description: string, cost: number, resolves: boolean | null, gained: string[], delayed: string[]): CandidateProfile => ({ kind, description, cost, resolves, aliasesResolved: resolves ? 1 : 0, lostObservability: [], newObservability: gained, resourceCost: cost, fragility: { blockedDelta: 0, resourcesDepleted: cost > 3 ? ['energy'] : [] }, reachabilityChange: [], delayedConsequences: delayed, descriptionSpaceChange: gained.map((g) => `+channel ${g}`), pareto: false, selected: false, evaluated: 'static-only' });
              const cands = [
                mk('placement', 'install h sensor', W1.hInstall + W1.hRun * (W1.horizon - o.t), null, ['h'], []),
                mk('construct-diff', 'constructed variable: sign of last response (x − a·x_prev)·u from memory', 0, constructedSeparates, ['response-sign'], ['available only after a non-zero intervention']),
                mk('resolution', 'increase x resolution', 0.5, false, [], []),
              ];
              const axes = resolveAxes(['alias-resolution', 'resource-cost', 'delay', 'new-observability', 'lost-observability']);
              paretoFront(cands, axes); const sel = selectFrom(cands, o0.policy ?? 'pareto-min-loss', axes);
              for (const c of sel) c.selected = true;
              paretoLog = { candidates: cands.map((c) => ({ description: c.description, resolves: c.resolves, cost: round(c.resourceCost), pareto: c.pareto, selected: c.selected })), policy: o0.policy ?? 'pareto-min-loss', policyOrigin: 'external' };
              const s = o0.forceSensor ? cands[0] : sel[0];
              if (s?.kind === 'construct-diff') { mode = 'constructed'; a.apparatusChanges.push(`t=${o.t}: constructed channel response-sign (from memory)`); }
              else if (s?.kind === 'placement') { mode = 'h-sensor'; install = 'h'; a.apparatusChanges.push(`t=${o.t}: install h sensor`); }
            }
          }
        }
        if (mode === 'constructed' && pu !== 0) { const r = o.x - W1.a * px; if (Math.abs(r) > 0.25) { const s = Math.sign(r * pu); if (s !== hs) { hs = s; a.modelRevisions.push(`t=${o.t}: response-sign channel → h ${s > 0 ? '+' : '−'}`); } } }
      }
      if (mode === 'h-sensor' && o.h !== undefined) hs = o.h;
      const r = mpc(o.x, W1.b * hs); a.evaluations += r.evals + 1; a.memory = hist.length * 3;
      px = o.x; pu = r.u; return { u: r.u, install };
    }, hEstimate: () => (o0.revise ? hs : null), extra: () => ({ pareto: paretoLog, observationMode: mode }) };
  return a;
}

// ------------------------------------------------------------------ evaluation
interface RunOut { success: number; energy: number; detections: number[] | null; latencyPerFlip: (number | null)[]; behaviouralLatency: (number | null)[]; latencyKind: string; reach: number; installs: string[]; modelRevisions: string[]; apparatusChanges: string[]; evaluations: number; memory: number; extra: Record<string, unknown> }

function runW1(agent: W1Agent, seed: number): RunOut {
  const env = new W1Env(seed); let o = env.obs(); let inBand = 0, n = 0, reach = 0;
  const hLog: (number | null)[] = [], hTrue: number[] = [], acts: number[] = [], xTrue: number[] = [];
  for (let t = 0; t < W1.horizon; t++) {
    xTrue.push(env.x); hTrue.push(env.h);
    const act = agent.act(o); acts.push(act.u); o = env.step(act); hLog.push(agent.hEstimate());
    if (env.t >= W1.evalFrom) { n++; if (Math.abs(env.x) < W1.band) inBand++; if (env.bandReachable()) reach++; }
  }
  const represents = agent.hEstimate() !== null;
  // estimate-based latency (frameworks with a mode estimate): first t ≥ flip with the estimate correct 3 steps in a row
  const estLat = env.flips.map((f) => { if (!represents) return null; for (let t = f; t < W1.horizon - 2; t++) if (hLog[t] === hTrue[t] && hLog[t + 1] === hTrue[t + 1] && hLog[t + 2] === hTrue[t + 2]) return t - f; return null; });
  // behavioural latency (all frameworks, same definition): first t ≥ flip after which 3 consecutive non-zero actions push x toward 0 in the true dynamics
  const behLat = env.flips.map((f) => { let c = 0; for (let t = f; t < W1.horizon; t++) { if (acts[t] === 0) continue; const good = Math.sign(W1.b * hTrue[t] * acts[t]) === -Math.sign(xTrue[t]); c = good ? c + 1 : 0; if (c >= 3) return t - f; } return null; });
  return { success: inBand / n, energy: env.energyUsed, detections: agent.detections, latencyPerFlip: estLat, behaviouralLatency: behLat, latencyKind: represents ? 'estimate-based (framework mode estimate correct 3 steps in a row)' : 'not represented (framework has no mode estimate)', reach: reach / n, installs: env.installLog.map((l) => `${l.sensor}@${l.t}`), modelRevisions: agent.modelRevisions, apparatusChanges: agent.apparatusChanges, evaluations: agent.evaluations, memory: agent.memory, extra: agent.extra?.() ?? {} };
}

interface Config { framework: ComparisonRecord['framework']; configuration: string; role: ComparisonRecord['role']; make: (seed: number) => { agent: W1Agent; dataSteps: number }; describe: (rec: ComparisonRecord) => void }

const RLTRAIN = new Map<string, { Q: QTable; steps: number }>();
const rlMake = (mode: RLMode, episodes = W1.trainEpisodes) => (seed: number) => { const k = `${mode}|${seed}|${episodes}`; if (!RLTRAIN.has(k)) RLTRAIN.set(k, trainRL(mode, seed, episodes)); const tr = RLTRAIN.get(k)!; const Q = new QTable(tr.Q.nActions, tr.Q.alpha, tr.Q.gamma); for (const [s, v] of tr.Q.Q) Q.Q.set(s, [...v]); return { agent: rlAgent(mode, Q, seed), dataSteps: tr.steps }; };

const NOMINAL = { item: 'dynamics' as const, supplied: 'nominal model x\' = 0.9x + 0.4u (valid in the initial mode h=+1)', enabled: 'immediate regulation in the initial mode', prevented: 'nothing by itself; the mode is outside the model', wrongWhen: 'after each flip the supplied gain has the wrong sign' };
const ACTIONS = { item: 'action-set' as const, supplied: 'u ∈ {−1,0,+1} (and sensor installation, available to every framework)', enabled: 'finite enumeration', prevented: 'continuous control' };

export const W1_CONFIGS: Config[] = [
  { framework: 'control-mpc', configuration: 'nominal-MPC (H=4, supplied model)', role: 'primary', make: () => ({ agent: nominalMPC(), dataSteps: 0 }),
    describe: (r) => { r.representationSupplied = ['state x', 'nominal dynamics', 'quadratic objective', 'horizon 4']; r.burden = [NOMINAL, ACTIONS, { item: 'goals', supplied: 'objective Σx² + 0.01|u|', enabled: 'regulation', prevented: '—' }]; r.profile.cannotExpress = ['mode-dependent gain (not in model)']; r.profile.requiresPredefined = ['dynamics', 'objective']; } },
  { framework: 'control-mpc', configuration: 'adaptive-MPC (RLS gain estimate, forgetting 0.85)', role: 'primary', make: () => ({ agent: adaptiveMPC(), dataSteps: 0 }),
    describe: (r) => { r.representationSupplied = ['state x', 'model structure x\' = a x + β u with a supplied', 'objective', 'estimator']; r.representationGenerated = ['online estimate of β']; r.burden = [{ ...NOMINAL, wrongWhen: 'recovered by re-estimating β; requires u ≠ 0 (persistent excitation)' }, ACTIONS]; r.profile.canRevise = ['gain parameter β']; r.profile.merges = ['mode h and gain magnitude into one parameter β']; r.profile.requiresPredefined = ['model structure', 'a']; } },
  { framework: 'reinforcement-learning', configuration: 'tabular Q, fixed state (x bin)', role: 'primary', make: rlMake('fixed-state'),
    describe: (r) => { r.representationSupplied = ['state encoding: 9 x-bins', 'reward −x² − 0.5·energy', 'actions {−1,0,+1}']; r.representationGenerated = ['Q-values']; r.burden = [{ item: 'state-variables', supplied: '9 x bins', enabled: 'tabular learning', prevented: 'distinguishing states aliased under x', wrongWhen: 'the optimal action differs between aliased states; one Q-row must serve both' }, { item: 'reward', supplied: '−x² − 0.5·Δenergy', enabled: 'learning', prevented: '—' }, ACTIONS]; r.profile.merges = ['states with equal x bin and different h']; r.profile.cannotExpress = ['the mode h (not in state)']; } },
  { framework: 'reinforcement-learning', configuration: 'tabular Q, history-augmented state (x bin, last u, sign Δx)', role: 'fairness', make: rlMake('history-state'),
    describe: (r) => { r.representationSupplied = ['state: x bin × last action × sign of last change', 'reward', 'actions']; r.representationGenerated = ['Q-values']; r.burden = [{ item: 'state-variables', supplied: 'history features chosen by the designer', enabled: 'implicit mode inference from response', prevented: '—' }, ACTIONS]; r.profile.preserves = ['response-to-action history']; } },
  { framework: 'reinforcement-learning', configuration: 'tabular Q with sensor-installation action', role: 'fairness', make: rlMake('sensor-action'),
    describe: (r) => { r.representationSupplied = ['state: x bin × h reading if installed', 'reward incl. energy', 'actions incl. install h']; r.burden = [{ item: 'action-set', supplied: 'install-h added to the action set', enabled: 'learning whether sensing pays', prevented: '—' }]; r.profile.canRevise = ['observation (if the learned policy installs)']; } },
  { framework: 'active-inference', configuration: 'discrete AIF with hidden mode factor h (EFE, 2-step policies)', role: 'primary', make: () => ({ agent: aifAgent(true), dataSteps: 0 }),
    describe: (r) => { r.representationSupplied = ['generative model: hidden h with switching prior 0.01', 'likelihood N(a x + b h u, σ)', 'preferences over x bins and energy', 'policy space (2 steps, optional sensing)']; r.representationGenerated = ['posterior beliefs over h']; r.burden = [{ item: 'hidden-factors', supplied: 'mode h ∈ {+,−} and its switching rate', enabled: 'belief updating about the mode; epistemic value of sensing', prevented: '—', wrongWhen: 'not tested (see fairness row without the factor)' }, { item: 'preferences', supplied: 'ln P̃(x) ∝ −(x/0.5)², energy weight 0.5', enabled: 'risk term', prevented: '—' }]; r.profile.preserves = ['uncertainty about h']; r.profile.canRevise = ['beliefs', 'observation (sensor installation through EFE)']; r.profile.requiresPredefined = ['state space incl. h', 'likelihood', 'preferences']; } },
  { framework: 'active-inference', configuration: 'discrete AIF without mode factor', role: 'fairness', make: () => ({ agent: aifAgent(false), dataSteps: 0 }),
    describe: (r) => { r.representationSupplied = ['generative model without h']; r.burden = [{ item: 'hidden-factors', supplied: 'none', enabled: '—', prevented: 'any representation of the mode', wrongWhen: 'after a flip the model predicts the wrong response sign' }]; r.profile.cannotExpress = ['h']; } },
  { framework: 'digital-twin', configuration: 'twin: Kalman sync + event-triggered parameter recalibration', role: 'primary', make: () => ({ agent: digitalTwin(false), dataSteps: 0 }),
    describe: (r) => { r.representationSupplied = ['physical state x ↔ digital x̂', 'nominal model', 'sensor feed x', 'innovation test NIS > 6.6 ×3']; r.representationGenerated = ['recalibrated gain']; r.burden = [NOMINAL, { item: 'observation-model', supplied: 'z = x + v', enabled: 'synchronization', prevented: 'nothing observes h' }]; r.profile.canRevise = ['state values', 'model parameters']; r.profile.cannotExpress = ['variable structure change', 'observation structure change (fixed sensor set)']; } },
  { framework: 'digital-twin', configuration: 'twin with interacting-multiple-model (two modes)', role: 'fairness', make: () => ({ agent: digitalTwin(true), dataSteps: 0 }),
    describe: (r) => { r.representationSupplied = ['two-mode model (±b) with Markov switching']; r.representationGenerated = ['mode probabilities']; r.burden = [{ item: 'hidden-factors', supplied: 'mode set {+b, −b} (designer extension)', enabled: 'mode tracking', prevented: '—' }]; r.profile.canRevise = ['state values', 'mode probabilities']; } },
  { framework: 'viability-reachability', configuration: 'viability-kernel safe controller (mode fixed at +)', role: 'primary', make: () => ({ agent: viabilityAgent(false), dataSteps: 0 }),
    describe: (r) => { r.representationSupplied = ['constraint set |x| < 0.5', 'bounded disturbance |d| ≤ 0.3 (assumption)', 'dynamics', 'grid 0.005']; r.representationGenerated = ['viability kernel (known mode)', 'robust kernel over both modes']; r.burden = [NOMINAL, { item: 'boundary', supplied: 'safe set and disturbance bound', enabled: 'guarantee statements', prevented: 'Gaussian tails are outside the bound' }]; r.profile.preserves = ['exact set-valued guarantees under the stated bound']; r.profile.cannotExpress = ['observation-apparatus change without an information-state extension']; } },
  { framework: 'viability-reachability', configuration: 'viability controller with information state (mode estimate from response)', role: 'fairness', make: () => ({ agent: viabilityAgent(true), dataSteps: 0 }),
    describe: (r) => { r.representationSupplied = ['kernel + mode estimate from response sign']; r.burden = [{ item: 'other', supplied: 'information-state extension', enabled: 'mode-dependent safe action', prevented: '—' }]; } },
  { framework: 'ziran-xeno', configuration: 'Ziran / Xeno adapter (aliasing → Pareto observation revision, policy pareto-min-loss)', role: 'primary', make: () => ({ agent: ziranAgent({ revise: true }), dataSteps: 0 }),
    describe: (r) => { r.representationSupplied = ['nominal model (same as MPC)', 'shared MPC planner', 'candidate generators (sensor, constructed variable, resolution)', 'Pareto axes (v0.3.0)']; r.representationGenerated = ['aliasing record', 'constructed or installed channel']; r.burden = [NOMINAL, { item: 'observation-model', supplied: 'candidate apparatus changes', enabled: 'observation revision', prevented: 'candidates outside the generator set' }]; r.profile.canRevise = ['observation apparatus', 'mode estimate via the revised channel']; r.profile.requiresPredefined = ['candidate generators', 'Pareto axes', 'selection policy']; } },
  { framework: 'ziran-xeno', configuration: 'ablation: no observation revision', role: 'ablation', make: () => ({ agent: ziranAgent({ revise: false }), dataSteps: 0 }),
    describe: (r) => { r.representationSupplied = ['as primary, reviser disabled']; r.burden = [NOMINAL]; } },
  { framework: 'ziran-xeno', configuration: 'selection override: install h sensor (not a v0.3.0 policy)', role: 'fairness', make: () => ({ agent: ziranAgent({ revise: true, forceSensor: true }), dataSteps: 0 }),
    describe: (r) => { r.representationSupplied = ['as primary; the untestable sensor candidate is selected by override']; r.notes.push('v0.3.0 selectFrom never selects candidates whose resolution is untestable on retained data; this override tests what that rule costs or saves.'); } },
  { framework: 'reinforcement-learning', configuration: 'tabular Q fixed state, 10× training data (unmatched)', role: 'budget-sensitivity', make: rlMake('fixed-state', W1.trainEpisodes * 10),
    describe: (r) => { r.representationSupplied = ['as fixed-state RL']; r.notes.push('Unmatched data budget: 10× the matched training steps. Reported only to show budget sensitivity.'); } },
];

export function runWorld1(seeds = W1_SEEDS): WorldResult {
  const records: ComparisonRecord[] = [];
  for (const c of W1_CONFIGS) {
    const t0 = performance.now(); const outs: RunOut[] = []; let data = 0;
    for (const s of seeds) { const { agent, dataSteps } = c.make(s); data = dataSteps; outs.push(runW1(agent, s)); }
    const ms = performance.now() - t0;
    const r = baseRecord('W1-observation-aliasing', c.framework, c.configuration, c.role);
    c.describe(r);
    const det = outs.map((o) => o.detections);
    const represented = det.every((d) => d !== null);
    const lat = outs.flatMap((o) => o.latencyPerFlip).filter((x): x is number => x !== null);
    const missed = outs.flatMap((o) => o.latencyPerFlip).filter((x) => x === null).length;
    r.observationsSupplied = ['x (noise σ=0.02)'];
    r.observationsRevised = [...new Set(outs.flatMap((o) => o.apparatusChanges.map((s) => s.replace(/^t=\d+: /, ''))))];
    r.interventions = ['u ∈ {−1,0,+1} each step'];
    r.detectedDifferences = represented ? [`mode change registered in ${det.filter((d) => d!.length).length}/${seeds.length} runs`] : [];
    r.inaccessibleDifferences = represented ? [] : ['mode h (no representation)'];
    const bl = outs.flatMap((o) => o.behaviouralLatency).filter((x): x is number => x !== null);
    r.timing = { meanBehaviouralLatency: bl.length ? round(mean(bl), 2) : null, flipsWithoutBehaviouralRecovery: outs.flatMap((o) => o.behaviouralLatency).filter((x) => x === null).length, meanLatencyAfterFlip: lat.length ? round(mean(lat), 2) : null, flipsNeverTracked: represented ? missed : null, firstDetection: represented ? round(mean(det.map((d) => d![0] ?? NaN).filter(Number.isFinite)), 1) : null, latencyKind: outs[0].latencyKind };
    r.resourceUse = { energyUsed: round(mean(outs.map((o) => o.energy)), 3) };
    r.modelRevisions = outs[0].modelRevisions.slice(0, 6);
    r.reorganization = [...new Set(outs.flatMap((o) => o.installs))].slice(0, 6);
    r.measurements = {
      aliasingDetected: represented ? det.some((d) => d!.length > 0) : null,
      modelChanged: outs.some((o) => o.modelRevisions.length > 0),
      apparatusChanged: outs.some((o) => o.apparatusChanges.length > 0),
      detectionLatencyMean: r.timing.meanLatencyAfterFlip as number | null,
      behaviouralLatencyMean: r.timing.meanBehaviouralLatency as number | null,
      interventionSuccess: round(mean(outs.map((o) => o.success)), 3),
      interventionSuccessPerSeed: outs.map((o) => round(o.success, 3)),
      resourceCost: r.resourceUse.energyUsed,
      lostObservability: [],
      newObservability: [...new Set(outs.flatMap((o) => o.apparatusChanges.length ? o.apparatusChanges.map((s) => /h sensor/.test(s) ? 'h' : 'response-sign') : []))],
      downstreamReachability: round(mean(outs.map((o) => o.reach)), 3),
    };
    r.cost = { computeMs: round(ms, 1), modelEvaluations: Math.round(mean(outs.map((o) => o.evaluations))), dataSteps: data, observationsUsed: W1.horizon, interventionCount: W1.horizon, memoryItems: Math.round(mean(outs.map((o) => o.memory))), representationComplexity: null, note: 'per run (mean over seeds); computeMs covers all seeds incl. training' };
    r.conversions = [{ from: 'physical (x, h)', to: 'observation x', retained: ['x up to noise 0.02'], lost: ['h'], newlyAvailable: [], unresolved: [] }];
    if (c.framework === 'reinforcement-learning') r.conversions.push({ from: 'observation x', to: 'state x-bin', retained: ['coarse x'], lost: ['x within bin', ...(c.configuration.includes('fixed') ? ['action-response history'] : [])], newlyAvailable: c.configuration.includes('history') ? ['last action × sign of change'] : [], unresolved: [] });
    if (c.framework === 'active-inference') r.conversions.push({ from: 'observation x', to: 'outcome bins (19)', retained: ['x to 0.2'], lost: ['x within bin'], newlyAvailable: [], unresolved: [] });
    if (c.framework === 'ziran-xeno') { const ex = outs.find((o) => o.extra.pareto)?.extra; r.notes.push(`first revision record: ${JSON.stringify(ex?.pareto ?? null)}`); }
    if (c.framework === 'digital-twin') r.notes.push(`twin update profile (seed ${seeds[0]}): ${JSON.stringify(outs[0].extra)}`);
    if (c.framework === 'viability-reachability') { const k = viabilityKernel(false), rk = viabilityKernel(true); r.measurements.kernelKnownMode = k.kernel.length ? `[${k.kernel[0].toFixed(3)}, ${k.kernel.at(-1)!.toFixed(3)}]` : 'empty'; r.measurements.kernelRobustOverModes = rk.kernel.length ? `[${rk.kernel[0].toFixed(3)}, ${rk.kernel.at(-1)!.toFixed(3)}]` : 'empty'; }
    r.profile.detectsEarlier = []; r.profile.detectsLater = [];
    records.push(r);
  }
  // relative timing (earlier / later) is stated per pair against the Ziran primary, never aggregated
  const zp = records.find((r) => r.framework === 'ziran-xeno' && r.role === 'primary')!;
  for (const r of records) {
    const a = r.timing.meanBehaviouralLatency, b = zp.timing.meanBehaviouralLatency;
    if (r === zp || typeof a !== 'number' || typeof b !== 'number') continue;
    if (a < b - 1) { r.profile.detectsEarlier.push(`behavioural recovery after a flip (mean ${a} vs Ziran adapter ${b} steps)`); zp.profile.detectsLater.push(`behavioural recovery vs ${r.configuration}`); }
    else if (a > b + 1) { r.profile.detectsLater.push(`behavioural recovery after a flip (mean ${a} vs Ziran adapter ${b} steps)`); zp.profile.detectsEarlier.push(`behavioural recovery vs ${r.configuration}`); }
  }
  const byKey = (fw: string, part: string) => records.find((r) => r.framework === fw && r.configuration.includes(part));
  const fairness: FairnessCheck[] = [
    fair('mode h tracked', byKey('reinforcement-learning', 'fixed state (x bin)')!, byKey('reinforcement-learning', 'history-augmented')!, (r) => (r.measurements.interventionSuccess as number) , 'RL has no mode estimate; compared by intervention success instead'),
    fair('mode h tracked', byKey('active-inference', 'with hidden mode')!, byKey('active-inference', 'without mode')!, (r) => (r.measurements.interventionSuccess as number), 'reverse check: removing the factor'),
    fair('mode h tracked', byKey('digital-twin', 'Kalman')!, byKey('digital-twin', 'interacting-multiple-model')!, (r) => (r.measurements.interventionSuccess as number), 'standard IMM extension'),
    fair('mode h tracked', byKey('viability-reachability', 'mode fixed')!, byKey('viability-reachability', 'information state')!, (r) => (r.measurements.interventionSuccess as number), 'information-state extension'),
    fair('mode h tracked', byKey('control-mpc', 'nominal')!, byKey('control-mpc', 'adaptive')!, (r) => (r.measurements.interventionSuccess as number), 'adaptive control is standard'),
  ];
  const statements: string[] = [];
  for (const r of records) {
    statements.push(statement(r.configuration, r.framework, 'hidden-mode distinction (aliasing)', r.measurements.aliasingDetected as boolean | null, `intervention success ${r.measurements.interventionSuccess}, energy ${r.measurements.resourceCost}, mean latency ${r.timing.meanLatencyAfterFlip ?? 'n/a'}`));
  }
  const matched: MatchedConditions = {
    world: 'W1-observation-aliasing',
    inputData: 'same environment instances (seeds 1–5); RL additionally uses 20 training episodes (6000 steps) from seeds disjoint from evaluation; model-based frameworks use a supplied nominal model instead (recorded as burden)',
    initialConditions: 'x₀ ~ N(0, 0.2²) per seed, h₀ = +1, energy 20', interventionHistory: 'framework-chosen u each step; no scripted interventions', temporalHorizon: '300 steps', computationalBudget: 'not equalized; model evaluations and wall time recorded per framework', observationAvailability: 'x sensor for all; h sensor installable by any framework at cost 1 + 0.05/step', measurementResolution: 'x noise σ = 0.02', resourceConstraints: 'energy 20; actuation 0.02 per non-zero u', evaluationWindow: 't ∈ [20, 300)',
    sameness: [
      { framework: 'all', sameRawSource: true, samePreprocessing: true, sameObservation: true, sameStateRepresentation: false, sameIntervention: true, sameOperationalEffect: null, transformation: 'RL bins x into 9 states; AIF uses 19 outcome bins; twin filters x; others use the reading directly. Same intervention set; effects differ because policies differ.' },
      { framework: 'ziran-xeno', sameRawSource: true, samePreprocessing: true, sameObservation: true, sameStateRepresentation: false, sameIntervention: true, sameOperationalEffect: null, transformation: 'v0.3.0 lookahead on retained physical snapshots is replaced by evaluation on retained observation history (privileged access removed)' },
    ],
  };
  const distinctionTable = [
    distinctionRow('hidden mode represented', records, (r) => (r.measurements.aliasingDetected === null ? false : (r.measurements.aliasingDetected as boolean))),
    distinctionRow('observation apparatus revised', records, (r) => r.measurements.apparatusChanged as boolean),
    distinctionRow('model revised', records, (r) => r.measurements.modelChanged as boolean),
  ];
  const passive = W1_SEEDS.map((sd) => { const env = new W1Env(sd); let n = 0, ok = 0; for (let t = 0; t < W1.horizon; t++) { env.step({ u: 0 }); if (env.t >= W1.evalFrom) { n++; if (Math.abs(env.x) < W1.band) ok++; } } return ok / n; });
  const references = { passivePolicySuccess: round(mean(passive), 3), note: 'u ≡ 0 (no framework); the band is reachable passively most of the time, so gains above this reference measure what mode tracking adds' };
  return { references, world: 'W1-observation-aliasing', question: 'Two states identical under the initial apparatus diverge under the same intervention. Which frameworks register the distinction, how (model vs apparatus), how fast, and at what cost?', design: 'x′ = 0.9x + 0.4·h·u + N(0, 0.15²); h flips 3× at unknown times; h sensor installable by anyone.', matched, records, fairness, statements, distinctionTable, notApplicable: [{ framework: 'agent-based-modeling', reason: 'single regulated plant without a population or interaction network; an ABM formulation would reduce to one of the control or RL agents' }, { framework: 'dynamical-systems', reason: 'covered by the control and twin formulations (same linear switched system)' }], claimStatus: 'synthetic-world result' };
}

function fair(distinction: string, first: ComparisonRecord, alt: ComparisonRecord, metric: (r: ComparisonRecord) => number, note: string): FairnessCheck {
  const a = metric(first), b = metric(alt);
  return { distinction, firstConfiguration: `${first.framework}: ${first.configuration}`, alternativeConfiguration: `${alt.framework}: ${alt.configuration}`, alternativeTested: true, retainedUnderAlternative: alt.measurements.aliasingDetected === null ? b > a + 0.02 : (alt.measurements.aliasingDetected as boolean), note: `${note}; intervention success ${round(a, 3)} → ${round(b, 3)}` };
}
