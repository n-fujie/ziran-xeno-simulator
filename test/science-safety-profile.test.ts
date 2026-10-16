import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProfiledRuntime, parseSafetyProfile, STRICT_SEGMENT_BYTES, SAFETY_PROFILES } from '../src/science/profile.ts';
import { certificate, tlsService } from './fixtures/tls.ts';
import { memoryStore } from './fixtures/ledger-faults.ts';

type Cleanup = { after: (fn: () => void | Promise<void>) => void };
const tmp = (t: Cleanup) => { const root = mkdtempSync(join(tmpdir(), 'safety-profile-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; };

test('profile names are exact; nothing else is accepted or guessed', () => {
  assert.deepEqual([...SAFETY_PROFILES], ['compat', 'strict']);
  for (const ok of [undefined, '', 'compat']) assert.equal(parseSafetyProfile(ok), 'compat');
  assert.equal(parseSafetyProfile('strict'), 'strict');
  for (const bad of ['STRICT', ' strict', 'off', 'none', 'true', '1', 'strict ', 'Compat']) assert.throws(() => parseSafetyProfile(bad), /unknown safety profile/, bad);
});

test('compat reproduces earlier behaviour; strict requires its prerequisites and enables every protection together', (t) => {
  const compat = createProfiledRuntime('compat', { directory: join(tmp(t), 'l') });
  assert.equal(compat.ledger.segmentLimit, undefined); assert.equal(compat.resumeClearanceRequired, false); assert.equal(compat.ledger.externalWitnessed, false);
  assert.throws(() => createProfiledRuntime('strict', { directory: join(tmp(t), 'l') }), /strict safety profile requires an external checkpoint binding/);
  const memory = memoryStore();
  const strict = createProfiledRuntime('strict', { directory: join(tmp(t), 'l'), external: memory.binding });
  assert.equal(strict.ledger.segmentLimit, STRICT_SEGMENT_BYTES); assert.equal(strict.resumeClearanceRequired, true); assert.equal(strict.ledger.externalWitnessed, true);
  assert.equal(createProfiledRuntime('strict', { directory: join(tmp(t), 'l'), external: memoryStore().binding, maxSegmentBytes: 65536 }).ledger.segmentLimit, 65536);
  assert.throws(() => createProfiledRuntime('strict', { directory: join(tmp(t), 'l'), external: memoryStore().binding, maxSegmentBytes: 10 }), /invalid segment size limit/);
  assert.equal(strict.run({ seed: 1, condition: 'coupled', method: 'adaptive' }).state, 'completed');
  assert.equal(memory.head().count, strict.ledger.read().length);
});

test('the strict profile keeps new work behind resume clearance after an interruption; compat does not', (t) => {
  const memory = memoryStore(), directory = join(tmp(t), 'l');
  const strict = createProfiledRuntime('strict', { directory, external: memory.binding });
  assert.throws(() => strict.run({ operationId: 'profile-interrupted-op' }, (p) => { if (p === 'after-connect') throw Error('simulated response loss'); }));
  assert.throws(() => strict.run({ seed: 2 }), /lacks resume clearance/);
  // Same history opened under compat: the earlier, weaker behaviour (documented gap), nothing else changes.
  const compat = createProfiledRuntime('compat', { directory, external: memory.binding });
  assert.equal(compat.run({ seed: 2 }).state, 'completed');
  assert.throws(() => strict.run({ operationId: 'profile-interrupted-op' }), /quarantined|conflict/);
});

async function server(t: Cleanup, env: Record<string, string>) {
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = (socket.address() as { port: number }).port; await new Promise<void>((ok) => socket.close(() => ok()));
  const child = spawn(process.execPath, ['src/server.ts'], { cwd: new URL('../', import.meta.url), env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { child.kill(); });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('server startup timeout')), 10000);
    child.once('exit', (code) => { clearTimeout(timer); reject(Error(`server exited ${code}`)); });
    child.stdout.on('data', (d) => { if (String(d).includes('→')) { clearTimeout(timer); resolve(); } });
  });
  return `http://127.0.0.1:${port}`;
}

test('HTTP service: default is compat; an unknown or incomplete strict profile fails closed and never falls back', { timeout: 60000 }, async (t) => {
  const dir = join(tmp(t), 'data');
  const base = await server(t, { SCIENCE_DATA_DIR: dir });
  assert.equal((await fetch(base + '/api/science/protocol').then((r) => r.json())).safetyProfile, 'compat');
  assert.equal((await fetch(base + '/api/science/cycles', { method: 'POST', body: JSON.stringify({ seed: 1 }) })).status, 201);
  const audit = await fetch(base + '/api/science/audit').then((r) => r.json());
  assert.equal(audit.rotation.enabled, false); assert.equal(audit.growth.appendRewritesWholeLedger, true);

  const bogusDir = join(tmp(t), 'data'), bogus = await server(t, { SCIENCE_DATA_DIR: bogusDir, SCIENCE_SAFETY_PROFILE: 'stricter' });
  for (const path of ['/api/science/protocol', '/api/science/audit']) { const r = await fetch(bogus + path); assert.equal(r.status, 400, path); assert.match((await r.json()).error, /unknown safety profile/); }
  assert.equal((await fetch(bogus + '/api/science/cycles', { method: 'POST', body: JSON.stringify({ seed: 1 }) })).status, 400);
  assert.equal(existsSync(join(bogusDir, 'ledger.json')), false, 'nothing was written under an invalid profile');

  const incompleteDir = join(tmp(t), 'data'), incomplete = await server(t, { SCIENCE_DATA_DIR: incompleteDir, SCIENCE_SAFETY_PROFILE: 'strict' });
  assert.equal((await fetch(incomplete + '/api/science/protocol').then((r) => r.json())).safetyProfile, 'strict');
  const refused = await fetch(incomplete + '/api/science/cycles', { method: 'POST', body: JSON.stringify({ seed: 1 }) });
  assert.equal(refused.status, 400); assert.match((await refused.json()).error, /checkpoint service configuration missing/);
  assert.equal(existsSync(incompleteDir) ? readdirSync(incompleteDir).includes('ledger.json') : false, false, 'strict without its checkpoint service writes nothing and does not run weaker');
});

test('HTTP service: strict with a real HTTPS checkpoint service rotates, witnesses externally and reports it', { timeout: 90000 }, async (t) => {
  const root = tmp(t), files = certificate(root, 'strict', 'IP:127.0.0.1,DNS:localhost');
  const svc = await tlsService(t, files);
  const base = await server(t, {
    SCIENCE_DATA_DIR: join(root, 'data'), SCIENCE_SAFETY_PROFILE: 'strict', NODE_EXTRA_CA_CERTS: files.cert,
    SCIENCE_CHECKPOINT_URL: svc.endpoint, SCIENCE_CHECKPOINT_HISTORY_ID: 'contract', SCIENCE_CHECKPOINT_SERIES_ID: 'series',
    SCIENCE_CHECKPOINT_TOKEN: 'contract-only-credential', SCIENCE_CHECKPOINT_TOKEN_EXPIRES_AT: String(Date.now() + 3600_000),
  });
  assert.equal((await fetch(base + '/api/science/cycles', { method: 'POST', body: JSON.stringify({ seed: 3 }) })).status, 201);
  const audit = await fetch(base + '/api/science/audit').then((r) => r.json());
  assert.equal(audit.integrity, 'verified'); assert.equal(audit.externalWitnessed, true);
  assert.equal(audit.rotation.enabled, true); assert.equal(audit.rotation.maxSegmentBytes, STRICT_SEGMENT_BYTES);
  assert.equal(audit.growth.activeSegmentBounded, true); assert.equal(audit.growth.appendRewritesWholeLedger, false);
  // The service (a separate process) holds the head for every durable entry written by the server.
  process.env.NODE_EXTRA_CA_CERTS = files.cert;
  try { assert.equal(svc.store.read('contract', 'series').count, audit.entries); } finally { delete process.env.NODE_EXTRA_CA_CERTS; }
});
