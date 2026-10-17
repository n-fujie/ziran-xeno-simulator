import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger, nodeLedgerFs } from '../src/science/store.ts';
import type { LedgerFs } from '../src/science/store.ts';
import { ScientificRuntime } from '../src/science/runtime.ts';
import { SCENARIOS, run, build, cleanup, flip, settle } from './fixtures/tamper-scenarios.ts';
import type { Outcome } from './fixtures/tamper-scenarios.ts';

// Stage-2/3 matrix: every attack is run against BOTH verification modes. The table below is the contract. `accepted`
// next to an attack is an attack the local design cannot see by construction (no independent anchor) and is identical
// in both modes; it is listed explicitly so it can never be mistaken for a pass.
const BLOCKED: Outcome = 'blocked-in-section';
type Row = { full: Outcome; section: Outcome };
const same = (o: Outcome): Row => ({ full: o, section: o });
const EXPECTED: Record<string, Row> = {
  'T01': same(BLOCKED), 'T02': same(BLOCKED), 'T03': same(BLOCKED), 'T04': same(BLOCKED), 'T05': same(BLOCKED), 'T06a': same(BLOCKED), 'T06b': same(BLOCKED),
  'T07': same(BLOCKED), 'T07+ext': same(BLOCKED), 'T08': same(BLOCKED), 'T10': same(BLOCKED), 'T12': same(BLOCKED), 'T13': same(BLOCKED), 'T14': same(BLOCKED),
  // Consistent forgery of the whole local state (files + witness) with no independent anchor: invisible to ANY local verification.
  'T09': same('accepted'), 'T11': same('accepted'),
  'T09x+ext': same(BLOCKED), 'T11x+ext': same(BLOCKED), 'T15+ext': same(BLOCKED),
  'R01': same(BLOCKED), 'R02': same(BLOCKED), 'R03': same('failed-safe'), 'R04': same('failed-safe'), 'R05': same('failed-safe'), 'R06': same(BLOCKED),
  'R07': { full: 'caught-later', section: BLOCKED }, 'R12a': same(BLOCKED), 'R12b': same(BLOCKED),
  // A foreign witness overwritten by this writer's own atomic witness rename: the commit is self-consistent, nothing is lost that
  // the ledger had; a lock-ignoring writer's update cannot be detected without an external compare-and-set.
  'R08': same('accepted'), 'R15+ext': same('failed-safe'),
};
for (const s of SCENARIOS) for (const external of s.external === 'both' ? [false, true] : [s.external]) {
  const key = `${s.id}${external ? '+ext' : ''}`;
  test(`matrix ${key}: ${s.title}`, () => {
    const expected = EXPECTED[key]; assert.ok(expected, `${key} has an expected outcome`);
    assert.equal(run(s, 'full', external).outcome, expected.full, 'full');
    assert.equal(run(s, 'section', external).outcome, expected.section, 'section');
  });
}

test('attributes are a tripwire, never proof: if the attributes cannot reveal a change, a sealed segment altered inside one section is only caught by the next full verification', () => {
  // A filesystem or attacker for which attributes are useless (coarse timestamps, forged clock, same-tick change).
  const blind: LedgerFs = { ...nodeLedgerFs, signatureSync: () => 'same' };
  for (const mode of ['full', 'section'] as const) {
    const ctx = build(false);
    try {
      const l = new Ledger(ctx.dir, undefined, undefined, { verification: mode, maxSegmentBytes: 1000, fs: blind });
      let inSection = 'appended';
      try { l.exclusive(() => { l.read(); l.append('prepared', 'w', {}); settle(); flip(ctx.seg(0), true); l.append('event', 'w', {}); }); } catch (e) { inSection = String((e as Error).message); }
      if (mode === 'full') assert.match(inSection, /sealed segment mismatch/, 'full mode re-reads every sealed byte at every append');
      else assert.equal(inSection, 'appended', 'section mode, blind attributes: the window is exactly this one');
      assert.throws(() => new Ledger(ctx.dir, undefined, undefined, { maxSegmentBytes: 1000 }).read(), /sealed segment mismatch/, `${mode}: the next verification refuses the history`);
      assert.throws(() => new Ledger(ctx.dir, undefined, undefined, { verification: 'section', maxSegmentBytes: 1000 }).read(), /sealed segment mismatch/);
    } finally { cleanup(ctx); }
  }
});

test('lock ownership: a lock replaced by another owner is never unlinked by this section; a section that lost its lock does not report success', () => {
  const ctx = build(false);
  try {
    const l = new Ledger(ctx.dir, undefined, undefined, { verification: 'section', maxSegmentBytes: 1000 });
    const lock = join(ctx.dir, 'writer.lock');
    // (a) replaced by someone else: the next append stops, and their lock file survives our exit.
    assert.throws(() => l.exclusive(() => { l.append('prepared', 'a', {}); writeFileSync(lock, JSON.stringify({ pid: process.pid, token: 'someone-else' })); l.append('event', 'a', {}); }), /writer lock lost/);
    assert.equal(JSON.parse(readFileSync(lock, 'utf8')).token, 'someone-else', 'a foreign lock is left alone');
    unlinkSync(lock);
    // (b) deleted, and the section finishes without another append: still reported, not silently successful.
    assert.throws(() => l.exclusive(() => { l.append('prepared', 'b', {}); unlinkSync(lock); }), /writer lock lost during the section/);
    // (c) the history written before the loss is intact and verified; the ledger is usable again.
    assert.equal(new Ledger(ctx.dir, undefined, undefined, { maxSegmentBytes: 1000 }).read().filter((e) => e.operation === 'a' || e.operation === 'b').length, 2);
    l.recover();
    l.exclusive(() => l.append('prepared', 'after', {}));
    // (d) a legacy lock file without a token, from an older version, still blocks a second writer and is still recoverable.
    writeFileSync(lock, JSON.stringify({ pid: 2 ** 22 + 12345 }));
    assert.throws(() => l.exclusive(() => {}), (e: NodeJS.ErrnoException) => e.code === 'EEXIST');
    l.recoverDeadWriter();
    assert.equal(existsSync(lock), false);
    writeFileSync(lock, JSON.stringify({ pid: process.pid }));
    assert.throws(() => l.recoverDeadWriter(), /writer is alive/);
    unlinkSync(lock);
  } finally { cleanup(ctx); }
});

test('recovery and a second writer cannot run inside an open section; a reader never sees an unverified history', () => {
  const ctx = build(true);
  try {
    const writer = new Ledger(ctx.dir, undefined, ctx.memory.binding, { verification: 'section', maxSegmentBytes: 1000 });
    const other = new Ledger(ctx.dir, undefined, ctx.memory.binding, { verification: 'section', maxSegmentBytes: 1000 });
    writer.exclusive(() => {
      writer.append('prepared', 'busy', {});
      assert.throws(() => other.recover(), (e: NodeJS.ErrnoException) => e.code === 'EEXIST', 'recovery needs the writer lock');
      assert.throws(() => other.exclusive(() => other.append('event', 'busy', {})), (e: NodeJS.ErrnoException) => e.code === 'EEXIST');
      writer.append('completed', 'busy', {});
    });
    assert.equal(other.read().at(-1)!.operation, 'busy');
  } finally { cleanup(ctx); }
});

test('real processes: a reader polling while a section-mode writer commits sees only complete, fully verified prefixes (or refuses)', { timeout: 120000 }, async () => {
  const CHILD = new URL('./fixtures/ledger-crash-child.ts', import.meta.url).pathname;
  const root = mkdtempSync(join(tmpdir(), 'ledger-rw-')), dir = join(root, 'l');
  try {
    const proc = spawn(process.execPath, [CHILD], { env: { ...process.env, DIR: dir, MODE: 'rotating', PAIRS: '60', LEDGER_TEST_VERIFICATION: 'section' }, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = ''; proc.stdout.on('data', (d) => { out += d; });
    const exited = once(proc, 'exit');
    let done = false; exited.then(() => { done = true; });
    const lengths: number[] = []; const failures = new Set<string>();
    while (!done) {
      if (!existsSync(`${dir}.checkpoint`)) { await new Promise((r) => setTimeout(r, 5)); continue; }
      try { lengths.push(new Ledger(dir, undefined, undefined, { maxSegmentBytes: 1000 }).read().length); }
      catch (e) {
        // A reader that arrives while the writer is still creating a brand-new ledger can see the first witness empty:
        // a refused read like any other, only possible before the first verified read.
        if (lengths.length > 0 || !(e instanceof SyntaxError)) failures.add(String((e as Error).message).replace(/\d+/g, 'N').slice(0, 60));
      }
      await new Promise((r) => setTimeout(r, 2));
    }
    await exited;
    assert.ok(out.includes('done'), 'the writer finished');
    assert.ok(lengths.length >= 3, `the reader completed ${lengths.length} verified reads`);
    assert.deepEqual([...lengths].sort((a, b) => a - b), lengths, 'every successful read is a longer verified prefix of the same history');
    for (const f of failures) assert.match(f, /^(ledger integrity|external checkpoint|ENOENT)/, `a refused read is an integrity refusal, never wrong data: ${f}`);
    assert.equal(new Ledger(dir, undefined, undefined, { maxSegmentBytes: 1000 }).read().length, 120);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('resume guard + section mode: a tampered sealed segment stops new work at the start of the section', () => {
  const ctx = build(false);
  try {
    const ledger = new Ledger(ctx.dir, undefined, undefined, { verification: 'section', maxSegmentBytes: 1000 });
    const guarded = new ScientificRuntime(ledger, { requireResumeClearance: true });
    settle(); flip(ctx.seg(0), true);
    assert.throws(() => guarded.run({ seed: 5 }), /sealed segment mismatch/);
    assert.equal(guarded.resumeClearanceRequired, true);
  } finally { cleanup(ctx); }
});

test('safety profiles: the strict profile still refuses to start without its prerequisites when section mode is requested, and never falls back to a weaker setup', async () => {
  const { createProfiledRuntime } = await import('../src/science/profile.ts');
  const root = mkdtempSync(join(tmpdir(), 'ledger-profile-'));
  try {
    assert.throws(() => createProfiledRuntime('strict', { directory: join(root, 's'), verification: 'section' }), /requires an external checkpoint/);
    assert.throws(() => createProfiledRuntime('strict', { directory: join(root, 't'), verification: 'fast' as 'section' }), /requires an external checkpoint|invalid verification mode/);
    assert.equal(existsSync(join(root, 's')) || existsSync(join(root, 't')), false, 'a refused start creates no ledger');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
