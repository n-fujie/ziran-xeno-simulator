// Shared TLS contract-service helpers (test support only): a generated self-signed certificate and a separate-process
// HTTPS checkpoint service built on the existing contract fixture.
import { fork, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { CheckpointHttpStore } from '../../src/science/checkpoint-http.ts';

export type Cleanup = { after: (fn: () => void | Promise<void>) => void };
export function certificate(root: string, name: string, san: string) {
  const cert = join(root, `${name}.pem`), key = join(root, `${name}.key`);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=checkpoint-contract-test', '-addext', `subjectAltName=${san}`], { stdio: 'ignore' });
  return { cert, key };
}
export async function tlsService(t: Cleanup, files: { cert: string; key: string }) {
  const child = fork(new URL('./checkpoint-service.ts', import.meta.url), { env: { ...process.env, CONTRACT_TLS_CERT: files.cert, CONTRACT_TLS_KEY: files.key }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const exit = once(child, 'exit');
  t.after(async () => { child.kill(); await exit; });
  const [{ port }] = await once(child, 'message') as [{ port: number }];
  const endpoint = `https://127.0.0.1:${port}`;
  const store = new CheckpointHttpStore({ endpoint, timeoutMs: 5000, credential: () => ({ token: 'contract-only-credential', expiresAt: Date.now() + 60000 }) });
  return { store, endpoint, binding: { historyId: 'contract', seriesId: 'series', store } };
}
