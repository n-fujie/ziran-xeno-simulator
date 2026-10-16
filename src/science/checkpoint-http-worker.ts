// Private synchronous-bridge worker. Never print URLs, credentials, response error bodies or stack traces.
import { readFileSync } from 'node:fs';
try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const response = await fetch(input.url, {
    method: input.update ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(input.timeoutMs),
    headers: { authorization: `Bearer ${input.token}`, 'content-type': 'application/json' },
    body: input.update ? JSON.stringify(input.update) : undefined,
  });
  if (!response.ok) { await response.body?.cancel(); process.stdout.write(JSON.stringify({ status: response.status })); }
  else {
    const chunks: Uint8Array[] = []; let size = 0;
    for await (const chunk of response.body ?? []) { size += chunk.byteLength; if (size > 65536) throw Error(); chunks.push(chunk); }
    process.stdout.write(JSON.stringify({ status: response.status, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
  }
} catch { process.exitCode = 1; }
