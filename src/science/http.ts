import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { Ledger } from './store.ts';
import { ScientificRuntime, METHODS } from './runtime.ts';
import { CONDITIONS } from './protocol.ts';

let runtime: ScientificRuntime | undefined;
function getRuntime() {
  // Runtime data lives outside the checkout. Never accept a filesystem path from HTTP.
  return runtime ??= new ScientificRuntime(new Ledger(process.env.SCIENCE_DATA_DIR ?? join('/workspace', '.ziran-science'), process.env.SCIENCE_CHECKPOINT_FILE));
}
export async function scientificRoute(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  if (!path.startsWith('/api/science/')) return false;
  const send = (status: number, value: unknown) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
  try {
    // No authentication is invented: protect this loopback service against cross-site browser writes.
    const origin = req.headers.origin;
    if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`)) { send(403, { error: 'cross-origin scientific request denied' }); return true; }
    if (path === '/api/science/protocol' && req.method === 'GET') {
      send(200, { methods: METHODS, conditions: CONDITIONS, adapter: 'simulated-engine-only', claimStatus: 'synthetic-world result', physicalAtomicity: false }); return true;
    }
    if (path === '/api/science/cycles' && req.method === 'POST') {
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of req) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 4096) { send(413, { error: 'cycle request too large' }); return true; }
        chunks.push(Buffer.from(chunk));
      }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const key = req.headers['idempotency-key'];
      if (key !== undefined) {
        if (!input || typeof input !== 'object' || Array.isArray(input) || typeof key !== 'string' || (input.operationId !== undefined && input.operationId !== key)) throw Error('idempotency key conflict');
        input.operationId = key;
      }
      send(201, getRuntime().run(input)); return true;
    }
    if (path === '/api/science/ledger' && req.method === 'GET') {
      send(200, getRuntime().ledger.read()); return true;
    }
    if (path === '/api/science/checkpoint' && req.method === 'GET') {
      send(200, getRuntime().ledger.checkpoint()); return true;
    }
    if (path === '/api/science/recover' && req.method === 'POST') {
      send(200, getRuntime().recover()); return true;
    }
    send(404, { error: 'unknown scientific endpoint' });
  } catch (error) { send(400, { error: String((error as Error).message) }); }
  return true;
}
