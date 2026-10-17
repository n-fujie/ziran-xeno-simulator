// Child process for real-process fault tests. Appends operations to a ledger and reports every ACKNOWLEDGED
// append on stdout with a synchronous write, so the parent knows what the child was told was durable.
// Controlled entirely by environment variables; optional kill step (SIGKILL) at an exact commit label.
import { writeSync } from 'node:fs';
import { Ledger } from './ledger-mode.ts';
import { CheckpointHttpStore } from '../../src/science/checkpoint-http.ts';
import { control, faultyFs } from './ledger-faults.ts';

const env = process.env;
const c = control();
if (env.KILL_LABEL) c.armed = { label: env.KILL_LABEL, kill: true, nth: Number(env.KILL_NTH ?? 1) };
const binding = env.ENDPOINT ? { historyId: 'contract', seriesId: 'series', store: new CheckpointHttpStore({ endpoint: env.ENDPOINT, allowLoopbackHttp: true, timeoutMs: 5000, credential: () => ({ token: 'contract-only-credential', expiresAt: Date.now() + 60000 }) }) } : undefined;
const ledger = new Ledger(env.DIR!, undefined, binding, { fs: faultyFs(c), maxSegmentBytes: env.MODE === 'rotating' ? 1000 : undefined });
process.on('SIGXFSZ', () => { /* surface the kernel's file-size limit as EFBIG instead of terminating */ });
const say = (line: string) => writeSync(1, line + '\n');
const pairs = Number(env.PAIRS ?? 6), tag = env.TAG ?? 'crash';
let acked = 0;
function appendPair(i: number) {
  ledger.exclusive(() => {
    ledger.append('prepared', `${tag}-op-${i}`, { pad: 'x'.repeat(Number(env.PAD ?? 700)) }); say(`ack ${++acked}`);
    ledger.append('completed', `${tag}-op-${i}`, { ok: i }); say(`ack ${++acked}`);
  });
}
function appendWithRetry(i: number) {
  for (let n = 0; n < 2000; n++) {
    try { appendPair(i); return; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2 + (n % 7)); }
  }
  throw Error('could not obtain the writer lock');
}
try {
  for (let i = 0; i < pairs; i++) (env.RETRY_LOCK ? appendWithRetry : appendPair)(i);
  if (env.BIG_BYTES) { ledger.exclusive(() => { ledger.append('prepared', `${tag}-big`, { pad: 'y'.repeat(Number(env.BIG_BYTES)) }); say(`ack ${++acked}`); }); }
  say('done');
} catch (error) {
  say(`error ${(error as NodeJS.ErrnoException).code ?? 'unknown'}`);
  process.exitCode = 3;
}
