import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { hashOf } from '../core/hash.ts';
import { Ledger } from './store.ts';
import { acquire, configured, generate, measure, relation, CONDITIONS } from './protocol.ts';
import type { Condition, Pair, Proposal, Measurement } from './protocol.ts';

export const METHODS = ['fixed', 'adaptive', 'always', 'history', 'mismatched-history', 'no-history'] as const;
export type Method = typeof METHODS[number];
export interface CycleRequest { seed: number; condition: Condition; method: Method; budget: number; adoptionLimit: number }
export interface Assessment { candidate: string; partition: Pair['partition']; score: number; determinate: boolean; retainsX: boolean; relations: string[]; measurementIds: string[] }
export interface Decision { candidate: string; kinds: string[]; accepted: boolean; reason: string; score: number; cost: number }
export interface CycleResult {
  version: 1; id: string; request: CycleRequest; claimStatus: 'synthetic-world result'; state: 'completed' | 'quarantined';
  provenance: { protocol: string; grammar: string; adapter: 'simulated-engine-only'; historyRefs: string[]; incompatibleHistoryUsed: boolean };
  measurements: Measurement[]; assessments: Assessment[]; decisions: Decision[];
  generated: { id: string; kinds: string[]; parent?: string }[]; selected: string | null;
  unexplained: boolean; finalScore: number | null; adoptionVerified: boolean;
  intervention: { action: number; before: number | null; after: number | null; expectedChange: number; actualChange: number | null; consistent: boolean; measurementIds: string[] } | null;
  reorganization: { apparatus: unknown; generationOrder: string[]; origin: string };
  failures: string[]; resources: { cpuUserMicros: number; cpuSystemMicros: number; wallMs: number; rankingMs: number; measurementCount: number; referenceMeasurements: number; evaluatedCandidates: number; adoptions: number; interventionOpportunities: number; interventions: number; operationUnits: number };
}
export const PROTOCOL = 'engine-scientific-cycle-v1';
export function parseRequest(value: unknown): CycleRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('expected cycle request');
  const v = value as Record<string, unknown>;
  for (const key of Object.keys(v)) if (!['seed', 'condition', 'method', 'budget', 'adoptionLimit'].includes(key)) throw Error('unknown field: ' + key);
  const request = { seed: v.seed ?? 1, condition: v.condition ?? 'coupled', method: v.method ?? 'adaptive', budget: v.budget ?? 4, adoptionLimit: v.adoptionLimit ?? 1 } as CycleRequest;
  if (!Number.isSafeInteger(request.seed) || request.seed < 0 || request.seed > 0x7fffffff) throw Error('invalid seed');
  if (!CONDITIONS.includes(request.condition) || !METHODS.includes(request.method)) throw Error('unknown method or condition');
  if (!Number.isInteger(request.budget) || request.budget < 1 || request.budget > 8) throw Error('budget must be 1..8');
  if (request.adoptionLimit !== 0 && request.adoptionLimit !== 1) throw Error('adoptionLimit must be 0 or 1');
  return request;
}

export type FaultPoint = 'after-prepare' | 'after-adoption' | 'after-intervention' | 'before-complete';
export class ScientificRuntime {
  readonly ledger: Ledger;
  constructor(ledger: Ledger) { this.ledger = ledger; }
  recover() { this.ledger.recoverDeadWriter(); return this.ledger.recover(); }
  run(input: unknown, fault?: (point: FaultPoint) => void): CycleResult {
    const request = parseRequest(input);
    return this.ledger.exclusive(() => {
      const entries = this.ledger.read();
      const ended = new Set(entries.filter((e) => e.kind !== 'prepared').map((e) => e.operation));
      if (entries.some((e) => e.kind === 'prepared' && !ended.has(e.operation))) throw Error('interrupted operation: explicit recovery required before running');
      const id = randomUUID();
      const prepared = this.ledger.append('prepared', id, { request, protocol: PROTOCOL, adapter: 'simulated-engine-only' });
      try {
        fault?.('after-prepare');
        const history = entries.filter((e) => e.kind !== 'prepared').map((e) => ({ hash: e.hash, result: e.data as CycleResult }))
          .filter((e) => e.result?.version === 1 && e.result.provenance.protocol === PROTOCOL && e.result.request.condition === request.condition);
        // A bounded history query keeps ranking costs visible. All modes write identical record types.
        const used = request.method === 'history' ? history.slice(-8) : [];
        const result = execute(id, request, used, fault);
        fault?.('before-complete');
        this.ledger.append(result.state === 'completed' ? 'completed' : 'quarantined', id, result);
        return result;
      } catch (error) {
        // Never claim an external effect was rolled back. If this write also fails, propagate the
        // storage failure; the prepared record stays pending and requires explicit recovery.
        this.ledger.append('quarantined', id, { reason: String(error), prepared: prepared.hash, autoReplay: false });
        throw error;
      }
    });
  }
}

function execute(id: string, request: CycleRequest, history: { hash: string; result: CycleResult }[], fault?: (point: FaultPoint) => void): CycleResult {
  const start = performance.now(), cpu = process.cpuUsage();
  const historyRefs = history.map((h) => h.hash);
  const measurements: Measurement[] = [], assessments: Assessment[] = [], decisions: Decision[] = [];
  let measurementCount = 0;
  const collect = (engine: ReturnType<typeof configured>, pair: Pair, index: number, acquisition: string) => {
    const readings = measure(engine, pair, index, historyRefs, new Date().toISOString(), request.condition).map((m) => ({ ...m, id: `${id}:${acquisition}:${m.id}` }));
    measurements.push(...readings); measurementCount += readings.length;
    return readings;
  };
  // Acquire only the generation cohort before generation. Decision and evaluation targets do
  // not exist yet. No final scores are available to the selector.
  const generation = acquire(request.seed, 'generation', request.condition);
  const references = (pairs: Pair[]) => measurements.push(...pairs.flatMap((p) => p.referenceEvidence.map((m) => ({ ...m, id: `${id}:${m.id}`, historyRefs }))));
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
  let proposals = request.method === 'fixed' ? [] : generate(generation[0]);
  const rankingStart = performance.now();
  const preference = new Map<string, number>();
  for (const previous of history) for (const d of previous.result.decisions) {
    preference.set(d.candidate, (preference.get(d.candidate) ?? 0) + (d.accepted && previous.result.adoptionVerified && previous.result.state === 'completed' ? 1 : -1));
  }
  // E is an explicitly labelled adverse-prior stress test, not trusted runtime history.
  // It has no additional target measurements; its synthetic prior favours a bad operation.
  if (request.method === 'mismatched-history') preference.set('external memory 0 → 1 frames', 100);
  proposals = proposals.sort((a, b) => (preference.get(b.id) ?? 0) - (preference.get(a.id) ?? 0) || a.cost - b.cost || a.id.localeCompare(b.id));
  const rankingMs = performance.now() - rankingStart;
  const search = request.method !== 'fixed' && (request.method === 'always' || unexplained);
  const finalists: Proposal[] = [];
  // Evaluate only within the common candidate cap. Static generation results do not decide adoption.
  const bounded = search ? proposals.slice(0, request.budget) : [];
  const decisionPairs = acquire(request.seed, 'decision', request.condition);
  references(decisionPairs);
  for (const proposal of bounded) {
    const result = assess(decisionPairs, proposal);
    const retainsX = result.retainsX;
    const challenge = decisionPairs.some((pair) => Math.abs(pair.reference[0] - pair.reference[1]) > 1e-9);
    const eligible = result.determinate && result.score === 1 && retainsX && challenge;
    const reason = !result.determinate ? 'measurement-undetermined' : result.score < 1 ? 'independent-validation-failed' : !retainsX ? 'loses-existing-target-channel' : !challenge ? 'no-discriminating-validation-challenge' : 'eligible';
    decisions.push({ candidate: proposal.id, kinds: proposal.kinds, accepted: false, reason, score: result.score, cost: proposal.cost });
    if (eligible) finalists.push(proposal);
  }
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
  if (request.method === 'mismatched-history') failures.push('synthetic-incompatible-prior-stress-condition');
  let intervention: CycleResult['intervention'] = null;
  const operational = configured(evaluation[0].engines[1], selected);
  if (adoptionVerified) {
    // Control reads only the adopted apparatus. The reference probe is not available here.
    const hChannel = operational.apparatus.science.channels.find((c) => c.reads.length === 1 && c.reads[0] === 'target/h');
    const reading = hChannel ? operational.ctx(null).obs('science', hChannel.id) : undefined;
    const h = reading?.status === 'detected' && typeof reading.value === 'number' ? reading.value : null;
    if (h === null || !Number.isFinite(h) || h === 0) failures.push('no-usable-control-measurement');
    else {
      const beforeReadings = collect(operational, evaluation[0], 1, 'before-intervention');
      const before = beforeReadings.find((m) => m.channel === 'x' && m.status === 'detected')?.value;
      const action = -Math.sign(h);
      operational.intervene({ id: 'science.measured-control', kind: 'set', t: 1, address: 'target/u', value: action });
      operational.intervene({ id: 'science.stop-control', kind: 'set', t: 1.5, address: 'target/u', value: 0 });
      operational.run(1);
      fault?.('after-intervention');
      // Engine sensors sample before rules at each tick. Observe the completed effect
      // at the next sample, after stopping the input between ticks.
      operational.run(2);
      const afterReadings = collect(operational, evaluation[0], 1, 'after-intervention');
      const after = afterReadings.find((m) => m.channel === 'x' && m.status === 'detected')?.value;
      const actualChange = typeof before === 'number' && typeof after === 'number' ? after - before : null;
      const expectedChange = h * action;
      const consistent = actualChange !== null && Math.abs(actualChange - expectedChange) < 1e-8;
      intervention = { action, before: typeof before === 'number' ? before : null, after: typeof after === 'number' ? after : null, expectedChange, actualChange, consistent, measurementIds: [...beforeReadings, ...afterReadings].map((m) => m.id) };
      if (!consistent) failures.push('intervention-model-mismatch');
    }
  }
  const isolated = failures.some((f) => ['post-adoption-measurement-failed', 'intervention-model-mismatch', 'no-usable-control-measurement'].includes(f));
  const usage = process.cpuUsage(cpu);
  return {
    version: 1, id, request, claimStatus: 'synthetic-world result', state: isolated ? 'quarantined' : 'completed',
    provenance: { protocol: PROTOCOL, grammar: 'candidatesFor + conditional placement/sampling composition (supplied)', adapter: 'simulated-engine-only', historyRefs, incompatibleHistoryUsed: request.method === 'mismatched-history' },
    measurements, assessments, decisions, generated: proposals.map((p) => ({ id: p.id, kinds: p.kinds, parent: p.parent })), selected: selected?.id ?? null,
    unexplained, finalScore: final.determinate ? final.score : null, adoptionVerified, intervention,
    reorganization: { apparatus: structuredClone(operational.apparatus.science), generationOrder: proposals.map((p) => p.id), origin: history.length ? 'bounded-compatible-history-feedback' : 'supplied-grammar-and-current-generation-measurements' },
    failures,
    resources: { cpuUserMicros: usage.user, cpuSystemMicros: usage.system, wallMs: performance.now() - start, rankingMs, measurementCount,
      referenceMeasurements: 18, evaluatedCandidates: bounded.length, adoptions: selected ? 1 : 0, interventionOpportunities: 1, interventions: intervention ? 1 : 0,
      operationUnits: measurementCount + 18 + proposals.length + bounded.length },
  };
}

/** Exclude machine timing and acquisition identifiers, not scientific outcomes, from reproducibility. */
export function scientificFingerprint(result: CycleResult): string {
  return hashOf({ request: result.request, selected: result.selected, decisions: result.decisions, assessments: result.assessments.map(({ measurementIds: _ids, ...rest }) => rest),
    finalScore: result.finalScore, adoptionVerified: result.adoptionVerified, failures: result.failures,
    measurements: result.measurements.map(({ id: _id, acquiredAt: _at, historyRefs: _refs, ...rest }) => rest),
    intervention: result.intervention && { ...result.intervention, measurementIds: [] }, reorganization: result.reorganization,
    resources: { ...result.resources, cpuUserMicros: 0, cpuSystemMicros: 0, wallMs: 0, rankingMs: 0 } });
}
