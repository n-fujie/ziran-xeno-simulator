import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { hashOf } from '../core/hash.ts';
import { Ledger } from './store.ts';
import { unresolvedInterruptions } from './resume.ts';
import { acquire, configured, generate, measure, independentMeasurement, relation, CONDITIONS } from './protocol.ts';
import type { Condition, Pair, Proposal, Measurement } from './protocol.ts';

export const METHODS = ['fixed', 'adaptive', 'always', 'history', 'mismatched-history', 'no-history'] as const;
export type Method = typeof METHODS[number];
export interface CycleRequest { seed: number; condition: Condition; method: Method; budget: number; adoptionLimit: number; operationId?: string; historyPolicy?: 'synthetic-stress' }
export interface Assessment { candidate: string; partition: Pair['partition']; score: number; determinate: boolean; retainsX: boolean; relations: string[]; measurementIds: string[] }
export interface Decision { candidate: string; kinds: string[]; accepted: boolean; reason: string; score: number; cost: number }
export interface CycleResult {
  version: 2; id: string; request: CycleRequest; claimStatus: 'synthetic-world result'; state: 'completed' | 'quarantined';
  provenance: { protocol: string; grammar: string; adapter: 'simulated-engine-only'; historyRefs: string[]; incompatibleHistoryUsed: boolean };
  measurements: Measurement[]; assessments: Assessment[]; decisions: Decision[];
  generated: { id: string; kinds: string[]; parent?: string }[]; selected: string | null;
  generationRevision: { residual: number; expired: string[]; regenerated: string[] };
  connection: { connected: boolean; disconnected: boolean; physicalRecoveryVerified: false };
  snapshot: { target: Record<string, unknown>; apparatus: unknown; t: number; restoration: 'audit-only; no live device restored' };
  unexplained: boolean; finalScore: number | null; adoptionVerified: boolean;
  intervention: { action: number; before: number | null; after: number | null; expectedChange: number; actualChange: number | null; consistent: boolean; measurementIds: string[] } | null;
  reorganization: { apparatus: unknown; generationOrder: string[]; origin: string };
  failures: string[]; resources: { cpuUserMicros: number; cpuSystemMicros: number; wallMs: number; rankingMs: number; rankingCpuMicros: number; rankingComparisons: number; historyQueryMs: number; historyQueryCpuMicros: number; generationMs: number; decisionMs: number; generationCpuMicros: number; decisionCpuMicros: number; measurementCount: number; referenceMeasurements: number; generatedCandidates: number; evaluatedCandidates: number; adoptions: number; interventionOpportunities: number; interventions: number; operationUnits: number };
}
export const PROTOCOL = 'engine-scientific-cycle-v2';
export function parseRequest(value: unknown): CycleRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('expected cycle request');
  const v = value as Record<string, unknown>;
  for (const key of Object.keys(v)) if (!['seed', 'condition', 'method', 'budget', 'adoptionLimit', 'operationId', 'historyPolicy'].includes(key)) throw Error('unknown field: ' + key);
  const request = { seed: v.seed ?? 1, condition: v.condition ?? 'coupled', method: v.method ?? 'adaptive', budget: v.budget ?? 4, adoptionLimit: v.adoptionLimit ?? 1 } as CycleRequest;
  if (!Number.isSafeInteger(request.seed) || request.seed < 0 || request.seed > 0x7fffffff) throw Error('invalid seed');
  if (!CONDITIONS.includes(request.condition) || !METHODS.includes(request.method)) throw Error('unknown method or condition');
  if (!Number.isInteger(request.budget) || request.budget < 1 || request.budget > 8) throw Error('budget must be 1..8');
  if (request.adoptionLimit !== 0 && request.adoptionLimit !== 1) throw Error('adoptionLimit must be 0 or 1');
  if (v.operationId !== undefined) { if (typeof v.operationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(v.operationId)) throw Error('invalid operationId'); request.operationId = v.operationId; }
  if (v.historyPolicy !== undefined) { if (v.historyPolicy !== 'synthetic-stress' || request.method !== 'mismatched-history') throw Error('invalid historyPolicy'); request.historyPolicy = v.historyPolicy; }
  return request;
}

export type FaultPoint = 'after-prepare' | 'after-adoption' | 'after-connect' | 'after-intervention' | 'after-disconnect' | 'before-complete';
export interface RuntimeOptions {
  /** Opt-in. When true, a new operation is refused while any interrupted operation lacks a recorded, satisfied
   * resume assessment (see resume.ts). Off by default: nothing resumes or is blocked differently unless enabled. */
  requireResumeClearance?: boolean;
}
export class ScientificRuntime {
  readonly ledger: Ledger;
  private requireResumeClearance: boolean;
  constructor(ledger: Ledger, options: RuntimeOptions = {}) { this.ledger = ledger; this.requireResumeClearance = options.requireResumeClearance === true; }
  /** Whether this instance refuses new work while an interrupted operation lacks resume clearance. */
  get resumeClearanceRequired(): boolean { return this.requireResumeClearance; }
  recover() { this.ledger.recoverDeadWriter(); return this.ledger.recover(); }
  run(input: unknown, fault?: (point: FaultPoint) => void): CycleResult {
    const request = parseRequest(input);
    return this.ledger.exclusive(() => {
      const entries = this.ledger.read();
      if (request.operationId) {
        const previous = entries.find((e) => e.kind === 'prepared' && e.operation === request.operationId);
        if (previous) {
          if (hashOf((previous.data as { request: unknown }).request) !== hashOf(request)) throw Error('operationId conflict');
          const terminal = entries.find((e) => e.operation === request.operationId && (e.kind === 'completed' || e.kind === 'quarantined'));
          if (!terminal) throw Error('operation pending; explicit recovery required');
          const result = terminal.data as CycleResult;
          if (result?.version !== 2) throw Error('operation quarantined; never replay');
          return result;
        }
      }
      const ended = new Set(entries.filter((e) => e.kind === 'completed' || e.kind === 'quarantined').map((e) => e.operation));
      if (entries.some((e) => e.kind === 'prepared' && !ended.has(e.operation))) throw Error('interrupted operation: explicit recovery required before running');
      if (this.requireResumeClearance && unresolvedInterruptions(entries).length) throw Error('interrupted operation lacks resume clearance; explicit resume assessment required');
      const id = request.operationId ?? randomUUID();
      const prepared = this.ledger.append('prepared', id, { request, protocol: PROTOCOL, adapter: 'simulated-engine-only' });
      try {
        fault?.('after-prepare');
        const queryStart = performance.now(), queryCpu = process.cpuUsage();
        const history = entries.filter((e) => e.kind === 'completed' || e.kind === 'quarantined').map((e) => ({ hash: e.hash, result: e.data as CycleResult }))
          .filter((e) => e.result?.version === 2 && e.result.provenance.protocol === PROTOCOL && e.result.request.seed !== request.seed && (request.method === 'mismatched-history' ? e.result.request.condition !== request.condition : e.result.request.condition === request.condition));
        // A bounded history query keeps ranking costs visible. All modes write identical record types.
        // Reproductions under new operation IDs are not extra independent target evidence.
        const unique = [...new Map(history.map((h) => [`${h.result.request.condition}:${h.result.request.seed}`, h])).values()];
        const used = request.method === 'history' || request.method === 'mismatched-history' ? unique.slice(-8) : [];
        const queryUsage = process.cpuUsage(queryCpu), queryMs = performance.now() - queryStart;
        const result = execute(id, request, used, fault, (phase, detail) => { this.ledger.append('event', id, { phase, detail, physicalRecoveryVerified: false }); });
        result.resources.historyQueryMs = queryMs; result.resources.historyQueryCpuMicros = queryUsage.user + queryUsage.system;
        fault?.('before-complete');
        const durableResult = JSON.parse(JSON.stringify(result)) as CycleResult;
        this.ledger.append(result.state === 'completed' ? 'completed' : 'quarantined', id, durableResult);
        return durableResult;
      } catch (error) {
        // Never claim an external effect was rolled back. If this write also fails, propagate the
        // storage failure; the prepared record stays pending and requires explicit recovery.
        this.ledger.append('quarantined', id, { reason: 'scientific operation interrupted; outcome requires isolation', prepared: prepared.hash, autoReplay: false, physicalRecoveryVerified: false });
        throw error;
      }
    });
  }
}

function execute(id: string, request: CycleRequest, history: { hash: string; result: CycleResult }[], fault?: (point: FaultPoint) => void, event: (phase: string, detail?: unknown) => void = () => {}): CycleResult {
  const start = performance.now(), cpu = process.cpuUsage();
  const historyRefs = history.map((h) => h.hash);
  const measurements: Measurement[] = [], assessments: Assessment[] = [], decisions: Decision[] = [];
  let measurementCount = 0;
  const acquisitionKeys = new Set<string>();
  const remember = (items: Measurement[]) => { for (const item of items) { if (acquisitionKeys.has(item.acquisitionKey)) throw Error('duplicate acquisition receipt'); acquisitionKeys.add(item.acquisitionKey); measurements.push(item); } };
  const collect = (engine: ReturnType<typeof configured>, pair: Pair, index: number, acquisition: string) => {
    const readings = measure(engine, pair, index, historyRefs, new Date().toISOString(), request.condition).map((m) => ({ ...m, id: `${id}:${acquisition}:${m.id}` }));
    remember(readings); measurementCount += readings.length;
    return readings;
  };
  // Acquire only the generation cohort before generation. Decision and evaluation targets do
  // not exist yet. No final scores are available to the selector.
  const generation = acquire(request.seed, 'generation', request.condition);
  const references = (pairs: Pair[]) => remember(pairs.flatMap((p) => p.referenceEvidence.map((m) => ({ ...m, id: `${id}:${m.id}`, historyRefs }))));
  references(generation);
  const assess = (pairs: Pair[], proposal?: Proposal): Assessment => {
    let correct = 0; const relations: string[] = [], measurementIds: string[] = [];
    let determinate = true, retainsX = true;
    for (const pair of pairs) {
      const readings = pair.engines.map((e, i) => {
        const engine = configured(e, proposal);
        retainsX &&= engine.apparatus.science.channels.some((channel) => channel.reads.includes('target/x'));
        return collect(engine, pair, i, `${pair.partition}:${proposal?.id ?? 'fixed'}`);
      });
      const observed = relation(readings[0], readings[1]); relations.push(observed);
      measurementIds.push(...readings.flatMap((r) => r.map((m) => m.id)));
      const referenceDiffers = Math.abs(pair.reference[0] - pair.reference[1]) > 1e-9;
      if (observed === 'undetermined') determinate = false;
      else if ((observed === 'difference') === referenceDiffers) correct++;
    }
    const assessment = { candidate: proposal?.id ?? 'fixed', partition: pairs[0].partition, score: correct / pairs.length, determinate, retainsX, relations, measurementIds };
    assessments.push(assessment); return assessment;
  };
  const baseline = assess(generation);
  const unexplained = baseline.determinate && baseline.score < 1;
  const generationStart = performance.now(), generationCpu = process.cpuUsage();
  const rejected = history.flatMap((h) => h.result.decisions.filter((d) => !d.accepted || h.result.state === 'quarantined').map((d) => d.candidate));
  let proposals = request.method === 'fixed' ? [] : generate(generation[0], { residual: 1 - baseline.score, rejected });
  const generationUsage = process.cpuUsage(generationCpu), generationMs = performance.now() - generationStart;
  const expired = [...new Set(history.flatMap((h) => h.result.generated.map((p) => p.id)))].filter((candidate) => !proposals.some((p) => p.id === candidate));
  const regenerated = proposals.filter((p) => p.revision).map((p) => p.id);
  const rankingStart = performance.now(), rankingCpu = process.cpuUsage(); let rankingComparisons = 0;
  const preference = new Map<string, number>();
  for (const previous of history) for (const d of previous.result.decisions) {
    preference.set(d.candidate, (preference.get(d.candidate) ?? 0) + (d.accepted && previous.result.adoptionVerified && previous.result.state === 'completed' ? 1 : -1));
  }
  // E is an explicitly labelled adverse-prior stress test, not trusted runtime history.
  // It has no additional target measurements; its synthetic prior favours a bad operation.
  if (request.historyPolicy === 'synthetic-stress') preference.set('external memory 0 → 1 frames', 100);
  proposals = proposals.sort((a, b) => { rankingComparisons++; return (preference.get(b.id) ?? 0) - (preference.get(a.id) ?? 0) || a.cost - b.cost || a.id.localeCompare(b.id); });
  const rankingMs = performance.now() - rankingStart;
  const rankingUsage = process.cpuUsage(rankingCpu);
  const search = request.method !== 'fixed' && (request.method === 'always' || unexplained);
  const finalists: Proposal[] = [];
  // Evaluate only within the common candidate cap. Static generation results do not decide adoption.
  const bounded = search ? proposals.slice(0, request.budget) : [];
  const decisionStart = performance.now(), decisionCpu = process.cpuUsage();
  for (const [slot, proposal] of bounded.entries()) {
    const decisionPairs = acquire(request.seed, 'decision', request.condition, 3, slot);
    references(decisionPairs);
    const result = assess(decisionPairs, proposal);
    const retainsX = result.retainsX;
    const challenge = decisionPairs.some((pair) => Math.abs(pair.reference[0] - pair.reference[1]) > 1e-9);
    const eligible = result.determinate && result.score === 1 && retainsX && challenge;
    const reason = !result.determinate ? 'measurement-undetermined' : result.score < 1 ? 'independent-validation-failed' : !retainsX ? 'loses-existing-target-channel' : !challenge ? 'no-discriminating-validation-challenge' : 'eligible';
    decisions.push({ candidate: proposal.id, kinds: proposal.kinds, accepted: false, reason, score: result.score, cost: proposal.cost });
    if (eligible) finalists.push(proposal);
  }
  const decisionUsage = process.cpuUsage(decisionCpu), decisionMs = performance.now() - decisionStart;
  const selected = request.adoptionLimit ? finalists.sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id))[0] : undefined;
  for (const decision of decisions) {
    if (decision.candidate === selected?.id) { decision.accepted = true; decision.reason = 'accepted-on-independent-decision-cohort'; }
    else if (decision.reason === 'eligible') decision.reason = request.adoptionLimit ? 'not-selected-within-adoption-cap' : 'adoption-disabled';
  }
  fault?.('after-adoption');
  const evaluation = acquire(request.seed, 'evaluation', request.condition);
  references(evaluation);
  const final = assess(evaluation, selected);
  const adoptionVerified = !!selected && final.determinate && final.score === 1 && evaluation.some((pair) => Math.abs(pair.reference[0] - pair.reference[1]) > 1e-9);
  const failures: string[] = [];
  if (search && !selected) failures.push('no-candidate-adopted');
  if (selected && !adoptionVerified) failures.push('post-adoption-measurement-failed');
  if (request.historyPolicy === 'synthetic-stress') failures.push('synthetic-incompatible-prior-stress-condition');
  let intervention: CycleResult['intervention'] = null;
  // A new control target is connected once, after sealed final evaluation. Never relabel
  // a final-evaluation snapshot as a fresh live connection or post-intervention acquisition.
  const control = acquire(request.seed, 'control', request.condition, 1);
  references(control);
  const connection = { connected: false, disconnected: false, physicalRecoveryVerified: false as const };
  const activated = adoptionVerified ? selected : undefined;
  if (activated) event('connect-issued', { target: control[0].id, targetIndex: 1, proposal: activated.id });
  const operational = configured(control[0].engines[1], activated);
  if (activated) { fault?.('after-connect'); connection.connected = true; event('connect-confirmed', { target: control[0].id, apparatusHash: hashOf(operational.apparatus.science) }); }
  const adoptedApparatus = structuredClone(operational.apparatus.science);
  const independent = (address: string) => {
    const reading = independentMeasurement(operational, control[0], 1, address, historyRefs);
    reading.id = `${id}:${reading.id}`; remember([reading]); return reading;
  };
  if (adoptionVerified) {
    // Control reads only the adopted apparatus. The reference probe is not available here.
    const hChannel = operational.apparatus.science.channels.find((c) => c.reads.length === 1 && c.reads[0] === 'target/h');
    const reading = hChannel ? operational.ctx(null).obs('science', hChannel.id) : undefined;
    const h = reading?.status === 'detected' && typeof reading.value === 'number' ? reading.value : null;
    const independentH = independent('target/h');
    if (h === null || !Number.isFinite(h) || h === 0 || independentH.status !== 'detected' || independentH.value !== h) failures.push('no-usable-control-measurement');
    else {
      const beforeReadings = collect(operational, control[0], 1, 'before-intervention');
      const beforeReference = independent('target/x');
      const before = beforeReference.status === 'detected' ? beforeReference.value : null;
      const action = -Math.sign(h);
      event('intervention-issued', { target: control[0].id, targetIndex: 1, action, expectedChange: h * action, address: 'target/u', t: 1, stopAt: 1.5 });
      operational.intervene({ id: 'science.measured-control', kind: 'set', t: 1, address: 'target/u', value: action });
      operational.intervene({ id: 'science.stop-control', kind: 'set', t: 1.5, address: 'target/u', value: 0 });
      operational.run(1);
      fault?.('after-intervention');
      // Engine sensors sample before rules at each tick. Observe the completed effect
      // at the next sample, after stopping the input between ticks.
      operational.run(2);
      const afterReadings = collect(operational, control[0], 1, 'after-intervention');
      const afterReference = independent('target/x');
      const after = afterReference.status === 'detected' ? afterReference.value : null;
      const actualChange = typeof before === 'number' && typeof after === 'number' ? after - before : null;
      const expectedChange = h * action;
      const cachedAfter = afterReadings.find((m) => m.channel === 'x');
      const consistent = actualChange !== null && Math.abs(actualChange - expectedChange) < 1e-8 && cachedAfter?.status === 'detected' && cachedAfter.value === after;
      intervention = { action, before: typeof before === 'number' ? before : null, after: typeof after === 'number' ? after : null, expectedChange, actualChange, consistent, measurementIds: [...beforeReadings, ...afterReadings, independentH, beforeReference, afterReference].map((m) => m.id) };
      event('intervention-remeasured', { target: control[0].id, actualChange, consistent, independentReceipt: afterReference.id });
      if (!consistent) failures.push('intervention-model-mismatch');
    }
  }
  if (activated) {
    event('disconnect-issued', { target: control[0].id, channels: operational.apparatus.science.channels.filter((c) => c.id !== 'x').map((c) => c.id) });
    operational.intervene({ id: 'science.disconnect', kind: 'emit', t: operational.t, apply: (_ctx, emit) => {
      for (const channel of operational.apparatus.science.channels) if (channel.id !== 'x') emit.apparatus.removeChannel('science', channel.id);
      emit.apparatus.patch('science', { memory: 0 });
    } });
    operational.run(operational.t); fault?.('after-disconnect');
    connection.disconnected = operational.apparatus.science.channels.every((c) => c.id === 'x');
    if (!connection.disconnected || operational.state['target/u'] !== 0) throw Error('disconnect/stop confirmation failed');
    event('disconnect-confirmed', { target: control[0].id, apparatusHash: hashOf(operational.apparatus.science), inputStopped: true });
  }
  const isolated = failures.some((f) => ['post-adoption-measurement-failed', 'intervention-model-mismatch', 'no-usable-control-measurement'].includes(f));
  const usage = process.cpuUsage(cpu);
  return {
    version: 2, id, request, claimStatus: 'synthetic-world result', state: isolated ? 'quarantined' : 'completed',
    provenance: { protocol: PROTOCOL, grammar: 'candidatesFor + residual-conditioned composition (supplied operations)', adapter: 'simulated-engine-only', historyRefs, incompatibleHistoryUsed: request.method === 'mismatched-history' && (history.length > 0 || request.historyPolicy === 'synthetic-stress') },
    measurements, assessments, decisions, generated: proposals.map((p) => ({ id: p.id, kinds: p.kinds, parent: p.parent })), selected: selected?.id ?? null,
    unexplained, finalScore: final.determinate ? final.score : null, adoptionVerified, intervention, connection,
    generationRevision: { residual: 1 - baseline.score, expired, regenerated },
    snapshot: { target: structuredClone(operational.state), apparatus: structuredClone(operational.apparatus.science), t: operational.t, restoration: 'audit-only; no live device restored' },
    reorganization: { apparatus: adoptedApparatus, generationOrder: proposals.map((p) => p.id), origin: history.length ? (request.method === 'mismatched-history' ? 'incompatible-history-stress' : 'bounded-compatible-history-feedback') : 'supplied-grammar-and-current-generation-measurements' },
    failures,
    resources: { cpuUserMicros: usage.user, cpuSystemMicros: usage.system, wallMs: performance.now() - start, rankingMs, rankingCpuMicros: rankingUsage.user + rankingUsage.system, rankingComparisons, historyQueryMs: 0, historyQueryCpuMicros: 0, generationMs, decisionMs,
      generationCpuMicros: generationUsage.user + generationUsage.system, decisionCpuMicros: decisionUsage.user + decisionUsage.system, measurementCount,
      referenceMeasurements: measurements.length - measurementCount, generatedCandidates: proposals.length, evaluatedCandidates: bounded.length, adoptions: selected ? 1 : 0, interventionOpportunities: 1, interventions: intervention ? 1 : 0,
      operationUnits: measurements.length + proposals.length + bounded.length + rankingComparisons },
  };
}

/** Exclude machine timing and acquisition identifiers, not scientific outcomes, from reproducibility. */
export function scientificFingerprint(result: CycleResult): string {
  return hashOf({ request: result.request, selected: result.selected, decisions: result.decisions, assessments: result.assessments.map(({ measurementIds: _ids, ...rest }) => rest),
    finalScore: result.finalScore, adoptionVerified: result.adoptionVerified, failures: result.failures,
    measurements: result.measurements.map(({ id: _id, acquiredAt: _at, historyRefs: _refs, ...rest }) => rest),
    intervention: result.intervention && { ...result.intervention, measurementIds: [] }, reorganization: result.reorganization,
    connection: result.connection, generationRevision: result.generationRevision, snapshot: result.snapshot,
    resources: { ...result.resources, cpuUserMicros: 0, cpuSystemMicros: 0, wallMs: 0, rankingMs: 0, rankingCpuMicros: 0, historyQueryMs: 0, historyQueryCpuMicros: 0, generationMs: 0, decisionMs: 0, generationCpuMicros: 0, decisionCpuMicros: 0 } });
}
