import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { Ledger } from './store.ts';
import { ScientificRuntime, METHODS } from './runtime.ts';
import { CONDITIONS } from './protocol.ts';
import { auditLedger } from './ledger-audit.ts';
import { createProfiledRuntime, parseSafetyProfile } from './profile.ts';
import { checkpointBindingFromEnvironment } from './checkpoint-http.ts';

let runtime: ScientificRuntime | undefined;
function getRuntime() {
  // Runtime data lives outside the checkout. Never accept a filesystem path from HTTP.
  // SCIENCE_SAFETY_PROFILE selects 'compat' (default, earlier behaviour) or 'strict' (external checkpoint required,
  // segment rotation, resume clearance required). An unknown value or an incomplete strict configuration throws:
  // the service never falls back to weaker protection.
  if (runtime) return runtime;
  const profile = parseSafetyProfile(process.env.SCIENCE_SAFETY_PROFILE);
  const directory = process.env.SCIENCE_DATA_DIR ?? join('/workspace', '.ziran-science');
  // SCIENCE_LEDGER_VERIFICATION is a separate opt-in: 'full' (default) or 'section'. Unknown values throw.
  const mode = process.env.SCIENCE_LEDGER_VERIFICATION;
  if (mode !== undefined && mode !== '' && mode !== 'full' && mode !== 'section') throw Error('unknown ledger verification mode');
  return runtime = createProfiledRuntime(profile, { directory, checkpointFile: process.env.SCIENCE_CHECKPOINT_FILE, external: profile === 'strict' ? checkpointBindingFromEnvironment() : undefined, ...(mode === 'section' ? { verification: 'section' as const } : {}) });
}
export async function scientificRoute(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  if (!path.startsWith('/api/science/')) return false;
  const send = (status: number, value: unknown) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
  try {
    // No authentication is invented: protect this loopback service against cross-site browser writes.
    // Matching Origin to an arbitrary Host alone also accepts a DNS-rebinding browser origin.
    const binding = process.env.HOST ?? '127.0.0.1';
    const authority = new URL(`http://${req.headers.host ?? ''}`);
    const loopback = (host: string) => host === 'localhost' || host === '::1' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host);
    if (authority.username || authority.password || (loopback(binding) && !loopback(authority.hostname))) { send(403, { error: 'untrusted scientific host' }); return true; }
    const origin = req.headers.origin;
    if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`)) { send(403, { error: 'cross-origin scientific request denied' }); return true; }
    if (path === '/api/science/protocol' && req.method === 'GET') {
      send(200, { methods: METHODS, conditions: CONDITIONS, adapter: 'simulated-engine-only', claimStatus: 'synthetic-world result', physicalAtomicity: false, safetyProfile: parseSafetyProfile(process.env.SCIENCE_SAFETY_PROFILE) }); return true;
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
      getRuntime().ledger.read(); // Do not advertise an unchecked/stale local witness as a verified head.
      send(200, getRuntime().ledger.checkpoint()); return true;
    }
    if (path === '/api/science/audit' && req.method === 'GET') {
      send(200, auditLedger(getRuntime().ledger)); return true; // read-only; reports bounded categories, never raw errors
    }
    if (path === '/api/science/recover' && req.method === 'POST') {
      send(200, getRuntime().recover()); return true;
    }
    send(404, { error: 'unknown scientific endpoint' });
  } catch (error) { send(400, { error: String((error as Error).message) }); }
  return true;
}
