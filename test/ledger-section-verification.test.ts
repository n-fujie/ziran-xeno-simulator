import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger } from '../src/science/store.ts';
import type { VerificationMode } from '../src/science/store.ts';
import { auditLedger } from '../src/science/ledger-audit.ts';
import { createProfiledRuntime } from '../src/science/profile.ts';
import { control, faultyFs, memoryStore } from './fixtures/ledger-faults.ts';

// The opt-in `verification: 'section'` mode. Full verification stays the default; these tests pin down exactly what
// the section mode still detects, what it deliberately defers to the next section, and that it never changes history.
type Cleanup = { after: (fn: () => void) => void };
const tmp = (t: Cleanup) => { const root = mkdtempSync(join(tmpdir(), 'ledger-section-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; };
const pad = (n: number) => 'x'.repeat(n);
const segmentFiles = (dir: string) => readdirSync(dir).filter((f) => /^segment-\d{6}\.json$/.test(f)).sort();
function cycle(ledger: Ledger, i: number, size = 600) {
  ledger.exclusive(() => { ledger.append('prepared', `op-${i}`, { pad: pad(size) }); for (let k = 0; k < 3; k++) ledger.append('event', `op-${i}`, { k }); ledger.append('completed', `op-${i}`, { ok: i }); });
}
function make(t: Cleanup, verification: VerificationMode, options: { rotate?: boolean; external?: boolean; fs?: ReturnType<typeof faultyFs> } = {}) {
  const root = tmp(t), memory = memoryStore(), dir = join(root, 'l');
  const open = (v: VerificationMode = verification, fs = options.fs) => new Ledger(dir, undefined, options.external ? memory.binding : undefined, { verification: v, ...(options.rotate === false ? {} : { maxSegmentBytes: 1000 }), ...(fs ? { fs } : {}) });
  return { root, dir, witness: join(root, 'l.checkpoint'), memory, open };
}
/** Flip one byte inside a file without changing its length. */
function flipByte(file: string) { const raw = readFileSync(file, 'utf8'), at = raw.indexOf('xxxx'); assert.ok(at > 0); writeFileSync(file, raw.slice(0, at) + 'y' + raw.slice(at + 1)); }

test('verification mode: full is the default, unknown values are refused, section is opt-in per opener', (t) => {
  const f = make(t, 'full');
  assert.equal(new Ledger(f.dir).verificationMode, 'full');
  assert.equal(f.open('section').verificationMode, 'section');
  assert.throws(() => new Ledger(f.dir, undefined, undefined, { verification: 'fast' as VerificationMode }), /invalid verification mode/);
  assert.throws(() => new Ledger(f.dir, undefined, undefined, { verification: '' as VerificationMode }), /invalid verification mode/);
});

for (const rotate of [false, true]) test(`section mode writes exactly the same history as full mode (${rotate ? 'rotating' : 'single file'}): same entries, same bytes, same witness`, (t) => {
  const a = make(t, 'full', { rotate }), b = make(t, 'section', { rotate });
  const la = a.open(), lb = b.open();
  for (let i = 0; i < 14; i++) { cycle(la, i); cycle(lb, i); }
  assert.deepEqual(lb.read(), la.read());
  assert.deepEqual(segmentFiles(b.dir), segmentFiles(a.dir));
  if (rotate) assert.ok(segmentFiles(a.dir).length >= 2, 'the workload really rotated');
  for (const name of ['ledger.json', ...segmentFiles(a.dir)]) assert.equal(readFileSync(join(b.dir, name), 'utf8'), readFileSync(join(a.dir, name), 'utf8'), name);
  const wa = JSON.parse(readFileSync(a.witness, 'utf8')), wb = JSON.parse(readFileSync(b.witness, 'utf8'));
  delete wa.pending; delete wb.pending;
  assert.deepEqual(wb, wa);
  // Each mode also reads the other's files.
  assert.equal(a.open('section').read().length, b.open('full').read().length);
});

test('section mode verifies the whole history once per section; full mode verifies it at every append', (t) => {
  const f = make(t, 'section');
  const seed = f.open(); for (let i = 0; i < 6; i++) cycle(seed, i);
  const section = f.open('section'), full = f.open('full');
  section.exclusive(() => { section.read(); for (let k = 0; k < 5; k++) section.append(k === 0 ? 'prepared' : 'event', 'counted', {}); });
  assert.deepEqual(section.verificationCounts, { full: 1, incremental: 5 }, 'one whole-history verification, five section-level checks');
  full.exclusive(() => { full.read(); for (let k = 0; k < 5; k++) full.append('event', 'counted', {}); });
  assert.deepEqual(full.verificationCounts, { full: 6, incremental: 0 });
  // Without a preceding read the first append performs the section's one full verification.
  const cold = f.open('section'); cold.exclusive(() => { cold.append('event', 'counted', {}); cold.append('event', 'counted', {}); });
  assert.deepEqual(cold.verificationCounts, { full: 1, incremental: 1 });
  // Outside a section nothing is retained: every read() is a whole-history verification.
  const reader = f.open('section'); reader.read(); reader.read();
  assert.deepEqual(reader.verificationCounts, { full: 2, incremental: 0 });
});

test('nothing carries over between sections: tampering a sealed segment between two sections is caught by the next section', (t) => {
  const f = make(t, 'section');
  const ledger = f.open(); for (let i = 0; i < 6; i++) cycle(ledger, i);
  cycle(ledger, 6); // the same object just verified and wrote this history
  const first = segmentFiles(f.dir)[0]; assert.ok(first);
  flipByte(join(f.dir, first));
  assert.throws(() => cycle(ledger, 7), /sealed segment mismatch/, 'the same Ledger object, new section: full verification again');
  assert.throws(() => ledger.read(), /sealed segment mismatch/);
  assert.throws(() => f.open('full').read(), /sealed segment mismatch/);
  assert.equal(auditLedger(ledger).integrity, 'failed', 'the audit always verifies the whole history');
});

test('a sealed segment altered INSIDE one section: both modes refuse to continue (section mode via the attribute tripwire, which only ever escalates to a full verification)', (t) => {
  for (const mode of ['full', 'section'] as const) {
    const f = make(t, mode);
    const ledger = f.open(); for (let i = 0; i < 6; i++) cycle(ledger, i);
    const first = segmentFiles(f.dir)[0];
    let outcome = 'appended';
    try {
      ledger.exclusive(() => { ledger.append('prepared', 'window-op', {}); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30); flipByte(join(f.dir, first)); ledger.append('completed', 'window-op', {}); });
    } catch (e) { outcome = String((e as Error).message); }
    assert.match(outcome, /sealed segment mismatch/, `${mode}: refused at the next append`);
    // The tampering is permanent evidence: nothing blesses it, and every later verification refuses it.
    assert.throws(() => f.open('full').read(), /sealed segment mismatch/, mode);
    assert.throws(() => f.open('section').read(), /sealed segment mismatch/, mode);
  }
});

test('section mode still checks, at every append, what an attacker can change between two appends: active file, witness, external head', (t) => {
  // Active file bytes.
  let f = make(t, 'section'); let l = f.open(); for (let i = 0; i < 4; i++) cycle(l, i);
  assert.throws(() => l.exclusive(() => { l.append('prepared', 'a', {}); writeFileSync(join(f.dir, 'ledger.json'), readFileSync(join(f.dir, 'ledger.json'), 'utf8') + '\n'); l.append('event', 'a', {}); }), /checkpoint mismatch|integrity/);
  // A rolled-back witness.
  f = make(t, 'section'); l = f.open(); for (let i = 0; i < 4; i++) cycle(l, i);
  assert.throws(() => l.exclusive(() => { l.append('prepared', 'b', {}); const old = readFileSync(f.witness, 'utf8'); l.append('event', 'b', {}); writeFileSync(f.witness, old); l.append('event', 'b', {}); }), /checkpoint mismatch|integrity/);
  // A witness pointing at a forged digest.
  f = make(t, 'section'); l = f.open(); for (let i = 0; i < 4; i++) cycle(l, i);
  assert.throws(() => l.exclusive(() => { l.append('prepared', 'c', {}); const w = JSON.parse(readFileSync(f.witness, 'utf8')); w.digest = '0'.repeat(64); writeFileSync(f.witness, JSON.stringify(w)); l.append('event', 'c', {}); }), /checkpoint mismatch|integrity/);
  // A deleted tail (active file replaced by an older copy).
  f = make(t, 'section'); l = f.open(); for (let i = 0; i < 4; i++) cycle(l, i);
  assert.throws(() => l.exclusive(() => { l.append('prepared', 'd', {}); const old = readFileSync(join(f.dir, 'ledger.json'), 'utf8'); l.append('event', 'd', {}); writeFileSync(join(f.dir, 'ledger.json'), old); l.append('event', 'd', {}); }), /checkpoint mismatch|integrity/);
  // External head moved by someone else (rolled back, replaced, or advanced elsewhere).
  f = make(t, 'section', { external: true }); l = f.open(); for (let i = 0; i < 4; i++) cycle(l, i);
  assert.throws(() => l.exclusive(() => { l.append('prepared', 'e', {}); f.memory.set({ ...f.memory.head(), count: f.memory.head().count - 1, hash: '1'.repeat(64) }); l.append('event', 'e', {}); }), /external checkpoint mismatch/);
  // And the rejected state is not blessed: a fresh verification still refuses it.
  assert.throws(() => f.open('full').read(), /external checkpoint mismatch/);
});

test('a segment swapped for another valid segment, or removed, is caught by the next section', (t) => {
  const f = make(t, 'section'); const l = f.open(); for (let i = 0; i < 8; i++) cycle(l, i);
  const [a, b] = segmentFiles(f.dir); assert.ok(a && b);
  const rawA = readFileSync(join(f.dir, a)), rawB = readFileSync(join(f.dir, b));
  writeFileSync(join(f.dir, a), rawB); writeFileSync(join(f.dir, b), rawA);
  assert.throws(() => cycle(l, 99), /sealed segment mismatch/);
  writeFileSync(join(f.dir, a), rawA); writeFileSync(join(f.dir, b), rawB);
  cycle(l, 100); // restored bytes verify again: nothing was blessed and nothing was lost
  rmSync(join(f.dir, a));
  assert.throws(() => cycle(l, 101), /sealed segment missing/);
});

test('a failed or unconfirmed append drops what the section verified: the retry is a full verification, never a continuation', (t) => {
  // Faults after the witness is durable leave a committed-but-unfinished state that only recovery may finish.
  const refused = new Set(['fsync:dir#2', 'rename:pending']);
  for (const label of ['fsync:dir#2', 'rename:pending', 'fsync:dir#3']) {
    const c = control(), f = make(t, 'section', { external: true, fs: faultyFs(c) });
    const l = f.open(); for (let i = 0; i < 4; i++) cycle(l, i);
    let retry = 'not attempted', fullsAdded = -1;
    try {
      l.exclusive(() => {
        l.append('prepared', 'drop-op', {});
        c.armed = { label, code: 'EIO' }; // armed after the section has verified and written: the next append fails
        try { l.append('event', 'drop-op', { n: 1 }); } catch (e) { assert.match(String((e as Error).message), /injected storage fault/); }
        const before = l.verificationCounts.full;
        try { l.append('event', 'drop-op', { n: 2 }); retry = 'appended'; } catch (e) { retry = `refused: ${(e as Error).message}`; } finally { fullsAdded = l.verificationCounts.full - before; }
      });
    } catch (e) { assert.fail(`unexpected: ${(e as Error).message}`); }
    assert.equal(fullsAdded, 1, `${label}: the retry verified the whole history again instead of trusting the section's earlier state`);
    if (refused.has(label)) assert.match(retry, /^refused: .*(checkpoint mismatch|interrupted)/, `${label}: an unconfirmed append is never treated as success`);
    // Whatever happened, the defined restart path works in section mode and the result is one consistent history.
    const restarted = f.open('section');
    const after = restarted.recover();
    assert.ok(after.some((e) => e.operation === 'drop-op'), label);
    assert.equal(f.memory.head().count, after.length, label);
    assert.deepEqual(f.open('full').read(), after, label);
  }
  // A fault that leaves nothing durable (before the witness) is retryable inside the same section, after a full verification.
  const c = control(), f = make(t, 'section', { fs: faultyFs(c) });
  const l = f.open(); for (let i = 0; i < 4; i++) cycle(l, i);
  l.exclusive(() => {
    l.append('prepared', 'retry-op', {});
    c.armed = { label: 'write:pending', code: 'ENOSPC', partial: true };
    assert.throws(() => l.append('event', 'retry-op', { n: 1 }), /ENOSPC/);
    const fulls = l.verificationCounts.full;
    l.append('event', 'retry-op', { n: 2 }); l.append('completed', 'retry-op', {});
    assert.equal(l.verificationCounts.full, fulls + 1);
  });
  assert.deepEqual(f.open('full').read().filter((e) => e.operation === 'retry-op').map((e) => e.kind), ['prepared', 'event', 'completed']);
  for (const stray of readdirSync(f.dir).filter((n) => n.startsWith('.pending-'))) rmSync(join(f.dir, stray));
});

test('operation-state rules hold for the single-entry check: duplicate prepare, event outside an operation, event after completion', (t) => {
  for (const mode of ['full', 'section'] as const) {
    const f = make(t, mode); const l = f.open();
    l.exclusive(() => {
      assert.throws(() => l.append('event', 'ghost', {}), /event outside active operation/);
      l.append('prepared', 'one', {});
      assert.throws(() => l.append('prepared', 'one', {}), /duplicate operation/);
      l.append('completed', 'one', {});
      assert.throws(() => l.append('event', 'one', {}), /event outside active operation/);
      assert.throws(() => l.append('completed', 'one', {}), /event outside active operation/);
      assert.throws(() => l.append('bogus' as 'event', 'one', {}), /event outside active operation|invalid chain/);
      l.append('prepared', 'two', {}); // the section is usable again after a refused append (it re-verified fully)
    });
    assert.deepEqual(f.open('full').read().map((e) => `${e.kind}:${e.operation}`), ['prepared:one', 'completed:one', 'prepared:two'], mode);
  }
});

test('concurrency: a second writer is refused while a section is open; a concurrent reader sees only verified prefixes', (t) => {
  const f = make(t, 'section'); const writer = f.open(), other = f.open('section'), reader = f.open('full');
  for (let i = 0; i < 4; i++) cycle(writer, i);
  const seen: number[] = [];
  writer.exclusive(() => {
    writer.append('prepared', 'busy', {}); seen.push(reader.read().length);
    assert.throws(() => other.exclusive(() => other.append('event', 'busy', {})), (e: NodeJS.ErrnoException) => e.code === 'EEXIST');
    writer.append('event', 'busy', {}); seen.push(reader.read().length);
    writer.append('completed', 'busy', {}); seen.push(reader.read().length);
  });
  assert.deepEqual(seen.map((n, i) => n - seen[0] - i), [0, 0, 0], 'each read sees exactly the entries committed so far');
  other.exclusive(() => other.append('prepared', 'after', {})); // the refused writer works once the lock is free
});

test('audit and resume tooling always verify the whole history, whatever the opener asked for', (t) => {
  const f = make(t, 'section'); const l = f.open(); for (let i = 0; i < 5; i++) cycle(l, i);
  const report = auditLedger(l);
  assert.equal(report.integrity, 'verified');
  assert.deepEqual(report.verification, { mode: 'section', auditVerifiedWholeHistory: true });
  assert.equal(auditLedger(f.open('full')).verification.mode, 'full');
  // Profiles never switch the mode on by themselves; it is a separate, explicit choice.
  const dirs = ['compat', 'strict'] as const;
  for (const profile of dirs) {
    const external = f.memory.binding;
    const base = { directory: join(f.root, `p-${profile}`), external };
    assert.equal(createProfiledRuntime(profile, base).ledger.verificationMode, 'full', `${profile} defaults to full`);
    assert.equal(createProfiledRuntime(profile, { ...base, directory: join(f.root, `q-${profile}`), verification: 'section' }).ledger.verificationMode, 'section');
  }
  assert.ok(!existsSync(join(f.root, 'unused')));
});

test('a real process killed with SIGKILL during a section-mode cycle leaves a defined state that full verification and recovery accept', { timeout: 60000 }, async (t) => {
  const CHILD = new URL('./fixtures/ledger-crash-child.ts', import.meta.url).pathname;
  for (const label of ['write:pending', 'rename:witness', 'fsync:dir#2', 'rename:pending']) {
    const root = tmp(t), dir = join(root, 'l');
    const proc = spawn(process.execPath, [CHILD], { env: { ...process.env, DIR: dir, MODE: 'rotating', PAIRS: '6', KILL_LABEL: label, KILL_NTH: '9', LEDGER_TEST_VERIFICATION: 'section' }, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = ''; proc.stdout.on('data', (d) => { out += d; });
    const [, signal] = await once(proc, 'exit') as [number | null, string | null];
    assert.equal(signal, 'SIGKILL', label);
    const acked = out.split('\n').filter((l) => l.startsWith('ack')).length;
    const ledger = new Ledger(dir, undefined, undefined, { verification: 'section', maxSegmentBytes: 1000 });
    ledger.recoverDeadWriter();
    const entries = ledger.recover();
    const main = entries.filter((e) => e.kind !== 'quarantined');
    assert.ok(main.length >= acked && main.length <= acked + 1, `${label}: acknowledged ${acked}, found ${main.length}`);
    assert.deepEqual(new Ledger(dir, undefined, undefined, { maxSegmentBytes: 1000 }).read(), entries, `${label}: full verification agrees`);
    assert.deepEqual(readdirSync(dir).filter((n) => n.startsWith('.pending-')), [], label);
  }
});
