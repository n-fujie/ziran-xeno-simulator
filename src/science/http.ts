import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { Ledger } from './store.ts';
import { ScientificRuntime, METHODS } from './runtime.ts';
import { CONDITIONS } from './protocol.ts';

let runtime: ScientificRuntime | undefined;
function getRuntime() {
  // Runtime data lives outside the checkout. Never accept a filesystem path from HTTP.
  return runtime ??= new ScientificRuntime(new Ledger(process.env.SCIENCE_DATA_DIR ?? join('/workspace', '.ziran-science')));
}
export async function scientificRoute(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  if (!path.startsWith('/api/science/')) return false;
  const send = (status: number, value: unknown) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
  try {
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
      send(201, getRuntime().run(JSON.parse(Buffer.concat(chunks).toString('utf8')))); return true;
    }
    if (path === '/api/science/ledger' && req.method === 'GET') {
      send(200, getRuntime().ledger.read()); return true;
    }
    if (path === '/api/science/recover' && req.method === 'POST') {
      send(200, getRuntime().recover()); return true;
    }
    send(404, { error: 'unknown scientific endpoint' });
  } catch (error) { send(400, { error: String((error as Error).message) }); }
  return true;
}
