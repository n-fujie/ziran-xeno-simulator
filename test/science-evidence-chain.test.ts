import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger } from '../src/science/store.ts';
import type { LedgerEntry } from '../src/science/store.ts';
import { ScientificRuntime } from '../src/science/runtime.ts';
import type { CycleResult } from '../src/science/runtime.ts';
import { auditEvidenceChain } from '../src/science/evidence-chain.ts';
import { auditLedger } from '../src/science/ledger-audit.ts';

type Cleanup = { after: (fn: () => void) => void };
function populated(t: Cleanup, maxSegmentBytes?: number) {
  const root = mkdtempSync(join(tmpdir(), 'evidence-chain-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const ledger = new Ledger(join(root, 'l'), undefined, undefined, maxSegmentBytes === undefined ? {} : { maxSegmentBytes }), runtime = new ScientificRuntime(ledger);
  // Failures first (so later history has rejected parents to revise), then history-consuming runs and a mismatched-history run.
  runtime.run({ seed: 1, condition: 'intervention-mismatch', method: 'adaptive' });
  runtime.run({ seed: 2, condition: 'intervention-mismatch', method: 'adaptive' });
  runtime.run({ seed: 3, condition: 'coupled', method: 'adaptive' });
  runtime.run({ seed: 4, condition: 'intervention-mismatch', method: 'history' });
  runtime.run({ seed: 5, condition: 'intervention-mismatch', method: 'history' });
  runtime.run({ seed: 6, condition: 'coupled', method: 'history' });
  runtime.run({ seed: 7, condition: 'stable', method: 'mismatched-history' });
  return { ledger, entries: structuredClone(ledger.read()) };
}
const cycle = (entries: LedgerEntry[], pick: (r: CycleResult) => boolean) => entries.find((e) => (e.kind === 'completed' || e.kind === 'quarantined') && (e.data as CycleResult)?.version === 2 && pick(e.data as CycleResult))!;
const codes = (entries: LedgerEntry[]) => auditEvidenceChain(entries).findings.map((f) => f.code);

test('real cycles form a complete chain from measurement to history, on a single-file and on a rotating ledger', (t) => {
  for (const limit of [undefined, 30000]) {
    const { ledger, entries } = populated(t, limit);
    const report = auditEvidenceChain(entries);
    assert.deepEqual(report.findings, [], `limit=${limit}`);
    assert.equal(report.cycles, 7);
    assert.ok(report.links.measuredDecisions > 0 && report.links.adoptions > 0 && report.links.interventions > 0);
    assert.equal(report.links.remeasuredInterventions, report.links.interventions, 'every intervention was re-measured through a separate reference path');
    assert.equal(report.links.writeAheadEffects, report.links.interventions);
    assert.ok(report.history.cyclesWithHistory >= 3 && report.history.unresolvedReferences === 0);
    // History is reported as acting only where the record shows it changed candidates; performance is never inferred.
    assert.ok(report.history.cyclesWhereHistoryChangedCandidates >= 1, 'history demonstrably changed the candidate set at least once');
    assert.equal(report.history.performanceAdvantage, 'not-established-by-the-record-alone');
    assert.deepEqual(auditEvidenceChain(ledger.read()), report, 'reading through the ledger (across segments) gives the same report');
    const audit = auditLedger(ledger);
    assert.equal(audit.integrity, 'verified'); assert.equal(audit.evidenceChain.brokenOperations.length, 0);
    assert.equal(audit.rotation.enabled, limit !== undefined);
    if (limit !== undefined) { assert.ok(audit.rotation.sealedSegments >= 1); assert.equal(audit.growth.appendRewritesWholeLedger, false); assert.equal(audit.growth.activeSegmentBounded, true); }
    else { assert.equal(audit.rotation.sealedSegments, 0); assert.equal(audit.growth.appendRewritesWholeLedger, true); }
    assert.ok(Math.abs(audit.bytes - (audit.rotation.activeBytes + audit.rotation.sealedBytes)) === 0);
  }
});

const TAMPER: [string, string, (entries: LedgerEntry[]) => void][] = [
  ['decision-without-measured-assessment', 'a decision whose measured assessment is gone', (es) => { const r = cycle(es, (x) => x.decisions.length > 0).data as CycleResult; r.assessments = r.assessments.filter((a) => a.partition !== 'decision'); }],
  ['multiple-accepted-candidates', 'two accepted candidates', (es) => { const r = cycle(es, (x) => x.decisions.length > 1).data as CycleResult; r.decisions.forEach((d) => { d.accepted = true; }); }],
  ['selected-without-accepted-decision', 'a selection nobody accepted', (es) => { (cycle(es, (x) => x.selected !== null).data as CycleResult).selected = 'invented candidate'; }],
  ['accepted-without-selection', 'an acceptance with no selection', (es) => { (cycle(es, (x) => x.selected !== null).data as CycleResult).selected = null; }],
  ['missing-final-evaluation', 'no final evaluation', (es) => { const r = cycle(es, (x) => x.selected !== null).data as CycleResult; r.assessments = r.assessments.filter((a) => a.partition !== 'evaluation'); }],
  ['adoption-verified-without-perfect-evaluation', 'verified adoption on a failed evaluation', (es) => { const r = cycle(es, (x) => x.adoptionVerified).data as CycleResult; r.assessments.find((a) => a.partition === 'evaluation')!.score = 0.5; }],
  ['final-score-not-from-evaluation', 'a final score that is not the evaluation score', (es) => { (cycle(es, (x) => x.finalScore !== null).data as CycleResult).finalScore = 0.123; }],
  ['intervention-without-verified-adoption', 'an intervention without verified adoption', (es) => { (cycle(es, (x) => x.intervention !== null).data as CycleResult).adoptionVerified = false; }],
  ['intervention-measurement-missing', 'an intervention citing a missing measurement', (es) => { (cycle(es, (x) => x.intervention !== null).data as CycleResult).intervention!.measurementIds.push('missing'); }],
  ['intervention-not-remeasured-independently', 'an intervention with no independent before/after references', (es) => { const r = cycle(es, (x) => x.intervention !== null).data as CycleResult; r.intervention!.measurementIds = r.intervention!.measurementIds.filter((id) => !id.includes('reference:target/x')); }],
  ['consistent-intervention-contradicts-measurement', 'a consistent verdict contradicting the measured change', (es) => { const r = cycle(es, (x) => x.intervention?.consistent === true).data as CycleResult; r.intervention!.actualChange = r.intervention!.expectedChange + 1; }],
  ['history-reference-unresolved', 'a history reference to nothing', (es) => { (cycle(es, (x) => x.provenance.historyRefs.length > 0).data as CycleResult).provenance.historyRefs.push('f'.repeat(64)); }],
  ['history-used-but-origin-not-recorded', 'history used but not recorded as the origin', (es) => { (cycle(es, (x) => x.provenance.historyRefs.length > 0).data as CycleResult).reorganization.origin = 'supplied-grammar-and-current-generation-measurements'; }],
  ['history-origin-recorded-without-references', 'a history origin with no references', (es) => { (cycle(es, (x) => x.provenance.historyRefs.length === 0).data as CycleResult).reorganization.origin = 'bounded-compatible-history-feedback'; }],
];
for (const [code, description, tamper] of TAMPER) test(`a broken link is reported: ${description}`, (t) => {
  const { entries } = populated(t); assert.deepEqual(codes(entries), []);
  tamper(entries); assert.ok(codes(entries).includes(code), `${code} in ${codes(entries)}`);
});

test('effects without a durable write-ahead record are reported', (t) => {
  for (const [phase, code] of [['intervention-issued', 'intervention-not-written-ahead'], ['connect-issued', 'connect-not-written-ahead'], ['disconnect-issued', 'disconnect-not-written-ahead']] as const) {
    const { entries } = populated(t);
    const kept = entries.filter((e) => !(e.kind === 'event' && (e.data as { phase: string }).phase === phase));
    assert.ok(codes(kept).includes(code), `${phase} -> ${code}`);
  }
});
