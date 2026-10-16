// A separate-process HTTP contract model. Not a deployed immutable service.
import { createServer } from 'node:http';
import { sha256 } from '../../src/core/hash.ts';
import { sameHead } from '../../src/science/checkpoint.ts';
let head = { version: 1 as const, historyId: 'contract', seriesId: 'series', count: 0, hash: '', digest: sha256('[]') };
let mode = 'normal', writes = 0, redirected = 0;
const server = createServer(async (req, res) => {
  if (req.url === '/redirected') { redirected++; res.end('{}'); return; }
  if (req.headers.authorization !== 'Bearer contract-only-credential' || mode === 'unauthorized') { res.writeHead(401); res.end('credential detail must not escape'); return; }
  if (mode === 'forbidden') { res.writeHead(403); res.end('private error'); return; }
  if (mode === 'hang') return;
  if (mode === 'unavailable') { res.writeHead(503); res.end('private failure'); return; }
  if (mode === 'redirect') { res.writeHead(307, { location: '/redirected' }); res.end(); return; }
  if (mode === 'oversize') { res.end('x'.repeat(70000)); return; }
  if (mode === 'corrupt') { res.end('{bad json'); return; }
  if (req.method === 'GET' && req.url === '/heads/contract/series') { res.end(JSON.stringify(head)); return; }
  if (req.method === 'POST' && req.url === '/heads/contract/series/cas') {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const { expected, next } = JSON.parse(Buffer.concat(chunks).toString());
    if (mode === 'drop-before') { req.socket.destroy(); return; }
    if (!sameHead(head, expected) || next.count !== head.count + 1) { res.writeHead(409); res.end('stale expected head'); return; }
    head = next; writes++;
    if (mode === 'drop-after') { req.socket.destroy(); return; }
    res.end(JSON.stringify(mode === 'wrong-ack' ? { ...head, hash: 'a'.repeat(64) } : head)); return;
  }
  res.writeHead(404); res.end('{}');
});
process.on('message', (message: { mode?: string; request: number }) => {
  if (message.mode) mode = message.mode;
  process.send?.({ request: message.request, head, writes, redirected });
});
server.listen(0, '127.0.0.1', () => process.send?.({ port: (server.address() as { port: number }).port }));
