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
import { unresolvedInterruptions } from './resume.ts';

export interface LedgerAuditOptions { warnBytes?: number }
export interface LedgerAuditReport {
  integrity: 'verified' | 'failed';
  failure: 'ledger-integrity' | 'external-checkpoint' | 'unavailable' | null;
  externalWitnessed: boolean; entries: number; bytes: number;
  kinds: Record<string, number>;
  operations: { prepared: number; completed: number; quarantined: number; pending: string[] };
  results: { cycleV2: number; otherPayloads: number };
  growth: { status: 'ok' | 'warn'; warnBytes: number; appendRewritesWholeLedger: true; requiredFreeBytesForNextAppend: number };
  capacity: 'ok' | 'low' | 'unknown';
  measurementAudit: { inspected: number; inconsistentResults: string[] };
  unresolvedInterruptions: string[];
}

export function auditLedger(ledger: Ledger, options: LedgerAuditOptions = {}): LedgerAuditReport {
  const warnBytes = options.warnBytes ?? 64 * 1024 * 1024;
  if (!Number.isSafeInteger(warnBytes) || warnBytes < 1) throw Error('invalid growth threshold');
  const file = join(ledger.directory, 'ledger.json');
  const bytes = existsSync(file) ? statSync(file).size : 0;
  // Each append rewrites the whole ledger into a pending file beside the current one.
  const required = 2 * bytes + 1024 * 1024;
  let capacity: LedgerAuditReport['capacity'] = 'unknown';
  try { const fs = statfsSync(ledger.directory); capacity = fs.bavail * fs.bsize >= required ? 'ok' : 'low'; } catch { /* unknown stays unknown */ }
  const base = {
    externalWitnessed: ledger.externalWitnessed, bytes, capacity,
    growth: { status: bytes >= warnBytes ? 'warn' as const : 'ok' as const, warnBytes, appendRewritesWholeLedger: true as const, requiredFreeBytesForNextAppend: required },
  };
  let entries: LedgerEntry[];
  try { entries = ledger.read(); } catch (error) {
    const message = String((error as Error)?.message ?? '');
    const failure = error instanceof SyntaxError || message.startsWith('ledger integrity') ? 'ledger-integrity' : message.includes('external checkpoint') ? 'external-checkpoint' : 'unavailable';
    return { integrity: 'failed', failure, ...base, entries: 0, kinds: {}, operations: { prepared: 0, completed: 0, quarantined: 0, pending: [] }, results: { cycleV2: 0, otherPayloads: 0 }, measurementAudit: { inspected: 0, inconsistentResults: [] }, unresolvedInterruptions: [] };
  }
  const kinds: Record<string, number> = {};
  for (const e of entries) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  const ended = new Set(entries.filter((e) => e.kind === 'completed' || e.kind === 'quarantined').map((e) => e.operation));
  const pending = entries.filter((e) => e.kind === 'prepared' && !ended.has(e.operation)).map((e) => e.operation);
  const cycles = entries.filter((e) => (e.kind === 'completed' || e.kind === 'quarantined') && (e.data as CycleResult | null)?.version === 2).map((e) => e.data as CycleResult);
  const inconsistentResults = cycles.filter((r) => auditCycleMeasurements(r).consistency !== 'internally-consistent').map((r) => r.id);
  return {
    integrity: 'verified', failure: null, ...base, entries: entries.length, kinds,
    operations: { prepared: kinds.prepared ?? 0, completed: kinds.completed ?? 0, quarantined: kinds.quarantined ?? 0, pending },
    results: { cycleV2: cycles.length, otherPayloads: (kinds.completed ?? 0) + (kinds.quarantined ?? 0) - cycles.length },
    measurementAudit: { inspected: cycles.length, inconsistentResults },
    unresolvedInterruptions: unresolvedInterruptions(entries),
  };
}
