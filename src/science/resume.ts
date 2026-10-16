// Fail-closed, idempotent and fully recorded resume clearance for an interrupted operation.
// This is a SOFTWARE run clearance only. It never actuates a device, never retries the interrupted effect,
// never clears the original quarantine and never sets physicalRecoveryVerified. Resume is never automatic:
// every assessment is an explicit operator request that is recorded in the ledger whether it passes or not.
import { hashOf } from '../core/hash.ts';
import type { Ledger, LedgerEntry } from './store.ts';

export const RESUME_KIND = 'resume-assessment-v1';
export type ResumeBlock =
  | 'operation-not-an-open-interruption' | 'pending-operation' | 'external-checkpoint-absent'
  | 'no-device-reconciliation' | 'device-evidence-not-verified' | 'device-evidence-for-different-quarantine'
  | 'device-evidence-expired' | 'device-boot-changed' | 'apparatus-unverified' | 'apparatus-changed' | 'intervention-effect-unmeasured';
export interface ResumeRequest {
  /** Idempotency key for the request itself: the same id with identical content returns the recorded assessment. */
  resumeId: string; operationId: string;
  /** A label for traceability. This is not authentication. */
  requestedBy: string;
  /** Boot epoch freshly obtained through the same authenticated device probe path. */
  observedBootId: string;
  /** hashOf(apparatus.science) of the configuration the operator intends to run against. */
  currentApparatusHash: string;
  /** Explicit, recorded acknowledgement when an issued intervention was never re-measured. */
  acknowledgeUnmeasuredIntervention?: boolean;
  maxEvidenceAgeMs?: number;
}
export interface ResumeAssessment {
  resumeId: string; operationId: string; requestedBy: string;
  status: 'conditions-met' | 'blocked'; reasons: ResumeBlock[];
  evidenceAuditId: string | null; evidenceAgeMs: number | null;
  operatorDecisionRequired: true; automaticResume: false; physicalRecoveryVerified: false;
  scope: 'software-run-clearance-only';
}
export interface ResumeGateOptions { requireExternalCheckpoint?: boolean; now?: () => number }

type Data = Record<string, unknown> & { kind?: unknown; version?: unknown; status?: unknown; originalOperation?: unknown; physicalRecoveryVerified?: unknown };
const asData = (value: unknown): Data => (value && typeof value === 'object' ? value : {}) as Data;

/** An interruption quarantine is one written by recovery or by the failed-operation path: no cycle result,
 * no audit kind, physical outcome unknown. Isolated synthetic cycle results are not interruptions. */
function isInterruption(entry: LedgerEntry): boolean {
  const data = asData(entry.data);
  return entry.kind === 'quarantined' && data.version !== 2 && data.kind === undefined && data.physicalRecoveryVerified === false;
}

/** Interrupted operations that no recorded, satisfied resume assessment has cleared yet. */
export function unresolvedInterruptions(entries: LedgerEntry[]): string[] {
  // Audit records (reconciliation, resume) are not physical operations, even if interrupted themselves.
  const audits = new Set(entries.filter((e) => e.kind === 'prepared' && (asData(e.data).kind === RESUME_KIND || asData(e.data).kind === 'device-reconciliation-v1')).map((e) => e.operation));
  const cleared = new Set(entries.filter((e) => e.kind === 'completed' && asData(e.data).kind === RESUME_KIND && asData(e.data).status === 'conditions-met').map((e) => String(asData(e.data).originalOperation)));
  const terminal = new Map<string, LedgerEntry>();
  for (const e of entries) if (e.kind === 'completed' || e.kind === 'quarantined') terminal.set(e.operation, e);
  return [...terminal.values()].filter((e) => isInterruption(e) && !audits.has(e.operation) && !cleared.has(e.operation)).map((e) => e.operation);
}

export class ResumeGate {
  private ledger: Ledger;
  private requireExternal: boolean;
  private now: () => number;
  constructor(ledger: Ledger, options: ResumeGateOptions = {}) {
    this.ledger = ledger; this.requireExternal = options.requireExternalCheckpoint ?? true; this.now = options.now ?? Date.now;
  }
  assess(request: ResumeRequest): ResumeAssessment {
    const id = /^[A-Za-z0-9_-]{8,128}$/, label = /^[A-Za-z0-9_.@:-]{1,128}$/, boot = /^[A-Za-z0-9_.:-]{1,128}$/;
    if (!request || typeof request !== 'object' || !id.test(request.resumeId) || !id.test(request.operationId) || !label.test(request.requestedBy) || !boot.test(request.observedBootId) || !/^[a-f0-9]{64}$/.test(request.currentApparatusHash)) throw Error('invalid resume request');
    const maxAge = request.maxEvidenceAgeMs ?? 30000;
    if (!Number.isSafeInteger(maxAge) || maxAge < 1000 || maxAge > 300000) throw Error('invalid evidence age limit');
    const operation = `resume-${request.resumeId}`;
    return this.ledger.exclusive(() => {
      let entries: LedgerEntry[];
      try { entries = this.ledger.read(); } catch { throw Error('resume blocked: ledger or external checkpoint verification failed; nothing recorded'); }
      const previous = entries.find((e) => e.kind === 'prepared' && e.operation === operation);
      if (previous) {
        if (hashOf((previous.data as { request: unknown }).request) !== hashOf(request)) throw Error('resumeId conflict');
        const done = entries.find((e) => e.operation === operation && (e.kind === 'completed' || e.kind === 'quarantined'));
        const recorded = asData(done?.data);
        if (!done || recorded.kind !== RESUME_KIND) throw Error('resume request interrupted; submit a new resumeId');
        return recorded.assessment as ResumeAssessment;
      }
      const now = this.now();
      if (!Number.isSafeInteger(now) || now < 0) throw Error('invalid resume clock');
      const reasons: ResumeBlock[] = [];
      const original = entries.filter((e) => e.operation === request.operationId);
      const tail = original.at(-1);
      if (!unresolvedInterruptions(entries).includes(request.operationId)) reasons.push('operation-not-an-open-interruption');
      const ended = new Set(entries.filter((e) => e.kind === 'completed' || e.kind === 'quarantined').map((e) => e.operation));
      if (entries.some((e) => e.kind === 'prepared' && !ended.has(e.operation))) reasons.push('pending-operation');
      if (this.requireExternal && !this.ledger.externalWitnessed) reasons.push('external-checkpoint-absent');
      // Latest device reconciliation recorded for this operation.
      const audits = entries.filter((e) => e.kind === 'prepared' && asData(e.data).kind === 'device-reconciliation-v1' && asData(asData(e.data).expected).operationId === request.operationId);
      const audit = audits.at(-1);
      const outcome = audit && entries.find((e) => e.operation === audit.operation && (e.kind === 'completed' || e.kind === 'quarantined'));
      let evidenceAgeMs: number | null = null;
      if (!audit) reasons.push('no-device-reconciliation');
      else {
        const prepared = asData(audit.data), issuedAt = Number(asData(prepared.request).issuedAt);
        if (asData(outcome?.data).status !== 'verified-safe-stop') reasons.push('device-evidence-not-verified');
        if (!tail || prepared.originalTail !== tail.hash) reasons.push('device-evidence-for-different-quarantine');
        evidenceAgeMs = Number.isFinite(issuedAt) ? now - issuedAt : null;
        if (evidenceAgeMs === null || evidenceAgeMs < 0 || evidenceAgeMs > maxAge) reasons.push('device-evidence-expired');
        if (asData(prepared.expected).bootId !== request.observedBootId) reasons.push('device-boot-changed');
      }
      const events = original.filter((e) => e.kind === 'event').map((e) => asData(e.data));
      const hashes = events.map((e) => asData(e.detail).apparatusHash).filter((h): h is string => typeof h === 'string');
      if (!hashes.length) reasons.push('apparatus-unverified');
      else if (hashes.at(-1) !== request.currentApparatusHash) reasons.push('apparatus-changed');
      const phases = events.map((e) => e.phase);
      if (phases.includes('intervention-issued') && !phases.includes('intervention-remeasured') && request.acknowledgeUnmeasuredIntervention !== true) reasons.push('intervention-effect-unmeasured');
      const assessment: ResumeAssessment = {
        resumeId: request.resumeId, operationId: request.operationId, requestedBy: request.requestedBy,
        status: reasons.length ? 'blocked' : 'conditions-met', reasons, evidenceAuditId: audit?.operation ?? null, evidenceAgeMs,
        operatorDecisionRequired: true, automaticResume: false, physicalRecoveryVerified: false, scope: 'software-run-clearance-only',
      };
      this.ledger.append('prepared', operation, { kind: RESUME_KIND, request });
      this.ledger.append(reasons.length ? 'quarantined' : 'completed', operation, { kind: RESUME_KIND, status: assessment.status, originalOperation: request.operationId, assessment });
      return assessment;
    });
  }
}
