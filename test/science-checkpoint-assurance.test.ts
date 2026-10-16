import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CheckpointHttpStore } from '../src/science/checkpoint-http.ts';
import { Ledger } from '../src/science/store.ts';
import { ScientificRuntime } from '../src/science/runtime.ts';
import { evaluateCheckpointIndependence } from '../src/science/checkpoint-independence.ts';
import type { CheckpointIndependenceDeclaration } from '../src/science/checkpoint-independence.ts';

type Cleanup = { after: (fn: () => void | Promise<void>) => void };
function certificate(root: string, name: string, san: string) {
  const cert = join(root, `${name}.pem`), key = join(root, `${name}.key`);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=checkpoint-contract-test', '-addext', `subjectAltName=${san}`], { stdio: 'ignore' });
  return { cert, key };
}
async function tlsService(t: Cleanup, root: string, files: { cert: string; key: string }) {
  const child = fork(new URL('./fixtures/checkpoint-service.ts', import.meta.url), { env: { ...process.env, CONTRACT_TLS_CERT: files.cert, CONTRACT_TLS_KEY: files.key }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const exit = once(child, 'exit');
  t.after(async () => { child.kill(); await exit; });
  const [{ port }] = await once(child, 'message') as [{ port: number }];
  const store = new CheckpointHttpStore({ endpoint: `https://127.0.0.1:${port}`, timeoutMs: 5000, credential: () => ({ token: 'contract-only-credential', expiresAt: Date.now() + 60000 }) });
  return { store, binding: { historyId: 'contract', seriesId: 'series', store } };
}
/** The transport deliberately forwards only NODE_EXTRA_CA_CERTS from the parent environment. */
function withEnvironment<T>(env: Record<string, string | undefined>, action: () => T): T {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return action(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

test('actual HTTPS: an untrusted certificate fails closed, even when the parent disables TLS verification', { timeout: 45000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'checkpoint-tls-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const { store } = await tlsService(t, root, certificate(root, 'untrusted', 'IP:127.0.0.1,DNS:localhost'));
  for (const insecure of [undefined, '0']) {
    const error = withEnvironment({ NODE_EXTRA_CA_CERTS: undefined, NODE_TLS_REJECT_UNAUTHORIZED: insecure }, () => { try { store.read('contract', 'series'); } catch (e) { return e as Error; } });
    assert.match(String(error?.message), /^checkpoint transport failed; outcome unknown; explicit recovery required$/, `insecure=${insecure}`);
    assert.doesNotMatch(String(error?.message), /127\.0\.0\.1|CERT|self[- ]signed|certificate/i);
  }
});

test('actual HTTPS: an operator-trusted certificate carries reads, compare-and-set and a bound runtime end to end', { timeout: 60000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'checkpoint-tls-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = certificate(root, 'trusted', 'IP:127.0.0.1,DNS:localhost');
  const { store, binding } = await tlsService(t, root, files);
  withEnvironment({ NODE_EXTRA_CA_CERTS: files.cert }, () => {
    assert.equal(store.read('contract', 'series').count, 0);
    const ledger = new Ledger(join(root, 'ledger'), undefined, binding), runtime = new ScientificRuntime(ledger);
    const result = runtime.run({ seed: 71, operationId: 'https-bound-operation' });
    assert.equal(result.state, 'completed');
    const entries = ledger.read();
    assert.equal(store.read('contract', 'series').count, entries.length, 'external head advanced once per durable ledger entry');
    assert.deepEqual(runtime.run({ seed: 71, operationId: 'https-bound-operation' }), result, 'restart-style replay verifies against the HTTPS head');
  });
});

test('actual HTTPS: a trusted certificate for a different host name is rejected', { timeout: 45000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'checkpoint-tls-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = certificate(root, 'wrong-host', 'DNS:other.example');
  const { store } = await tlsService(t, root, files);
  withEnvironment({ NODE_EXTRA_CA_CERTS: files.cert }, () => {
    assert.throws(() => store.read('contract', 'series'), /checkpoint transport failed; outcome unknown/);
  });
});

const separate: CheckpointIndependenceDeclaration = { ledgerWriters: ['ops-team'], checkpointWriters: ['audit-service'], checkpointRetention: 'append-only-enforced', credentialSeparate: true, transport: 'https' };
test('independence is never "verified"; shared administrators or credentials are reported as not independent', () => {
  const ok = evaluateCheckpointIndependence(separate);
  assert.equal(ok.status, 'declared-independent-unverified'); assert.deepEqual(ok.reasons, []); assert.equal(ok.verifiedByRuntime, false);
  const variants: [string, Partial<CheckpointIndependenceDeclaration>, string, string][] = [
    ['same administrator', { checkpointWriters: ['OPS-team '] }, 'not-independent', 'shared-administrator'],
    ['administrator among several writers', { checkpointWriters: ['audit-service', 'ops-team'] }, 'not-independent', 'shared-administrator'],
    ['wildcard writer', { checkpointWriters: ['*'] }, 'not-independent', 'wildcard-writer'],
    ['credential reachable by ledger writers', { credentialSeparate: false }, 'not-independent', 'credential-reachable-by-ledger-writers'],
    ['mutable retention', { checkpointRetention: 'mutable' }, 'not-established', 'retention-mutable'],
    ['unknown retention', { checkpointRetention: 'unknown' }, 'not-established', 'retention-unknown'],
    ['test transport', { transport: 'loopback-http-test' }, 'not-established', 'transport-not-production-https'],
    ['unspecified writers', { ledgerWriters: [] }, 'not-established', 'writers-unspecified'],
    ['blank principal', { checkpointWriters: ['  '] }, 'not-established', 'writers-unspecified'],
  ];
  for (const [name, change, status, reason] of variants) {
    const verdict = evaluateCheckpointIndependence({ ...separate, ...change });
    assert.equal(verdict.status, status, name); assert.ok(verdict.reasons.includes(reason), `${name}: ${verdict.reasons}`); assert.equal(verdict.verifiedByRuntime, false);
  }
  // Shared control outranks a merely unestablished property.
  assert.equal(evaluateCheckpointIndependence({ ...separate, checkpointWriters: ['ops-team'], checkpointRetention: 'unknown' }).status, 'not-independent');
  assert.equal(evaluateCheckpointIndependence(undefined as never).status, 'not-independent');
});
