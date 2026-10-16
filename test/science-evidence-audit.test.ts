import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger } from '../src/science/store.ts';
import { ScientificRuntime } from '../src/science/runtime.ts';
import type { CycleResult } from '../src/science/runtime.ts';
import { CONDITIONS } from '../src/science/protocol.ts';
import { auditCycleMeasurements } from '../src/science/measurement-audit.ts';
import { auditLedger } from '../src/science/ledger-audit.ts';
import { sha256 } from '../src/core/hash.ts';
import { sameHead } from '../src/science/checkpoint.ts';
import type { ExternalHead, ExternalCheckpointStore } from '../src/science/checkpoint.ts';

function fresh(t: { after: (fn: () => void) => void }, binding?: ConstructorParameters<typeof Ledger>[2]) {
  const root = mkdtempSync(join(tmpdir(), 'evidence-audit-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const ledger = new Ledger(join(root, 'ledger'), undefined, binding);
  return { root, ledger, runtime: new ScientificRuntime(ledger) };
}
const codes = (r: ReturnType<typeof auditCycleMeasurements>) => r.findings.map((f) => f.code);
const clone = (r: CycleResult) => structuredClone(r);

test('every condition and method yields internally consistent measurement evidence, never physical authenticity', { timeout: 120000 }, (t) => {
  const { runtime } = fresh(t); let seed = 1, audited = 0;
  for (const condition of CONDITIONS) for (const method of ['adaptive', 'history'] as const) {
    const result = runtime.run({ seed: seed++, condition, method });
    const report = auditCycleMeasurements(result); audited++;
    assert.deepEqual(report.findings, [], `${condition}/${method}`);
    assert.equal(report.consistency, 'internally-consistent');
    assert.equal(report.evidenceLevel.authenticity, 'synthetic-internal-consistency-only');
    assert.equal(report.evidenceLevel.deviceSideEvidence, 'none');
    assert.equal(report.evidenceLevel.externalTimeEvidence, 'none');
    assert.equal(report.evidenceLevel.physicalIndependence, 'unverified');
    assert.deepEqual(report.evidenceLevel.sources, ['synthetic-engine']);
  }
  assert.equal(audited, 14);
});

test('unmeasurable, faulty and absent-difference outcomes stay distinct and failure never becomes absence', (t) => {
  const { runtime } = fresh(t);
  const fault = auditCycleMeasurements(runtime.run({ seed: 5, condition: 'sensor-fault', method: 'always' }));
  assert.ok(fault.statusClasses['unmeasurable-or-faulty'] > 0, 'sensor fault is recorded as a measurement failure class');
  assert.equal(fault.consistency, 'internally-consistent');
  const stable = auditCycleMeasurements(runtime.run({ seed: 6, condition: 'stable', method: 'adaptive' }));
  assert.ok((stable.relations['no-difference-in-measured-channels'] ?? 0) > 0, 'absence of difference needs detected readings');
  assert.equal(stable.statusClasses['unmeasurable-or-faulty'], 0);
  const result = runtime.run({ seed: 7, condition: 'coupled', method: 'adaptive' });
  // Turning one reading into a failed measurement while keeping the comparison determinate is a defect.
  const tampered = clone(result); const assessed = tampered.assessments.find((a) => a.determinate)!;
  const reading = tampered.measurements.find((m) => m.id === assessed.measurementIds[0])!;
  reading.status = 'not-measured'; reading.value = null;
  assert.ok(codes(auditCycleMeasurements(tampered)).includes('determinate-assessment-with-undetected-reading'));
});

test('duplicated, relabelled, re-registered and leaked measurements are detected', (t) => {
  const { runtime } = fresh(t); const result = runtime.run({ seed: 11, condition: 'coupled', method: 'adaptive', budget: 4 });
  assert.equal(auditCycleMeasurements(result).consistency, 'internally-consistent');
  const check = (mutate: (r: CycleResult) => void, expected: string) => { const r = clone(result); mutate(r); assert.ok(codes(auditCycleMeasurements(r)).includes(expected), expected); };
  check((r) => { r.measurements[1].acquisitionKey = r.measurements[0].acquisitionKey; }, 'duplicate-acquisition-key');
  check((r) => { r.measurements[1].id = r.measurements[0].id; }, 'duplicate-measurement-id');
  check((r) => { r.measurements[0].partition = r.measurements[0].partition === 'generation' ? 'evaluation' : 'generation'; }, 'partition-target-mismatch');
  check((r) => { const m = r.measurements.find((x) => x.route === 'Engine.ctx.obs')!; r.measurements.push({ ...m, id: m.id + ':copy', acquisitionKey: m.acquisitionKey + ':copy' }); }, 'same-observation-reregistered');
  check((r) => { const m = r.measurements.find((x) => x.status === 'detected')!; m.value = null; }, 'detected-without-valid-value');
  check((r) => { const m = r.measurements.find((x) => x.status === 'detected')!; m.status = 'not-measured'; }, 'value-recorded-without-detection');
  check((r) => { r.measurements[0].historyRefs = ['f'.repeat(64)]; }, 'history-reference-outside-provenance');
  check((r) => { r.measurements.find((m) => m.route === 'Engine.ctx.obs')!.apparatus = 'independent-forged'; }, 'route-apparatus-incoherent');
  check((r) => { r.measurements.find((m) => m.route === 'Engine.readChannel')!.apparatus = 'science'; }, 'route-apparatus-incoherent');
  check((r) => { r.assessments[0].measurementIds.push('missing-measurement'); }, 'assessment-measurement-missing');
  check((r) => { const a = r.assessments.find((x) => x.partition === 'evaluation')!; const other = r.measurements.find((m) => m.partition === 'generation' && m.route === 'Engine.ctx.obs')!; a.measurementIds.push(other.id); }, 'assessment-partition-mismatch');
  check((r) => { r.measurements[0].status = 'invented' as never; }, 'unrecognized-status');
  const decisions = result.assessments.filter((a) => a.partition === 'decision');
  assert.ok(decisions.length >= 2, 'multiple candidate slots exist to test cohort leakage');
  check((r) => {
    const [first, second] = r.assessments.filter((a) => a.partition === 'decision');
    const donor = r.measurements.find((m) => m.id === first.measurementIds[0])!;
    const receiver = r.measurements.find((m) => m.id === second.measurementIds[0])!;
    receiver.target = donor.target;
  }, 'decision-cohort-shared-between-candidates');
});

test('a foreign measurement source is not assessable and is never reported as authentic', (t) => {
  const { runtime } = fresh(t); const result = clone(runtime.run({ seed: 12, condition: 'coupled', method: 'adaptive' }));
  (result.measurements[0] as { source: string }).source = 'unknown-instrument';
  const report = auditCycleMeasurements(result);
  assert.ok(codes(report).includes('unrecognized-measurement-source'));
  assert.equal(report.evidenceLevel.authenticity, 'not-assessable');
  assert.equal(report.consistency, 'inconsistent');
  assert.doesNotMatch(JSON.stringify(report), /"authentic"/);
});

test('audit reports carry identifiers and codes only, never measured values', (t) => {
  const { runtime } = fresh(t); const result = clone(runtime.run({ seed: 13, condition: 'coupled', method: 'adaptive' }));
  result.measurements[0].status = 'not-measured';
  const report = JSON.stringify(auditCycleMeasurements(result));
  for (const m of result.measurements) if (typeof m.value === 'number' && m.value !== 0) assert.equal(report.includes(`"value":${m.value}`), false);
  assert.doesNotMatch(report, /"value"/);
});

function memoryStore() {
  let head: ExternalHead = { version: 1, historyId: 'audit', seriesId: 'series', count: 0, hash: '', digest: sha256('[]') };
  const store: ExternalCheckpointStore = { read: () => ({ ...head }), compareAndSet(expected, next) { if (!sameHead(head, expected)) throw Error('checkpoint update conflict'); head = { ...next }; } };
  return { store, binding: { historyId: 'audit', seriesId: 'series', store }, set: (h: ExternalHead) => { head = h; } };
}

test('long-term audit verifies chain, witness and external head, then names the failure category without raw errors', (t) => {
  const memory = memoryStore();
  const { ledger, runtime, root } = fresh(t, memory.binding);
  runtime.run({ seed: 21, condition: 'coupled', method: 'adaptive' });
  runtime.run({ seed: 22, condition: 'stable', method: 'adaptive' });
  runtime.run({ seed: 23, condition: 'intervention-mismatch', method: 'adaptive' });
  const ok = auditLedger(ledger);
  assert.equal(ok.integrity, 'verified'); assert.equal(ok.failure, null); assert.equal(ok.externalWitnessed, true);
  assert.equal(ok.operations.prepared, 3); assert.equal(ok.operations.completed + ok.operations.quarantined, 3);
  assert.equal(ok.entries, ok.kinds.prepared + (ok.kinds.event ?? 0) + (ok.kinds.completed ?? 0) + (ok.kinds.quarantined ?? 0));
  assert.deepEqual(ok.operations.pending, []); assert.deepEqual(ok.unresolvedInterruptions, []);
  assert.equal(ok.results.cycleV2, 3); assert.equal(ok.results.otherPayloads, 0);
  assert.deepEqual(ok.measurementAudit, { inspected: 3, inconsistentResults: [] });
  assert.ok(ok.bytes > 0 && ok.growth.requiredFreeBytesForNextAppend >= 2 * ok.bytes && ok.growth.appendRewritesWholeLedger === true);
  assert.ok(['ok', 'low', 'unknown'].includes(ok.capacity));
  // An isolated synthetic cycle result is not an interrupted operation.
  assert.equal(ok.unresolvedInterruptions.length, 0);
  assert.equal(auditLedger(ledger, { warnBytes: 1 }).growth.status, 'warn');
  assert.throws(() => auditLedger(ledger, { warnBytes: 0 }), /threshold/);

  // External head rewritten to a different position.
  const real = memory.store.read('audit', 'series'); memory.set({ ...real, count: real.count - 1 });
  const external = auditLedger(ledger); assert.equal(external.integrity, 'failed'); assert.equal(external.failure, 'external-checkpoint');
  memory.set(real); assert.equal(auditLedger(ledger).integrity, 'verified');

  // Valid-prefix truncation, then raw corruption.
  const file = join(root, 'ledger', 'ledger.json'), raw = readFileSync(file, 'utf8');
  writeFileSync(file, JSON.stringify(JSON.parse(raw).slice(0, -1)));
  const truncated = auditLedger(ledger); assert.equal(truncated.integrity, 'failed'); assert.equal(truncated.failure, 'ledger-integrity'); assert.equal(truncated.entries, 0);
  writeFileSync(file, raw.slice(0, 40));
  const corrupt = auditLedger(ledger); assert.equal(corrupt.failure, 'ledger-integrity');
  assert.doesNotMatch(JSON.stringify(corrupt), /Unexpected|JSON|position/);
  truncateSync(file, 0);
  assert.equal(auditLedger(ledger).integrity, 'failed');
});

test('audit surfaces inconsistent stored cycles and open interruptions without repairing them', (t) => {
  const { ledger, runtime } = fresh(t);
  runtime.run({ seed: 31, condition: 'coupled', method: 'adaptive' });
  assert.throws(() => runtime.run({ operationId: 'interrupted-audit-op' }, (phase) => { if (phase === 'after-connect') throw Error('simulated response loss'); }));
  const report = auditLedger(ledger);
  assert.deepEqual(report.unresolvedInterruptions, ['interrupted-audit-op']);
  assert.equal(report.results.otherPayloads, 1);
  const before = readFileSync(join(ledger.directory, 'ledger.json'), 'utf8');
  auditLedger(ledger); assert.equal(readFileSync(join(ledger.directory, 'ledger.json'), 'utf8'), before, 'audit is read-only');
});

test('HTTP audit endpoint is read-only and reports a verified ledger after a cycle', { timeout: 30000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'science-audit-route-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = (socket.address() as { port: number }).port; await new Promise<void>((ok) => socket.close(() => ok()));
  const child = spawn(process.execPath, ['src/server.ts'], { cwd: new URL('../', import.meta.url), env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), SCIENCE_DATA_DIR: directory }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { child.kill(); });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('server startup timeout')), 10000);
    child.once('exit', (code) => { clearTimeout(timer); reject(Error(`server exited ${code}`)); });
    child.stdout.on('data', (data) => { if (String(data).includes('→')) { clearTimeout(timer); resolve(); } });
  });
  const base = `http://127.0.0.1:${port}`;
  const empty = await fetch(base + '/api/science/audit').then((r) => r.json());
  assert.equal(empty.integrity, 'verified'); assert.equal(empty.entries, 0);
  assert.equal((await fetch(base + '/api/science/cycles', { method: 'POST', body: JSON.stringify({ seed: 41 }) })).status, 201);
  const report = await fetch(base + '/api/science/audit').then((r) => r.json());
  assert.equal(report.integrity, 'verified'); assert.equal(report.results.cycleV2, 1); assert.deepEqual(report.measurementAudit.inconsistentResults, []);
  assert.equal((await fetch(base + '/api/science/audit', { method: 'POST' })).status, 404);
  assert.equal((await fetch(base + '/api/science/audit', { headers: { origin: 'http://evil.example' } })).status, 403);
});
