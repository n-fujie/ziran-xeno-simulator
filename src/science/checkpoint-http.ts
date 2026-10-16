import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sameHead } from './checkpoint.ts';
import type { ExternalCheckpointStore, ExternalHead, ExternalCheckpointBinding } from './checkpoint.ts';

export interface CheckpointCredential { token: string; expiresAt: number }
export interface CheckpointHttpOptions {
  endpoint: string; credential: () => CheckpointCredential; timeoutMs?: number;
  /** Contract tests only; this never permits remote plaintext endpoints. */
  allowLoopbackHttp?: boolean;
}
/** A bounded synchronous bridge to an operator-provided HTTPS CAS service. No automatic retries. */
export class CheckpointHttpStore implements ExternalCheckpointStore {
  private endpoint: string;
  private options: CheckpointHttpOptions;
  constructor(options: CheckpointHttpOptions) {
    const url = new URL(options.endpoint);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || (options.allowLoopbackHttp && local && url.protocol === 'http:'))) throw Error('invalid checkpoint service endpoint');
    const timeoutMs = options.timeoutMs ?? 5000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw Error('invalid checkpoint transport timeout');
    this.endpoint = url.href.replace(/\/$/, ''); this.options = { ...options, timeoutMs };
  }
  private call(historyId: string, seriesId: string, update?: { expected: ExternalHead; next: ExternalHead }): unknown {
    if (![historyId, seriesId].every((id) => /^[A-Za-z0-9_.-]{1,128}$/.test(id))) throw Error('invalid checkpoint service identity');
    let credential: CheckpointCredential;
    try { credential = this.options.credential(); } catch { throw Error('checkpoint credential unavailable'); }
    if (!credential || typeof credential.token !== 'string' || !credential.token || /[\r\n]/.test(credential.token) || !Number.isFinite(credential.expiresAt) || credential.expiresAt <= Date.now() + this.options.timeoutMs!) throw Error('checkpoint credential expired or invalid');
    const child = spawnSync(process.execPath, [fileURLToPath(new URL('./checkpoint-http-worker.ts', import.meta.url))], {
      input: JSON.stringify({ url: `${this.endpoint}/heads/${encodeURIComponent(historyId)}/${encodeURIComponent(seriesId)}${update ? '/cas' : ''}`, token: credential.token, timeoutMs: this.options.timeoutMs, update }),
      encoding: 'utf8', timeout: this.options.timeoutMs! + 1000, maxBuffer: 70000,
      // Credentials travel via stdin, never argv; do not inherit NODE_OPTIONS or unrelated secrets.
      env: process.env.NODE_EXTRA_CA_CERTS ? { NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS } : {},
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    if (child.error || child.status !== 0) throw Error('checkpoint transport failed; outcome unknown; explicit recovery required');
    let response: { status: number; value?: unknown };
    try { response = JSON.parse(child.stdout); } catch { throw Error('invalid checkpoint transport response'); }
    if (response.status === 409 || response.status === 412) throw Error('checkpoint update conflict');
    if (response.status === 401 || response.status === 403) throw Error('checkpoint authorization denied');
    if (response.status < 200 || response.status >= 300) throw Error('checkpoint service unavailable; outcome unknown');
    return response.value;
  }
  read(historyId: string, seriesId: string): ExternalHead {
    const value = this.call(historyId, seriesId) as ExternalHead;
    if (!value || value.version !== 1 || value.historyId !== historyId || value.seriesId !== seriesId || !Number.isSafeInteger(value.count) || value.count < 0 || !/^[a-f0-9]{64}$/.test(value.digest) || (value.count === 0 ? value.hash !== '' : !/^[a-f0-9]{64}$/.test(value.hash))) throw Error('invalid external checkpoint head');
    return { version: 1, historyId, seriesId, count: value.count, hash: value.hash, digest: value.digest };
  }
  compareAndSet(expected: ExternalHead, next: ExternalHead): void {
    if (!Number.isSafeInteger(expected.count) || expected.count < 0 || !Number.isSafeInteger(next.count) || next.version !== 1 || expected.version !== 1 || next.historyId !== expected.historyId || next.seriesId !== expected.seriesId || next.count !== expected.count + 1 || !/^[a-f0-9]{64}$/.test(next.hash) || !/^[a-f0-9]{64}$/.test(next.digest)) throw Error('invalid checkpoint update');
    const acknowledged = this.call(expected.historyId, expected.seriesId, { expected, next }) as ExternalHead;
    if (!sameHead(acknowledged, next)) throw Error('checkpoint acknowledgement mismatch; outcome unknown');
  }
}
/** Explicit opt-in for embedders. Does not alter the existing HTTP singleton or provision any service. */
export function checkpointBindingFromEnvironment(env: NodeJS.ProcessEnv = process.env): ExternalCheckpointBinding {
  const endpoint = env.SCIENCE_CHECKPOINT_URL, historyId = env.SCIENCE_CHECKPOINT_HISTORY_ID, seriesId = env.SCIENCE_CHECKPOINT_SERIES_ID;
  if (!endpoint || !historyId || !seriesId) throw Error('checkpoint service configuration missing');
  const store = new CheckpointHttpStore({ endpoint, credential: () => ({ token: env.SCIENCE_CHECKPOINT_TOKEN ?? '', expiresAt: Number(env.SCIENCE_CHECKPOINT_TOKEN_EXPIRES_AT) }) });
  return { historyId, seriesId, store };
}
