// Smoke-checks every HTTP endpoint against a freshly started server on a free port.
// Usage: node scripts/check-api.ts        (exit code 1 if any endpoint fails)
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port: number = await new Promise((ok) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)); }); });
const srv = spawn(process.execPath, ['src/server.ts'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise<void>((ok) => srv.stdout!.on('data', (d) => { if (String(d).includes('→')) ok(); }));

const base = `http://127.0.0.1:${port}`;
let failed = 0;
async function hit(method: string, path: string, body?: unknown, check: (j: any) => boolean = () => true): Promise<any> {
  const t0 = Date.now();
  const r = await fetch(base + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let j: any = text; try { j = JSON.parse(text); } catch { /* static or JSONL */ }
  const ok = r.ok && check(j);
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${method.padEnd(4)} ${path.padEnd(48)} ${r.status}  ${Date.now() - t0}ms`);
  return j;
}

try {
  await hit('GET', '/', undefined, (j) => typeof j === 'string' && j.includes('Ziran'));
  await hit('GET', '/app.js');
  await hit('GET', '/style.css');
  const presets = await hit('GET', '/api/presets', undefined, (j) => Array.isArray(j) && j.length > 0);
  await hit('GET', '/api/perturbation-types', undefined, (j) => Array.isArray(j) || typeof j === 'object');
  const a = await hit('POST', '/api/run', { preset: 'observation.hidden-phase' }, (j) => !!j.id);
  const b = await hit('POST', '/api/run', { preset: 'market.synthetic' }, (j) => !!j.id);
  await hit('POST', '/api/batch', { experiments: [{ preset: 'core.operational-sampler', seed: 1 }, { preset: 'core.operational-sampler', seed: 2 }] }, (j) => Array.isArray(j) && j.length === 2);
  await hit('GET', '/api/runs', undefined, (j) => Array.isArray(j) && j.length >= 4);
  await hit('GET', `/api/runs/${a.id}`, undefined, (j) => j.id === a.id);
  await hit('GET', `/api/runs/${a.id}/trace`, undefined, (j) => Array.isArray(j.events));
  await hit('GET', `/api/runs/${a.id}/tii`, undefined, (j) => typeof j === 'string' || typeof j === 'object');
  await hit('GET', `/api/runs/${a.id}/events?kinds=effect&limit=5`);
  await hit('GET', `/api/runs/${a.id}/timeline`);
  await hit('GET', `/api/runs/${a.id}/event/1`);
  await hit('GET', `/api/runs/${a.id}/penetration/1`);
  await hit('GET', `/api/runs/${a.id}/analysis`, undefined, (j) => !!j.claimStatus && Array.isArray(j.levelEvents));
  await hit('GET', `/api/runs/${a.id}/replay?upto=10`, undefined, (j) => typeof j.state === 'object');
  await hit('POST', `/api/runs/${a.id}/rerun`, undefined, (j) => j.equal === true);
  await hit('POST', '/api/compare', { a: a.id, b: a.id }, (j) => !!j.diff);
  await hit('GET', `/api/runs/${b.id}/emergence`);
  await hit('GET', `/api/runs/${b.id}/schema-sensitivity`, undefined, (j) => !!j.sensitivity?.statement);
  await hit('GET', '/api/meta', undefined, (j) => Array.isArray(j.entries) && j.entries.length > 0);
  await hit('GET', '/api/theory/list', undefined, (j) => Array.isArray(j) && j.length >= 14);
  await hit('GET', '/api/bench/layers', undefined, (j) => Array.isArray(j));
  await hit('POST', '/api/bench', undefined, (j) => j.layers.length > 0 && j.theory.length >= 14 && j.meta.length >= 7);
  await hit('GET', '/api/bench', undefined, (j) => !!j?.at);
  const bad = await fetch(base + '/api/runs/nope/analysis'); console.log(`${bad.status === 404 ? '✓' : '✗'} GET  unknown run → ${bad.status}`); if (bad.status !== 404) failed++;
  console.log(`\n${presets.length} presets listed; ${failed} endpoint check(s) failed`);
} finally { srv.kill(); }
process.exitCode = failed ? 1 : 0;
