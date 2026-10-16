import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger } from '../src/science/store.ts';
import { ScientificRuntime } from '../src/science/runtime.ts';
import { DeviceReconciler } from '../src/science/device-reconciliation.ts';
import type { DeviceSnapshot, DeviceQuery, DeviceExpectation, DeviceStateProbe } from '../src/science/device-reconciliation.ts';

const key = 'contract-model-only-signing-key';
function sign(value: unknown) { return createHmac('sha256', key).update(JSON.stringify(value)).digest('hex'); }
function setup(t: { after: (fn: () => void) => void }, point: 'after-connect' | 'after-disconnect' = 'after-connect') {
  const root = mkdtempSync(join(tmpdir(), 'device-reconcile-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const ledger = new Ledger(join(root, 'ledger')), runtime = new ScientificRuntime(ledger);
  const operationId = 'device-uncertain-operation';
  assert.throws(() => runtime.run({ operationId }, (phase) => { if (phase === point) throw Error('simulated device response loss'); }));
  const expected: DeviceExpectation = { deviceId: 'device-01', bootId: 'boot-01', operationId, baselineSequence: 10, requiredChannels: ['x'] };
  let queries = 0;
  let mutate: (s: DeviceSnapshot) => void = () => {};
  let trusted = true, unavailable = false;
  const probe: DeviceStateProbe = {
    query(request: DeviceQuery) {
      queries++; if (unavailable) throw Error('credential=must-not-be-persisted');
      const kinds = point === 'after-connect' ? ['connect', 'disconnect'] as const : ['connect', 'intervene', 'disconnect'] as const;
      const value: DeviceSnapshot = {
        deviceId: expected.deviceId, bootId: expected.bootId, operationId, nonce: request.nonce, observedAt: 1000,
        connected: false, disconnected: true, safeStopped: true, lastOperationId: operationId, sequence: expected.baselineSequence + kinds.length,
        history: kinds.map((kind, i) => ({ operationId, kind, sequence: expected.baselineSequence + i + 1, confirmed: true })),
        measurement: { acquiredAt: 1000, channels: ['x'], operational: true },
      };
      mutate(value); return { ...value, signature: sign(value) };
    },
    verify(response, request) {
      if (!trusted || !response || typeof response !== 'object') return false;
      const { signature, ...value } = response as DeviceSnapshot & { signature: string };
      return typeof signature === 'string' && signature.length === 64 && timingSafeEqual(Buffer.from(signature), Buffer.from(sign(value))) && value.nonce === request.nonce;
    },
  };
  const reconciler = () => new DeviceReconciler(new Ledger(ledger.directory), probe);
  return { ledger, expected, reconciler, queries: () => queries, mutate: (fn: typeof mutate) => { mutate = fn; }, untrust: () => { trusted = false; }, asyncVerifier: () => { probe.verify = () => Promise.resolve(true) as unknown as boolean; }, outage: () => { unavailable = true; } };
}

for (const point of ['after-connect', 'after-disconnect'] as const) test(`device ${point}: authenticated fresh safe-stop is recorded, original operation stays quarantined`, (t) => {
  const f = setup(t, point), result = f.reconciler().reconcile(f.expected, () => 1000);
  assert.equal(result.status, 'verified-safe-stop'); assert.equal(result.resumeAuthorized, false); assert.equal(result.physicalRecoveryVerified, false);
  const entries = f.ledger.read();
  assert.equal(entries.filter((e) => e.operation === f.expected.operationId).at(-1)?.kind, 'quarantined');
  assert.equal(entries.at(-1)?.kind, 'completed');
  assert.throws(() => new ScientificRuntime(f.ledger).run({ operationId: f.expected.operationId }), /quarantined/);
  assert.equal(f.queries(), 1);
});

test('unreachable or unauthenticated device remains quarantined and never leaks adapter exception', (t) => {
  for (const mode of ['outage', 'untrusted']) {
    const f = setup(t); if (mode === 'outage') f.outage(); else f.untrust();
    assert.equal(f.reconciler().reconcile(f.expected, () => 1000).status, 'quarantined');
    assert.doesNotMatch(readFileSync(join(f.ledger.directory, 'ledger.json'), 'utf8'), /must-not-be-persisted/);
  }
});

test('device identity, reboot, old response and unsafe connection cannot establish recovery', (t) => {
  const changes: ((s: DeviceSnapshot) => void)[] = [
    (s) => { s.deviceId = 'other'; }, (s) => { s.bootId = 'old-boot'; }, (s) => { s.operationId = 'other'; },
    (s) => { s.nonce = 'replayed'; }, (s) => { s.observedAt = 999; }, (s) => { s.measurement.acquiredAt = 999; },
    (s) => { s.connected = true; }, (s) => { s.disconnected = false; }, (s) => { s.safeStopped = false; },
    (s) => { s.measurement.channels = []; }, (s) => { s.measurement.operational = false; },
  ];
  for (const change of changes) { const f = setup(t); f.mutate(change); assert.equal(f.reconciler().reconcile(f.expected, () => 1000).status, 'quarantined'); }
});

test('duplicate, reversed, missing, conflicting and unconfirmed device operations remain isolated', (t) => {
  const changes: ((s: DeviceSnapshot) => void)[] = [
    (s) => { s.history.reverse(); }, (s) => { s.history.push(s.history[0]); }, (s) => { s.history.pop(); },
    (s) => { s.history[0].operationId = 'competing-operation'; }, (s) => { s.history[0].confirmed = false; },
    (s) => { s.history[0].sequence = 9; }, (s) => { s.sequence = 9; }, (s) => { s.lastOperationId = 'other'; },
    (s) => { s.history[0].kind = 'intervene'; },
  ];
  for (const change of changes) { const f = setup(t); f.mutate(change); assert.equal(f.reconciler().reconcile(f.expected, () => 1000).status, 'quarantined'); }
});

test('repeated reconciliation queries have fresh nonces and never repeat original actuation', (t) => {
  const f = setup(t), before = f.ledger.read().filter((e) => e.kind === 'event').length;
  const a = f.reconciler().reconcile(f.expected, () => 1000), b = f.reconciler().reconcile(f.expected, () => 1000);
  assert.notEqual(a.auditId, b.auditId); assert.equal(f.queries(), 2);
  const entries = f.ledger.read(); assert.equal(entries.filter((e) => e.kind === 'event').length, before);
  const nonces = entries.filter((e) => e.kind === 'prepared' && e.operation.startsWith('reconcile-')).map((e) => (e.data as { request: DeviceQuery }).request.nonce);
  assert.equal(new Set(nonces).size, 2);
});

test('device query deadline and invalid trusted clock fail closed', (t) => {
  const f = setup(t); let calls = 0;
  assert.equal(f.reconciler().reconcile(f.expected, () => ++calls === 1 ? 1000 : 7000).status, 'quarantined');
  assert.throws(() => f.reconciler().reconcile(f.expected, () => NaN), /clock/);
});

test('query-only reconciliation requires a durable original quarantine and excludes live-writer races', (t) => {
  const f = setup(t);
  assert.throws(() => f.reconciler().reconcile({ ...f.expected, operationId: 'missing-operation' }, () => 1000), /quarantined/);
  f.ledger.exclusive(() => assert.throws(() => f.reconciler().reconcile(f.expected, () => 1000), /EEXIST/));
  assert.equal(f.queries(), 0);
});

test('scientific history queries ignore reconciliation audit entries and remain executable', (t) => {
  const f = setup(t); assert.equal(f.reconciler().reconcile(f.expected, () => 1000).status, 'verified-safe-stop');
  const result = new ScientificRuntime(f.ledger).run({ seed: 2, method: 'history' });
  assert.equal(result.version, 2); assert.equal(result.intervention?.consistent, true);
  assert.deepEqual(result.provenance.historyRefs, []);
});


test('an accidentally asynchronous verifier cannot authenticate a device response', (t) => {
  const f = setup(t); f.asyncVerifier();
  assert.equal(f.reconciler().reconcile(f.expected, () => 1000).status, 'quarantined');
});
