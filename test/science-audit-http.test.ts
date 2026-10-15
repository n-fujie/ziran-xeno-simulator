import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function fixture(t: { after: (fn: () => void | Promise<void>) => void }) {
  const root = mkdtempSync(join(tmpdir(), 'science-http-audit-'));
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = (socket.address() as { port: number }).port; await new Promise<void>((ok) => socket.close(() => ok()));
  const child = spawn(process.execPath, ['src/server.ts'], { cwd: new URL('../', import.meta.url), env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), SCIENCE_DATA_DIR: join(root, 'store') }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  t.after(async () => { child.kill(); await exited; rmSync(root, { recursive: true, force: true }); });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(Error('server timeout')); }, 10000);
    child.once('error', (e) => { clearTimeout(timer); reject(e); });
    child.once('exit', () => { clearTimeout(timer); reject(Error('server exit before ready')); });
    child.stdout.on('data', (s) => { if (String(s).includes('→')) { clearTimeout(timer); resolve(); } });
  });
  return `http://127.0.0.1:${port}`;
}

test('cross-site scientific requests cannot trigger operations; same-origin and CLI remain compatible', { timeout: 15000 }, async (t) => {
  const base = await fixture(t);
  const disallowed: Record<string, string>[] = [{ origin: 'https://untrusted.example' }, { 'sec-fetch-site': 'cross-site' }];
  for (const headers of disallowed) {
    const response = await fetch(base + '/api/science/cycles', { method: 'POST', headers, body: '{}' });
    assert.equal(response.status, 403);
  }
  assert.deepEqual(await fetch(base + '/api/science/ledger').then((r) => r.json()), []);
  // A rebound origin matches its own hostile Host; Origin equality alone is insufficient.
  const rebound = await fetch(base + '/api/science/cycles', { method: 'POST', headers: { host: 'rebound.example', origin: 'http://rebound.example' }, body: '{}' });
  assert.equal(rebound.status, 403);
  assert.deepEqual(await fetch(base + '/api/science/ledger').then((r) => r.json()), []);
  assert.equal((await fetch(base + '/api/science/protocol', { headers: { origin: base } })).status, 200);
  assert.equal((await fetch(base + '/api/presets').then((r) => r.json())).length, 38);
});

test('lost HTTP response followed by retries executes one operation; conflicting keys are rejected', { timeout: 15000 }, async (t) => {
  const base = await fixture(t), key = 'audit-http-response-loss', body = JSON.stringify({ seed: 71 });
  await new Promise<void>((resolve, reject) => {
    const outgoing = request(base + '/api/science/cycles', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key } }, (response) => {
      assert.equal(response.statusCode, 201); response.destroy(); resolve();
    });
    outgoing.once('error', reject); outgoing.end(body);
  });
  const post = (payload: string) => fetch(base + '/api/science/cycles', { method: 'POST', headers: { 'idempotency-key': key }, body: payload });
  const a = await post(body).then((r) => r.json()), b = await post(body).then((r) => r.json());
  assert.deepEqual(a, b); assert.equal(a.id, key); assert.equal(a.intervention.consistent, true);
  const entries = await fetch(base + '/api/science/ledger').then((r) => r.json());
  assert.equal(entries.filter((e: { kind: string }) => e.kind === 'prepared').length, 1);
  assert.equal(entries.filter((e: { kind: string }) => e.kind === 'completed').length, 1);
  assert.equal((await post(JSON.stringify({ seed: 72 }))).status, 400);
  const checkpoint = await fetch(base + '/api/science/checkpoint').then((r) => r.json());
  assert.equal(checkpoint.count, entries.length);
  assert.equal(checkpoint.hash, entries.at(-1).hash);
});
