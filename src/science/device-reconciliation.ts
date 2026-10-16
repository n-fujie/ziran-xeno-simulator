import { randomUUID } from 'node:crypto';
import { hashOf } from '../core/hash.ts';
import { Ledger } from './store.ts';

export interface DeviceQuery { deviceId: string; operationId: string; nonce: string; issuedAt: number; deadline: number }
export interface DeviceSnapshot {
  deviceId: string; bootId: string; operationId: string; nonce: string; observedAt: number;
  connected: boolean; disconnected: boolean; safeStopped: boolean; lastOperationId: string; sequence: number;
  history: { operationId: string; kind: 'connect' | 'intervene' | 'disconnect'; sequence: number; confirmed: boolean }[];
  measurement: { acquiredAt: number; channels: string[]; operational: boolean };
}
export interface DeviceStateProbe {
  query(request: DeviceQuery): unknown;
  /** Verify authenticated source and the full response/request binding using an independently trusted key/channel. */
  verify(response: unknown, request: DeviceQuery): boolean;
}
export interface DeviceExpectation { deviceId: string; bootId: string; operationId: string; baselineSequence: number; requiredChannels: string[] }
export interface ReconciliationResult { auditId: string; status: 'verified-safe-stop' | 'quarantined'; reason: string; resumeAuthorized: false; physicalRecoveryVerified: false }

/** Read-only device reconciliation: records evidence, never actuates/retries or clears original quarantine. */
export class DeviceReconciler {
  constructor(privateLedger: Ledger, probe: DeviceStateProbe) { this.ledger = privateLedger; this.probe = probe; }
  private ledger: Ledger;
  private probe: DeviceStateProbe;
  reconcile(expected: DeviceExpectation, now: () => number = Date.now): ReconciliationResult {
    if (![expected.deviceId, expected.bootId, expected.operationId].every((s) => typeof s === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(s)) || !Number.isSafeInteger(expected.baselineSequence) || expected.baselineSequence < 0 || !Array.isArray(expected.requiredChannels) || !expected.requiredChannels.length || !expected.requiredChannels.every((s) => typeof s === 'string' && s.length > 0 && s.length <= 128)) throw Error('invalid device expectation');
    return this.ledger.exclusive(() => {
      const entries = this.ledger.read();
      const original = entries.filter((e) => e.operation === expected.operationId);
      if (!original.some((e) => e.kind === 'prepared') || original.at(-1)?.kind !== 'quarantined') throw Error('device reconciliation requires an explicitly quarantined operation');
      const phases = original.filter((e) => e.kind === 'event').map((e) => (e.data as { phase?: string }).phase);
      const issued = phases.flatMap((phase) => phase === 'connect-issued' ? ['connect'] : phase === 'intervention-issued' ? ['intervene'] : phase === 'disconnect-issued' ? ['disconnect'] : []);
      if (!issued.length) throw Error('no issued device phase to reconcile');
      const issuedAt = now(); if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) throw Error('invalid reconciliation clock');
      const request: DeviceQuery = { deviceId: expected.deviceId, operationId: expected.operationId, nonce: randomUUID(), issuedAt, deadline: issuedAt + 5000 };
      const auditId = `reconcile-${randomUUID()}`;
      this.ledger.append('prepared', auditId, { kind: 'device-reconciliation-v1', expected, request, originalTail: original.at(-1)!.hash });
      let reason = 'state-query-unavailable', verified = false, evidenceDigest: string | null = null;
      try {
        const response = this.probe.query(structuredClone(request));
        if (this.probe.verify(response, structuredClone(request)) !== true) reason = 'untrusted-device-state';
        else {
          const s = response as DeviceSnapshot, time = now();
          const history = s.history;
          const kinds = Array.isArray(history) ? history.map((h) => h.kind) : [];
          const allowed = issued.at(-1) === 'disconnect' ? issued : [...issued, 'disconnect'];
          if (s.deviceId !== expected.deviceId || s.bootId !== expected.bootId || s.operationId !== expected.operationId || s.nonce !== request.nonce) reason = 'device-or-query-mismatch';
          else if (!Number.isSafeInteger(time) || time < issuedAt || !Number.isSafeInteger(s.observedAt) || s.observedAt < issuedAt || s.observedAt > time || time > request.deadline || !Number.isFinite(s.measurement?.acquiredAt) || s.measurement.acquiredAt < issuedAt || s.measurement.acquiredAt > s.observedAt) reason = 'stale-device-state';
          else if (s.connected !== false || s.disconnected !== true || s.safeStopped !== true) reason = 'device-not-safe-stopped';
          else if (!Array.isArray(history) || !history.length || history.length !== allowed.length || kinds.some((kind, i) => kind !== allowed[i]) || history.some((h, i) => h.confirmed !== true || h.operationId !== expected.operationId || !Number.isSafeInteger(h.sequence) || h.sequence !== expected.baselineSequence + i + 1) || s.sequence !== history.at(-1)!.sequence || s.lastOperationId !== expected.operationId) reason = 'device-history-mismatch';
          else if (s.measurement?.operational !== true || !Array.isArray(s.measurement.channels) || !expected.requiredChannels.every((c) => s.measurement.channels.includes(c))) reason = 'measurement-capability-unverified';
          else { evidenceDigest = hashOf(s); verified = true; reason = 'fresh-authenticated-safe-stop-evidence'; }
        }
      } catch { /* Error details may contain credentials; persist only the bounded reason above. */ }
      const result: ReconciliationResult = { auditId, status: verified ? 'verified-safe-stop' : 'quarantined', reason, resumeAuthorized: false, physicalRecoveryVerified: false };
      this.ledger.append(verified ? 'completed' : 'quarantined', auditId, { ...result, kind: 'device-reconciliation-v1', originalOperation: expected.operationId, evidenceDigest });
      return result;
    });
  }
}
