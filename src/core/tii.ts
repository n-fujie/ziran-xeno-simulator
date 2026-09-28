// Optional TII (Transition-Ignition Identifier) support.
// Identifiers are content-addressed and deterministic: an exact rerun yields the same TII for the
// same ignition, which makes cross-run comparison and trace citation possible. A TII identifies an
// operational event; it does not turn it into a substance. Not every transition gets one.
import type { Trace } from './trace.ts';

export interface TIIRecord {
  tii: string;
  identifier_status: 'test';
  event_type: 'transition.ignition.recorded';
  content: { module: 'ziran-xeno'; spec_id: string; spec_hash: string; run_hash: string; rule: string; occurrence: number; t: number; clock: string; seq: number };
  basis: { trace_seq: number; reads: string[] };
}

export function tiiRecords(tr: Trace): TIIRecord[] {
  return tr.events.filter((e) => e.kind === 'ignition' && e.tii).map((e) => ({
    tii: e.tii, identifier_status: 'test', event_type: 'transition.ignition.recorded',
    content: { module: 'ziran-xeno', spec_id: tr.meta.specId, spec_hash: tr.meta.specHash, run_hash: tr.meta.runHash, rule: e.rule, occurrence: e.occurrence, t: e.t, clock: e.clock, seq: e.seq },
    basis: { trace_seq: e.seq, reads: e.reads },
  }));
}

/** JSONL suitable for appending to a TII ledger as provisional/test records. */
export function tiiJsonl(tr: Trace): string {
  return tiiRecords(tr).map((r) => JSON.stringify(r)).join('\n') + '\n';
}

/** TIIs present in both runs (same operational event under the same spec and occurrence). */
export function sharedTIIs(a: Trace, b: Trace): string[] {
  const A = new Set(tiiRecords(a).map((r) => r.tii));
  return tiiRecords(b).map((r) => r.tii).filter((x) => A.has(x));
}
