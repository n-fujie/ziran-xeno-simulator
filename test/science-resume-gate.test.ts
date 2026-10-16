import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger } from '../src/science/store.ts';
import { ScientificRuntime } from '../src/science/runtime.ts';
import type { FaultPoint } from '../src/science/runtime.ts';
import { DeviceReconciler } from '../src/science/device-reconciliation.ts';
import type { DeviceSnapshot, DeviceQuery, DeviceExpectation, DeviceStateProbe } from '../src/science/device-reconciliation.ts';
import { ResumeGate, unresolvedInterruptions } from '../src/science/resume.ts';
import type { ResumeRequest, ResumeBlock } from '../src/science/resume.ts';
import { sha256 } from '../src/core/hash.ts';
import { sameHead } from '../src/science/checkpoint.ts';
import type { ExternalHead, ExternalCheckpointStore } from '../src/science/checkpoint.ts';

const key = 'contract-model-only-signing-key';
const sign = (value: unknown) => createHmac('sha256', key).update(JSON.stringify(value)).digest('hex');
function memoryBinding() {
  let head: ExternalHead = { version: 1, historyId: 'resume', seriesId: 'series', count: 0, hash: '', digest: sha256('[]') };
  const store: ExternalCheckpointStore = { read: () => ({ ...head }), compareAndSet(expected, next) { if (!sameHead(head, expected)) throw Error('checkpoint update conflict'); head = { ...next }; } };
  return { historyId: 'resume', seriesId: 'series', store };
}
const KINDS: Record<string, readonly ('connect' | 'intervene' | 'disconnect')[]> = {
  'after-connect': ['connect', 'disconnect'], 'after-intervention': ['connect', 'intervene', 'disconnect'], 'after-disconnect': ['connect', 'intervene', 'disconnect'],
};

function setup(t: { after: (fn: () => void) => void }, options: { point?: FaultPoint; bound?: boolean; reconcile?: boolean } = {}) {
  const point = options.point ?? 'after-disconnect';
  const root = mkdtempSync(join(tmpdir(), 'resume-gate-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const ledger = new Ledger(join(root, 'ledger'), undefined, options.bound === false ? undefined : memoryBinding());
  const runtime = new ScientificRuntime(ledger);
  const operationId = 'interrupted-device-op';
  assert.throws(() => runtime.run({ operationId }, (phase) => { if (phase === point) throw Error('simulated device response loss'); }));
  const expected: DeviceExpectation = { deviceId: 'device-01', bootId: 'boot-01', operationId, baselineSequence: 10, requiredChannels: ['x'] };
  let trusted = true;
  const probe: DeviceStateProbe = {
    query(request: DeviceQuery) {
      const kinds = KINDS[point];
      const value: DeviceSnapshot = {
        deviceId: expected.deviceId, bootId: expected.bootId, operationId, nonce: request.nonce, observedAt: 1000,
        connected: false, disconnected: true, safeStopped: true, lastOperationId: operationId, sequence: expected.baselineSequence + kinds.length,
        history: kinds.map((kind, i) => ({ operationId, kind, sequence: expected.baselineSequence + i + 1, confirmed: true })),
        measurement: { acquiredAt: 1000, channels: ['x'], operational: true },
      };
      return { ...value, signature: sign(value) };
    },
    verify(response, request) {
      if (!trusted || !response || typeof response !== 'object') return false;
      const { signature, ...value } = response as DeviceSnapshot & { signature: string };
      return typeof signature === 'string' && signature.length === 64 && timingSafeEqual(Buffer.from(signature), Buffer.from(sign(value))) && value.nonce === request.nonce;
    },
  };
  const reconcile = () => new DeviceReconciler(ledger, probe).reconcile(expected, () => 1000);
  if (options.reconcile !== false) reconcile();
  const recordedHash = () => ledger.read().filter((e) => e.operation === operationId && e.kind === 'event').map((e) => (e.data as { detail?: { apparatusHash?: string } }).detail?.apparatusHash).filter((h): h is string => typeof h === 'string').at(-1);
  let counter = 0;
  const request = (over: Partial<ResumeRequest> = {}): ResumeRequest => ({
    resumeId: `resume-request-${++counter}`, operationId, requestedBy: 'operator@test', observedBootId: 'boot-01', currentApparatusHash: recordedHash() ?? 'a'.repeat(64), ...over,
  });
  const gate = (age = 1000, gateOptions: { requireExternalCheckpoint?: boolean } = {}) => new ResumeGate(ledger, { now: () => 1000 + age, ...gateOptions });
  return { root, ledger, runtime, operationId, request, gate, reconcile, untrust: () => { trusted = false; }, recordedHash };
}

test('satisfied conditions record a software run clearance only; physical recovery stays unverified and nothing is replayed', (t) => {
  const f = setup(t);
  assert.equal(f.recordedHash()?.length, 64);
  const before = f.ledger.read();
  const result = f.gate().assess(f.request());
  assert.equal(result.status, 'conditions-met'); assert.deepEqual(result.reasons, []);
  assert.equal(result.scope, 'software-run-clearance-only'); assert.equal(result.operatorDecisionRequired, true);
  assert.equal(result.automaticResume, false); assert.equal(result.physicalRecoveryVerified, false);
  assert.equal(result.requestedBy, 'operator@test'); assert.ok(result.evidenceAuditId?.startsWith('reconcile-'));
  const after = f.ledger.read();
  assert.deepEqual(after.slice(0, before.length), before, 'earlier history, reconciliation and original quarantine are untouched');
  assert.equal(after.length, before.length + 2); assert.equal(after.at(-2)?.kind, 'prepared'); assert.equal(after.at(-1)?.kind, 'completed');
  assert.equal(after.filter((e) => e.operation === f.operationId).at(-1)?.kind, 'quarantined');
  assert.throws(() => new ScientificRuntime(f.ledger).run({ operationId: f.operationId }), /quarantined/);
  assert.deepEqual(unresolvedInterruptions(after), []);
});

test('resume requests are idempotent, traceable and conflict-checked; every attempt is recorded', (t) => {
  const f = setup(t), gate = f.gate(), request = f.request();
  const first = gate.assess(request), length = f.ledger.read().length;
  assert.deepEqual(gate.assess(structuredClone(request)), first);
  assert.equal(f.ledger.read().length, length, 'replay appends nothing and re-evaluates nothing');
  assert.throws(() => gate.assess({ ...request, requestedBy: 'someone-else' }), /resumeId conflict/);
  assert.throws(() => gate.assess({ ...request, observedBootId: 'boot-02' }), /resumeId conflict/);
  // A blocked attempt is recorded and replayed as blocked; retrying requires a new identifier and is a new record.
  const blocked = gate.assess(f.request({ observedBootId: 'boot-02' }));
  assert.equal(blocked.status, 'blocked');
  const blockedAgain = f.request({ resumeId: blocked.resumeId, observedBootId: 'boot-02' });
  assert.deepEqual(gate.assess(blockedAgain), blocked);
  const ids = f.ledger.read().filter((e) => e.kind === 'prepared' && e.operation.startsWith('resume-')).map((e) => e.operation);
  assert.equal(new Set(ids).size, 2);
});

const CASES: { name: string; reason: ResumeBlock; point?: FaultPoint; age?: number; skipReconcile?: boolean; untrusted?: boolean; bound?: boolean; over?: Partial<ResumeRequest> }[] = [
  { name: 'expired device evidence', reason: 'device-evidence-expired', age: 30001 },
  { name: 'device reboot after evidence', reason: 'device-boot-changed', over: { observedBootId: 'boot-02' } },
  { name: 'changed target configuration', reason: 'apparatus-changed', over: { currentApparatusHash: 'b'.repeat(64) } },
  { name: 'no confirmed apparatus state before the interruption', reason: 'apparatus-unverified', point: 'after-connect' },
  { name: 'issued intervention never re-measured', reason: 'intervention-effect-unmeasured', point: 'after-intervention' },
  { name: 'no device reconciliation at all', reason: 'no-device-reconciliation', skipReconcile: true },
  { name: 'untrusted device evidence', reason: 'device-evidence-not-verified', untrusted: true },
  { name: 'no external checkpoint witness', reason: 'external-checkpoint-absent', bound: false },
  { name: 'unknown operation', reason: 'operation-not-an-open-interruption', over: { operationId: 'never-existed-operation' } },
];
for (const c of CASES) test(`resume stays blocked: ${c.name}`, (t) => {
  const f = setup(t, { point: c.point, reconcile: !c.skipReconcile && !c.untrusted, bound: c.bound });
  if (c.untrusted) { f.untrust(); f.reconcile(); }
  const result = f.gate(c.age ?? 1000).assess(f.request(c.over));
  assert.equal(result.status, 'blocked'); assert.ok(result.reasons.includes(c.reason), `${c.reason} in ${result.reasons}`);
  assert.equal(result.physicalRecoveryVerified, false); assert.equal(result.automaticResume, false);
  assert.ok(f.ledger.read().at(-1)?.kind === 'quarantined' && (f.ledger.read().at(-1)?.data as { status: string }).status === 'blocked', 'blocked attempt is recorded');
  assert.deepEqual(unresolvedInterruptions(f.ledger.read()), [f.operationId], 'a blocked attempt never clears the interruption');
});

test('evidence age is inclusive at the limit; a fresh failed reconciliation supersedes old success only by being newer evidence, never by reuse', (t) => {
  const f = setup(t);
  assert.equal(f.gate(30000).assess(f.request()).status, 'conditions-met');
  const g = setup(t);
  assert.equal(g.gate(30001).assess(g.request()).status, 'blocked');
  assert.equal(g.gate(500).assess(g.request({ maxEvidenceAgeMs: 100000 })).status, 'conditions-met');
  // An earlier verified safe stop is never reused once a later reconciliation fails.
  const h = setup(t); h.untrust(); h.reconcile();
  const latest = h.gate().assess(h.request());
  assert.equal(latest.status, 'blocked'); assert.ok(latest.reasons.includes('device-evidence-not-verified'));
});

test('an unmeasured intervention requires an explicit recorded acknowledgement; other conditions still apply', (t) => {
  const f = setup(t, { point: 'after-intervention' });
  const blocked = f.gate().assess(f.request());
  assert.deepEqual(blocked.reasons, ['intervention-effect-unmeasured']);
  const acknowledged = f.request({ acknowledgeUnmeasuredIntervention: true });
  assert.equal(f.gate().assess(acknowledged).status, 'conditions-met');
  const recorded = f.ledger.read().find((e) => e.kind === 'prepared' && e.operation === `resume-${acknowledged.resumeId}`);
  assert.equal((recorded?.data as { request: ResumeRequest }).request.acknowledgeUnmeasuredIntervention, true);
  const g = setup(t, { point: 'after-intervention' });
  const still = g.gate(50000).assess(g.request({ acknowledgeUnmeasuredIntervention: true }));
  assert.deepEqual(still.reasons, ['device-evidence-expired']);
});

test('local-only witness is allowed only by explicit opt-out; any other pending operation blocks', (t) => {
  const f = setup(t, { bound: false });
  assert.equal(f.gate(1000, { requireExternalCheckpoint: false }).assess(f.request()).status, 'conditions-met');
  const g = setup(t);
  g.ledger.exclusive(() => g.ledger.append('prepared', 'dangling-unfinished-op', { note: 'no terminal record' }));
  const result = g.gate().assess(g.request());
  assert.ok(result.reasons.includes('pending-operation'));
});

test('a completed or isolated cycle is not an interruption and cannot be "cleared"', (t) => {
  const f = setup(t);
  f.runtime.run({ operationId: 'ordinary-complete-op', seed: 3 });
  f.runtime.run({ operationId: 'isolated-synthetic-op', seed: 4, condition: 'intervention-mismatch' });
  const entries = f.ledger.read();
  assert.equal(entries.find((e) => e.operation === 'isolated-synthetic-op' && e.kind === 'quarantined') !== undefined, true);
  assert.deepEqual(unresolvedInterruptions(entries), [f.operationId]);
  for (const operationId of ['ordinary-complete-op', 'isolated-synthetic-op']) assert.ok(f.gate().assess(f.request({ operationId })).reasons.includes('operation-not-an-open-interruption'));
});

test('invalid requests and unverifiable ledgers are rejected before anything is recorded', (t) => {
  const f = setup(t), gate = f.gate(), length = f.ledger.read().length;
  for (const bad of [{ resumeId: 'short' }, { operationId: '../x' }, { requestedBy: 'bad name!' }, { observedBootId: '' }, { currentApparatusHash: 'xyz' }])
    assert.throws(() => gate.assess(f.request(bad)), /invalid resume request/);
  assert.throws(() => gate.assess(f.request({ maxEvidenceAgeMs: 1 })), /invalid evidence age limit/);
  assert.throws(() => gate.assess(f.request({ maxEvidenceAgeMs: 10 ** 9 })), /invalid evidence age limit/);
  assert.equal(f.ledger.read().length, length);
  const valid = f.request(), file = join(f.ledger.directory, 'ledger.json'), raw = readFileSync(file, 'utf8');
  writeFileSync(file, JSON.stringify(JSON.parse(raw).slice(0, -1)));
  assert.throws(() => gate.assess(valid), /nothing recorded/);
});

test('opt-in runtime guard refuses new work until clearance is recorded; default behaviour is unchanged', (t) => {
  const f = setup(t);
  const guarded = () => new ScientificRuntime(f.ledger, { requireResumeClearance: true });
  assert.throws(() => guarded().run({ seed: 51 }), /lacks resume clearance/);
  assert.equal(new ScientificRuntime(f.ledger).run({ seed: 51 }).state, 'completed', 'guard is off by default');
  const blocked = f.gate().assess(f.request({ observedBootId: 'boot-02' }));
  assert.equal(blocked.status, 'blocked');
  assert.throws(() => guarded().run({ seed: 52 }), /lacks resume clearance/);
  assert.equal(f.gate().assess(f.request()).status, 'conditions-met');
  assert.equal(guarded().run({ seed: 52 }).state, 'completed');
  // Idempotent replay of a finished operation is allowed regardless of clearance state.
  const g = setup(t);
  const done = new ScientificRuntime(g.ledger).run({ operationId: 'finished-before-guard', seed: 9 });
  assert.deepEqual(new ScientificRuntime(g.ledger, { requireResumeClearance: true }).run({ operationId: 'finished-before-guard', seed: 9 }), done);
});

test('resume and reconciliation records never feed scientific history', (t) => {
  const f = setup(t);
  f.gate().assess(f.request());
  const trace = f.ledger.read();
  const result = new ScientificRuntime(f.ledger, { requireResumeClearance: true }).run({ seed: 60, method: 'history' });
  const audited = new Set(trace.filter((e) => e.operation.startsWith('resume-') || e.operation.startsWith('reconcile-')).map((e) => e.hash));
  assert.equal(result.provenance.historyRefs.some((ref) => audited.has(ref)), false);
});
