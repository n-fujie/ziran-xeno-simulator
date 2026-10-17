import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, chmodSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger } from './fixtures/ledger-mode.ts';
import { CheckpointHttpStore } from '../src/science/checkpoint-http.ts';
import { sha256 } from '../src/core/hash.ts';

// REAL faults: a real process killed with SIGKILL at an exact commit step (optionally against a separate-process
// HTTP checkpoint service), real kernel errors (EACCES from permissions, EFBIG from RLIMIT_FSIZE with a genuine
// torn write) and real multi-process contention. Power-loss durability of fsync ordering is NOT tested here.
type Cleanup = { after: (fn: () => void | Promise<void>) => void };
const CHILD = new URL('./fixtures/ledger-crash-child.ts', import.meta.url).pathname;
const tmp = (t: Cleanup) => { const root = mkdtempSync(join(tmpdir(), 'ledger-real-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; };
const strays = (dir: string) => [...readdirSync(dir).filter((f) => f.startsWith('.pending-')), ...readdirSync(join(dir, '..')).filter((f) => f.endsWith('.tmp'))];

async function child(env: Record<string, string>, shell?: string) {
  const proc = shell ? spawn('sh', ['-c', `${shell}; exec node ${CHILD}`], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'ignore'] }) : spawn(process.execPath, [CHILD], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'ignore'] });
  let out = ''; proc.stdout.on('data', (d) => { out += d; });
  const [code, signal] = await once(proc, 'exit') as [number | null, string | null];
  const lines = out.split('\n').filter(Boolean);
  return { code, signal, lines, acked: lines.filter((l) => l.startsWith('ack')).length, done: lines.includes('done'), error: lines.find((l) => l.startsWith('error')) };
}
async function service(t: Cleanup) {
  const proc = fork(new URL('./fixtures/checkpoint-service.ts', import.meta.url), { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const exit = once(proc, 'exit'); t.after(async () => { proc.kill(); await exit; });
  const [{ port }] = await once(proc, 'message') as [{ port: number }];
  const endpoint = `http://127.0.0.1:${port}`;
  const binding = { historyId: 'contract', seriesId: 'series', store: new CheckpointHttpStore({ endpoint, allowLoopbackHttp: true, credential: () => ({ token: 'contract-only-credential', expiresAt: Date.now() + 60000 }) }) };
  return { endpoint, binding };
}
/** What the survivors must satisfy after any crash: every acknowledged append is durable, nothing partial is
 * visible, recovery isolates unfinished work, and no abandoned file remains. */
function afterCrash(dir: string, acked: number, mode: string, binding?: ConstructorParameters<typeof Ledger>[2], tag = 'crash') {
  const ledger = new Ledger(dir, undefined, binding, { maxSegmentBytes: mode === 'rotating' ? 1000 : undefined });
  ledger.recoverDeadWriter(); // the killed process left its writer lock behind; the documented restart path removes a dead owner's lock
  const entries = ledger.recover();
  const main = entries.filter((e) => e.kind !== 'quarantined');
  const expected = (i: number) => (i % 2 === 0 ? ['prepared', `${tag}-op-${i / 2}`] : ['completed', `${tag}-op-${(i - 1) / 2}`]);
  assert.ok(main.length >= acked && main.length <= acked + 1, `acknowledged ${acked}, found ${main.length}`);
  main.forEach((e, i) => assert.deepEqual([e.kind, e.operation], expected(i), `entry ${i}`));
  const quarantined = entries.filter((e) => e.kind === 'quarantined');
  assert.equal(quarantined.length, main.at(-1)?.kind === 'prepared' ? 1 : 0, 'only an unfinished operation is isolated');
  assert.deepEqual(strays(dir), []);
  assert.deepEqual(ledger.layout().unreferencedSegments, []);
  ledger.exclusive(() => ledger.append('prepared', 'after-crash-op', { ok: true }));
  assert.equal(ledger.read().at(-1)!.operation, 'after-crash-op');
  return { entries, committedUnacknowledged: main.length === acked + 1 };
}

const LABELS: Record<string, string[]> = {
  compat: ['write:pending', 'fsync:pending', 'fsync:dir#1', 'write:witness', 'fsync:witness', 'rename:witness', 'fsync:dir#2', 'rename:pending', 'fsync:dir#3'],
  rotating: ['write:pending', 'fsync:pending', 'fsync:dir#1', 'write:witness', 'fsync:witness', 'rename:witness', 'fsync:dir#2', 'link:segment', 'fsync:dir#3', 'rename:pending', 'fsync:dir#4'],
};
for (const mode of ['compat', 'rotating']) test(`real SIGKILL at every commit step (${mode}): acknowledged appends are durable and recovery is defined`, { timeout: 120000 }, async (t) => {
  const seen = new Set<string>();
  for (const label of LABELS[mode]) {
    const dir = join(tmp(t), 'l');
    const r = await child({ DIR: dir, MODE: mode, KILL_LABEL: label, KILL_NTH: label === 'link:segment' ? '2' : '5' });
    assert.equal(r.signal, 'SIGKILL', `${mode}/${label}: the child really died by SIGKILL`);
    assert.equal(r.done, false);
    const { committedUnacknowledged } = afterCrash(dir, r.acked, mode);
    seen.add(`${label}:${committedUnacknowledged ? 'committed' : 'absent'}`);
  }
  // Before the witness is durable the append is absent; once the witness is durable it is committed on recovery.
  assert.ok(seen.has('write:pending:absent') && seen.has('rename:witness:absent'));
  assert.ok(seen.has('fsync:dir#2:committed') && seen.has('rename:pending:committed'));
  if (mode === 'rotating') assert.ok(seen.has('link:segment:committed') && seen.has('fsync:dir#3:committed'));
});

test('real SIGKILL against the real HTTP checkpoint service: the external head and the local ledger converge after a crash', { timeout: 120000 }, async (t) => {
  for (const label of ['fsync:dir#2', 'link:segment', 'rename:pending', 'write:witness']) {
    const svc = await service(t), dir = join(tmp(t), 'l');
    const r = await child({ DIR: dir, MODE: 'rotating', ENDPOINT: svc.endpoint, KILL_LABEL: label, KILL_NTH: label === 'link:segment' ? '2' : '4' });
    assert.equal(r.signal, 'SIGKILL', label);
    const { entries } = afterCrash(dir, r.acked, 'rotating', svc.binding);
    const head = svc.binding.store.read('contract', 'series');
    assert.equal(head.count, entries.length + 1 /* the post-crash append */, `${label}: the service holds the recovered chain`);
  }
});

const root = process.getuid?.() === 0;
test('real EACCES: a ledger directory the process cannot write fails the append and changes nothing', { skip: root ? 'permission faults are not producible as root' : false }, (t) => {
  for (const mode of ['compat', 'rotating']) {
    const parent = tmp(t), dir = join(parent, 'l');
    const ledger = new Ledger(dir, undefined, undefined, { maxSegmentBytes: mode === 'rotating' ? 1000 : undefined });
    for (let i = 0; i < 3; i++) ledger.exclusive(() => { ledger.append('prepared', `seed-${i}`, { pad: 'x'.repeat(700) }); ledger.append('completed', `seed-${i}`, {}); });
    const before = ledger.read(), digest = sha256(JSON.stringify(before));
    for (const target of [dir, parent]) {
      chmodSync(target, 0o500);
      try { assert.throws(() => ledger.exclusive(() => ledger.append('prepared', 'denied-op', {})), (e: NodeJS.ErrnoException) => e.code === 'EACCES', `${mode}: ${target === dir ? 'ledger dir' : 'witness dir'}`); }
      finally { chmodSync(target, 0o700); }
      assert.equal(sha256(JSON.stringify(ledger.recover())), digest, `${mode}: history unchanged after denied write`);
      assert.deepEqual(strays(dir), []);
    }
    ledger.exclusive(() => ledger.append('prepared', 'granted-op', {}));
    assert.equal(ledger.read().length, before.length + 1);
  }
});

for (const mode of ['compat', 'rotating']) test(`real EFBIG (${mode}): the kernel stops a write mid-file; the torn file is never trusted and the history is intact`, { timeout: 60000 }, async (t) => {
  const dir = join(tmp(t), 'l');
  // `ulimit -f 100` caps every file the child writes at 100 blocks (512 B in some shells, 1 KiB in others: 50-100 KiB),
  // enforced by the kernel. The final 400 KB entry exceeds either; the six small appends before it fit in both.
  const r = await child({ DIR: dir, MODE: mode, PAIRS: '3', PAD: '300', BIG_BYTES: '400000' }, 'ulimit -f 100');
  assert.equal(r.error, 'error EFBIG', `the kernel reported a real file-size error (${r.lines.join(',')})`);
  assert.equal(r.done, false);
  const torn = readdirSync(dir).filter((f) => f.startsWith('.pending-'));
  assert.equal(torn.length, 1, 'a torn pending file really exists');
  const size = statSync(join(dir, torn[0])).size;
  assert.ok(size > 0 && size < 400000, `a genuine partial write reached the disk: ${size} of >400000 bytes`);
  const ledger = new Ledger(dir, undefined, undefined, { maxSegmentBytes: mode === 'rotating' ? 1000 : undefined });
  assert.equal(ledger.read().length, 6, 'only the six acknowledged appends are visible; the torn write is not history');
  ledger.recover();
  assert.deepEqual(strays(dir), []);
  assert.equal(ledger.read().length, 6);
  assert.equal(r.acked, 6);
});

test('real multi-process contention (rotating): four processes append concurrently, nothing is lost, duplicated or interleaved', { timeout: 120000 }, async (t) => {
  const dir = join(tmp(t), 'l'); new Ledger(dir, undefined, undefined, { maxSegmentBytes: 3000 });
  const runs = await Promise.all([0, 1, 2, 3].map((n) => child({ DIR: dir, MODE: 'rotating', RETRY_LOCK: '1', TAG: `proc${n}`, PAIRS: '10', PAD: '400' })));
  for (const r of runs) { assert.equal(r.done, true, r.lines.join(',')); assert.equal(r.signal, null); }
  const ledger = new Ledger(dir, undefined, undefined, { maxSegmentBytes: 3000 });
  const entries = ledger.read();
  assert.equal(entries.length, 4 * 10 * 2);
  for (let n = 0; n < 4; n++) {
    const own = entries.filter((e) => e.operation.startsWith(`proc${n}-op-`));
    assert.equal(own.length, 20);
    own.forEach((e, i) => assert.deepEqual([e.kind, e.operation], i % 2 === 0 ? ['prepared', `proc${n}-op-${i / 2}`] : ['completed', `proc${n}-op-${(i - 1) / 2}`]));
  }
  assert.ok(ledger.layout().sealed.length >= 3);
  assert.deepEqual(strays(dir), []);
});

test('a live writer cannot be displaced: a second process fails closed and a live lock is never stolen', { timeout: 30000 }, async (t) => {
  const dir = join(tmp(t), 'l'), ledger = new Ledger(dir), lock = join(dir, 'writer.lock');
  writeFileSync(lock, JSON.stringify({ pid: process.pid }), { flag: 'wx' }); // a live holder: this very process
  try {
    const r = await child({ DIR: dir, TAG: 'blocked', PAIRS: '1' });
    assert.equal(r.error, 'error EEXIST'); assert.equal(r.acked, 0);
    assert.throws(() => ledger.recoverDeadWriter(), /writer is alive/);
    assert.equal(readFileSync(lock, 'utf8'), JSON.stringify({ pid: process.pid }), 'the live lock was not stolen');
  } finally { rmSync(lock, { force: true }); }
  assert.equal(ledger.read().length, 0);
  // A lock left by a process that really died is removable.
  const dead = spawn(process.execPath, ['-e', '0']); await once(dead, 'exit');
  writeFileSync(lock, JSON.stringify({ pid: dead.pid }), { flag: 'wx' });
  ledger.recoverDeadWriter();
  assert.equal(statSync(dir).isDirectory() && !readdirSync(dir).includes('writer.lock'), true);
});
