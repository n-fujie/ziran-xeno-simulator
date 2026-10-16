// Read-only long-term audit of a ledger. It re-verifies everything Ledger.read() verifies (hash chain,
// contiguous sequence, separate witness, external head) and adds operational facts that matter after months of
// use: growth, free-space headroom, operation states, legacy/non-cycle payloads and per-cycle measurement
// consistency. It does not repair, compact, migrate or rewrite anything, and reports bounded categories only
// (never raw error text, which could carry adapter details).
import { statSync, statfsSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Ledger, LedgerEntry } from './store.ts';
import type { CycleResult } from './runtime.ts';
import { auditCycleMeasurements } from './measurement-audit.ts';
import { auditEvidenceChain } from './evidence-chain.ts';
import { unresolvedInterruptions } from './resume.ts';

export interface LedgerAuditOptions { warnBytes?: number }
export interface LedgerAuditReport {
  integrity: 'verified' | 'failed';
  failure: 'ledger-integrity' | 'external-checkpoint' | 'unavailable' | null;
  externalWitnessed: boolean; entries: number; bytes: number;
  kinds: Record<string, number>;
  operations: { prepared: number; completed: number; quarantined: number; pending: string[] };
  results: { cycleV2: number; otherPayloads: number };
  /** appendRewritesWholeLedger is true only for a never-rotated ledger opened without rotation: then every append
   * rewrites all history. Otherwise an append rewrites the active segment (bounded only if rotation is enabled). */
  growth: { status: 'ok' | 'warn'; warnBytes: number; appendRewritesWholeLedger: boolean; activeSegmentBounded: boolean; requiredFreeBytesForNextAppend: number };
  rotation: { enabled: boolean; maxSegmentBytes: number | null; sealedSegments: number; activeBytes: number; sealedBytes: number; unreferencedSegments: string[] };
  capacity: 'ok' | 'low' | 'unknown';
  measurementAudit: { inspected: number; inconsistentResults: string[] };
  /** Links from measurement to decision, adoption, intervention, re-measurement and history, checked across all stored cycles. */
  evidenceChain: { inspected: number; brokenOperations: string[]; historyCycles: number; historyChangedCandidates: number; performanceAdvantage: 'not-established-by-the-record-alone' };
  unresolvedInterruptions: string[];
}

export function auditLedger(ledger: Ledger, options: LedgerAuditOptions = {}): LedgerAuditReport {
  const warnBytes = options.warnBytes ?? 64 * 1024 * 1024;
  if (!Number.isSafeInteger(warnBytes) || warnBytes < 1) throw Error('invalid growth threshold');
  const file = join(ledger.directory, 'ledger.json');
  const activeOnDisk = existsSync(file) ? statSync(file).size : 0;
  let layout: ReturnType<Ledger['layout']> | undefined;
  try { layout = ledger.layout(); } catch { /* integrity failures are reported below */ }
  const activeBytes = layout?.activeBytes ?? activeOnDisk, sealedBytes = layout?.sealedBytes ?? 0, sealedCount = layout?.sealed.length ?? 0;
  const bytes = activeBytes + sealedBytes;
  // Each append rewrites the active segment into a pending file beside it, and rewrites the witness, which lists
  // every sealed segment (~220 bytes each). Sealing itself is a hard link and needs no extra space.
  const required = 2 * activeBytes + 220 * sealedCount + 1024 * 1024;
  let capacity: LedgerAuditReport['capacity'] = 'unknown';
  try { const fs = statfsSync(ledger.directory); capacity = fs.bavail * fs.bsize >= required ? 'ok' : 'low'; } catch { /* unknown stays unknown */ }
  const base = {
    externalWitnessed: ledger.externalWitnessed, bytes, capacity,
    growth: { status: bytes >= warnBytes ? 'warn' as const : 'ok' as const, warnBytes, appendRewritesWholeLedger: sealedCount === 0 && ledger.segmentLimit === undefined, activeSegmentBounded: ledger.segmentLimit !== undefined, requiredFreeBytesForNextAppend: required },
    rotation: { enabled: ledger.segmentLimit !== undefined, maxSegmentBytes: ledger.segmentLimit ?? null, sealedSegments: sealedCount, activeBytes, sealedBytes, unreferencedSegments: layout?.unreferencedSegments ?? [] },
  };
  let entries: LedgerEntry[];
  try { entries = ledger.read(); } catch (error) {
    const message = String((error as Error)?.message ?? '');
    const failure = error instanceof SyntaxError || message.startsWith('ledger integrity') ? 'ledger-integrity' : message.includes('external checkpoint') ? 'external-checkpoint' : 'unavailable';
    return { integrity: 'failed', failure, ...base, entries: 0, kinds: {}, operations: { prepared: 0, completed: 0, quarantined: 0, pending: [] }, results: { cycleV2: 0, otherPayloads: 0 }, measurementAudit: { inspected: 0, inconsistentResults: [] }, evidenceChain: { inspected: 0, brokenOperations: [], historyCycles: 0, historyChangedCandidates: 0, performanceAdvantage: 'not-established-by-the-record-alone' }, unresolvedInterruptions: [] };
  }
  const kinds: Record<string, number> = {};
  for (const e of entries) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  const ended = new Set(entries.filter((e) => e.kind === 'completed' || e.kind === 'quarantined').map((e) => e.operation));
  const pending = entries.filter((e) => e.kind === 'prepared' && !ended.has(e.operation)).map((e) => e.operation);
  const cycles = entries.filter((e) => (e.kind === 'completed' || e.kind === 'quarantined') && (e.data as CycleResult | null)?.version === 2).map((e) => e.data as CycleResult);
  const chain = auditEvidenceChain(entries);
  const inconsistentResults = cycles.filter((r) => auditCycleMeasurements(r).consistency !== 'internally-consistent').map((r) => r.id);
  return {
    integrity: 'verified', failure: null, ...base, entries: entries.length, kinds,
    operations: { prepared: kinds.prepared ?? 0, completed: kinds.completed ?? 0, quarantined: kinds.quarantined ?? 0, pending },
    results: { cycleV2: cycles.length, otherPayloads: (kinds.completed ?? 0) + (kinds.quarantined ?? 0) - cycles.length },
    measurementAudit: { inspected: cycles.length, inconsistentResults },
    evidenceChain: { inspected: chain.cycles, brokenOperations: [...new Set(chain.findings.map((f) => f.operation))], historyCycles: chain.history.cyclesWithHistory, historyChangedCandidates: chain.history.cyclesWhereHistoryChangedCandidates, performanceAdvantage: chain.history.performanceAdvantage },
    unresolvedInterruptions: unresolvedInterruptions(entries),
  };
}
