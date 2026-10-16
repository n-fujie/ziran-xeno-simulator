import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('existing HTTP runtime hosts scientific cycles and restores durable results after restart', { timeout: 20000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'science-http-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  async function start() {
    const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
    const port = (socket.address() as { port: number }).port; await new Promise<void>((ok) => socket.close(() => ok()));
    const child = spawn(process.execPath, ['src/server.ts'], { cwd: new URL('../', import.meta.url), env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), SCIENCE_DATA_DIR: directory }, stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => { child.kill(); });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(Error('server startup timeout')); }, 10000);
      child.once('error', (e) => { clearTimeout(timer); reject(e); });
      child.once('exit', (code) => { clearTimeout(timer); reject(Error(`server exited ${code}`)); });
      child.stdout.on('data', (data) => { if (String(data).includes('→')) { clearTimeout(timer); resolve(); } });
    });
    return { base: `http://127.0.0.1:${port}`, child };
  }
  const first = await start();
  assert.equal((await fetch(first.base + '/api/presets').then((r) => r.json())).length, 38);
  assert.match(await fetch(first.base + '/').then((r) => r.text()), /Ziran/);
  const post = (path: string, body: string) => fetch(first.base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  const response = await post('/api/science/cycles', JSON.stringify({ seed: 31, method: 'history' }));
  assert.equal(response.status, 201);
  const result = await response.json(); assert.equal(result.adoptionVerified, true);
  assert.equal((await post('/api/science/cycles', '{bad')).status, 400);
  assert.equal((await post('/api/science/cycles', JSON.stringify({ budget: 1000 }))).status, 400);
  assert.equal((await post('/api/science/cycles', ' '.repeat(4097))).status, 413);
  assert.equal((await fetch(first.base + '/api/science/missing')).status, 404);
  assert.equal((await fetch(first.base + '/api/science/protocol').then((r) => r.json())).physicalAtomicity, false);
  const before = await fetch(first.base + '/api/science/ledger').then((r) => r.json());
  const exited = once(first.child, 'exit'); first.child.kill(); await exited;
  const second = await start();
  assert.deepEqual(await fetch(second.base + '/api/science/ledger').then((r) => r.json()), before);
  const next = await fetch(second.base + '/api/science/cycles', { method: 'POST', body: JSON.stringify({ seed: 32, method: 'history' }) }).then((r) => r.json());
  assert.equal(next.provenance.historyRefs.length, 1);
});
