// Tamper and race scenarios for ledger verification, run identically against both verification modes.
// Each scenario builds a rotated ledger (several sealed segments), opens ONE exclusive section, performs the
// attack at an exact point, then reports what the system did. Outcomes are observations, never assumptions:
//   blocked-in-section   an append of the same section refused to continue (safe stop)
//   failed-safe          the append in progress failed, nothing was blessed
//   caught-later         the section went on, but the next full verification (read/new section) refuses the history
//   accepted             every later verification accepts the result (either harmless, or an attack the design cannot see)
// `accepted` for an attack is a finding, not a pass: the expected table in the test file states which are inherent.
import { mkdtempSync, rmSync, cpSync, readdirSync, readFileSync, writeFileSync, utimesSync, statSync, unlinkSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger, nodeLedgerFs } from '../../src/science/store.ts';
import type { LedgerFs, VerificationMode } from '../../src/science/store.ts';
import { sha256 } from '../../src/core/hash.ts';
import { memoryStore } from './ledger-faults.ts';

export type Outcome = 'blocked-in-section' | 'failed-safe' | 'caught-later' | 'accepted';
export interface Result { outcome: Outcome; message: string }
export interface Ctx { root: string; dir: string; witness: string; memory: ReturnType<typeof memoryStore>; segments(): string[]; seg(i: number): string }
interface Scenario {
  id: string; title: string;
  /** Run with an external checkpoint binding? Both variants are run when 'both'. */
  external: boolean | 'both';
  /** Where the attack happens relative to the section. */
  at: 'before-section' | 'before-first-load' | 'after-read' | 'between-appends' | 'hook';
  attack(ctx: Ctx, hooks: Hooks): void;
}
/** Filesystem spy: lets a scenario act at an exact filesystem step of the ledger's own commit. */
export interface Hooks { on(op: string, match: RegExp | string, once: () => void): void }

const pad = (n: number) => 'x'.repeat(n);
function cycle(ledger: Ledger, i: number) {
  ledger.exclusive(() => { ledger.append('prepared', `op-${i}`, { pad: pad(600) }); for (let k = 0; k < 3; k++) ledger.append('event', `op-${i}`, { k }); ledger.append('completed', `op-${i}`, { ok: i }); });
}
const templates = new Map<boolean, { root: string; head: ReturnType<ReturnType<typeof memoryStore>['head']> }>();
/** A rotated ledger of ten cycles (several sealed segments). Built once per process and copied for each scenario. */
export function build(external: boolean): Ctx {
  let template = templates.get(external);
  if (!template) {
    const root = mkdtempSync(join(tmpdir(), 'ledger-template-')), memory = memoryStore();
    const seed = new Ledger(join(root, 'l'), undefined, external ? memory.binding : undefined, { maxSegmentBytes: 1000 });
    for (let i = 0; i < 10; i++) cycle(seed, i);
    template = { root, head: memory.head() }; templates.set(external, template);
    process.on('exit', () => rmSync(root, { recursive: true, force: true }));
  }
  const root = mkdtempSync(join(tmpdir(), 'ledger-tamper-')), memory = memoryStore(), dir = join(root, 'l');
  cpSync(join(template.root, 'l'), dir, { recursive: true }); cpSync(join(template.root, 'l.checkpoint'), join(root, 'l.checkpoint'));
  memory.set(template.head);
  const segments = () => readdirSync(dir).filter((f) => /^segment-\d{6}\.json$/.test(f)).sort();
  if (segments().length < 3) throw Error('scenario setup: expected at least three sealed segments');
  return { root, dir, witness: join(root, 'l.checkpoint'), memory, segments, seg: (i) => join(dir, segments()[i]) };
}
export const cleanup = (ctx: Ctx) => rmSync(ctx.root, { recursive: true, force: true });

// ---- attacker primitives -------------------------------------------------------------------------------------
/** Wait out the filesystem's timestamp granularity (a kernel tick on Linux, 1-10 ms) so an attack is not issued inside
 * the same tick as the baseline attributes. An attacker inside that tick is NOT seen by the attribute tripwire. */
export const settle = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
const times = (file: string) => { const s = statSync(file); return { atime: s.atime, mtime: s.mtime }; };
/** Same-size content change in place. `restore` puts access/modification time back (ctime cannot be put back). */
export function flip(file: string, restore = false) {
  settle();
  const t = times(file), raw = readFileSync(file, 'utf8'), at = raw.indexOf('xxxx');
  writeFileSync(file, raw.slice(0, at) + 'y' + raw.slice(at + 1));
  if (restore) utimesSync(file, t.atime, t.mtime);
}
/** Replace the file by a NEW inode (write elsewhere, rename over) with different same-size content. */
export function replaceInode(file: string, restore = false) {
  settle();
  const t = times(file), raw = readFileSync(file, 'utf8'), at = raw.indexOf('xxxx');
  const temp = `${file}.attacker`; writeFileSync(temp, raw.slice(0, at) + 'y' + raw.slice(at + 1));
  if (restore) utimesSync(temp, t.atime, t.mtime);
  renameSync(temp, file);
}
export function unlinkRecreate(file: string, restore = false) {
  settle();
  const t = times(file), raw = readFileSync(file, 'utf8'), at = raw.indexOf('xxxx');
  unlinkSync(file); writeFileSync(file, raw.slice(0, at) + 'y' + raw.slice(at + 1));
  if (restore) utimesSync(file, t.atime, t.mtime);
}
/** A genuinely separate OS process rewrites one byte in place (nothing is shared with the ledger's process). */
export function flipInOtherProcess(file: string) {
  settle();
  const code = `const fs=require('fs');const f=process.argv[1];const raw=fs.readFileSync(f,'utf8');const at=raw.indexOf('xxxx');fs.writeFileSync(f,raw.slice(0,at)+'y'+raw.slice(at+1));`;
  const r = spawnSync(process.execPath, ['-e', code, file], { encoding: 'utf8' });
  if (r.status !== 0) throw Error(`attacker process failed: ${r.stderr}`);
}
export function swapFiles(a: string, b: string) {
  settle(); const x = readFileSync(a), y = readFileSync(b); writeFileSync(a, y); writeFileSync(b, x); }
const digestOf = (sealed: { file: string; count: number; hash: string; digest: string }[], activeRaw: string) =>
  sealed.length === 0 ? sha256(activeRaw) : sha256(JSON.stringify({ sealed: sealed.map(({ file, count, hash, digest }) => ({ file, count, hash, digest })), active: sha256(activeRaw) }));
/** The strongest local attack: change one entry, recompute every later entry hash and link, rewrite the affected files
 * and regenerate the witness so everything on disk is internally consistent. Only an independent anchor can see it. */
export function forgeConsistently(ctx: Ctx, entryIndex: number) {
  settle();
  const w = JSON.parse(readFileSync(ctx.witness, 'utf8')) as { sealed?: { file: string; count: number; hash: string; digest: string }[] };
  const sealed = w.sealed ?? [], files = [...sealed.map((s) => s.file), 'ledger.json'];
  const lists = files.map((f) => JSON.parse(readFileSync(join(ctx.dir, f), 'utf8')) as Record<string, unknown>[]);
  const flat = lists.flat(); let prev = '';
  flat.forEach((e, i) => { if (i === entryIndex) e.data = { forged: true }; e.previous = prev; const { hash: _h, ...p } = e; e.hash = sha256(JSON.stringify(p)); prev = e.hash as string; });
  const rawFor = lists.map((l) => JSON.stringify(l));
  files.forEach((f, i) => writeFileSync(join(ctx.dir, f), rawFor[i]));
  const nextSealed = sealed.map((s, i) => ({ file: s.file, count: lists[i].length, hash: lists[i].at(-1)!.hash as string, digest: sha256(rawFor[i]) }));
  const activeRaw = rawFor.at(-1)!, tail = flat.at(-1)!;
  writeFileSync(ctx.witness, JSON.stringify({ count: flat.length, hash: tail.hash, digest: digestOf(nextSealed, activeRaw), pending: '', ...(nextSealed.length ? { sealed: nextSealed } : {}) }));
}

// ---- the section driver --------------------------------------------------------------------------------------
function spyFs(): { fs: LedgerFs; hooks: Hooks } {
  const pending: { op: string; match: RegExp | string; run: () => void }[] = [];
  const fire = (op: string, path: string) => { for (const h of pending) if (h.op === op && (typeof h.match === 'string' ? path.includes(h.match) : h.match.test(path))) { pending.splice(pending.indexOf(h), 1); h.run(); return; } };
  const fs: LedgerFs = {
    ...nodeLedgerFs,
    readFileSync(p) { fire('read', p); return nodeLedgerFs.readFileSync(p); },
    openSync(p, f, m) { fire('open', p); return nodeLedgerFs.openSync(p, f, m); },
    renameSync(a, b) { fire('rename', b); nodeLedgerFs.renameSync(a, b); },
    linkSync(a, b) { fire('link', b); nodeLedgerFs.linkSync(a, b); },
  };
  return { fs, hooks: { on: (op, match, run) => { pending.push({ op, match, run }); } } };
}
const msg = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 120);

export function run(scenario: Scenario, mode: VerificationMode, external: boolean): Result {
  const ctx = build(external);
  try {
    const { fs, hooks } = spyFs();
    const open = (v: VerificationMode, f?: LedgerFs) => new Ledger(ctx.dir, undefined, external ? ctx.memory.binding : undefined, { verification: v, maxSegmentBytes: 1000, ...(f ? { fs: f } : {}) });
    const ledger = open(mode, fs);
    let result: Result | undefined;
    const attemptB = () => { try { ledger.append('event', 'probe', { b: 1 }); } catch (e) { result = { outcome: 'blocked-in-section', message: msg(e) }; } };
    if (scenario.at === 'before-section') scenario.attack(ctx, hooks);
    try {
      ledger.exclusive(() => {
        if (scenario.at === 'before-first-load' || scenario.at === 'hook') scenario.attack(ctx, hooks);
        ledger.read();
        if (scenario.at === 'after-read') scenario.attack(ctx, hooks);
        try { ledger.append('prepared', 'probe', { a: 1 }); } catch (e) { result = { outcome: 'failed-safe', message: msg(e) }; return; }
        if (scenario.at === 'between-appends') scenario.attack(ctx, hooks);
        attemptB();
      });
    } catch (e) { result ??= { outcome: 'blocked-in-section', message: msg(e) }; }
    if (result) return result;
    // The section went through. Does the next independent full verification still accept the history?
    try { open('full').read(); return { outcome: 'accepted', message: '' }; } catch (e) { return { outcome: 'caught-later', message: msg(e) }; }
  } finally { cleanup(ctx); }
}

export const SCENARIOS: Scenario[] = [
  // ---- Stage 2: later alteration of previously verified history ----
  { id: 'T01', title: 'same-process content change of a sealed segment (same size)', external: false, at: 'between-appends', attack: (c) => flip(c.seg(0)) },
  { id: 'T02', title: 'content change of a sealed segment by another process', external: false, at: 'between-appends', attack: (c) => flipInOtherProcess(c.seg(0)) },
  { id: 'T03', title: 'sealed segment swapped with another valid segment', external: false, at: 'between-appends', attack: (c) => swapFiles(c.seg(0), c.seg(1)) },
  { id: 'T04', title: 'same size, different content, mtime NOT restored', external: false, at: 'between-appends', attack: (c) => flip(c.seg(1), false) },
  { id: 'T05', title: 'same size, different content, mtime/atime restored', external: false, at: 'between-appends', attack: (c) => flip(c.seg(1), true) },
  { id: 'T06a', title: 'file replaced by a new inode, times restored', external: false, at: 'between-appends', attack: (c) => replaceInode(c.seg(1), true) },
  { id: 'T06b', title: 'file deleted and re-created (inode may be reused), times restored', external: false, at: 'between-appends', attack: (c) => unlinkRecreate(c.seg(1), true) },
  { id: 'T07', title: 'consistent rollback: an older snapshot of ALL files restored', external: 'both', at: 'between-appends', attack: (c) => { rollbackToSnapshot(c); } },
  { id: 'T08', title: 'witness rolled back to an earlier value', external: false, at: 'between-appends', attack: (c) => { const w = JSON.parse(readFileSync(c.witness, 'utf8')); w.count -= 1; writeFileSync(c.witness, JSON.stringify(w)); } },
  { id: 'T09', title: 'witness regenerated to describe tampered files (no external anchor)', external: false, at: 'between-appends', attack: (c) => forgeConsistently(c, 3) },
  { id: 'T09x', title: 'witness regenerated to describe tampered files (external anchor bound)', external: true, at: 'between-appends', attack: (c) => forgeConsistently(c, 3) },
  { id: 'T10', title: 'tail of the active file deleted', external: false, at: 'between-appends', attack: (c) => { const f = join(c.dir, 'ledger.json'), l = JSON.parse(readFileSync(f, 'utf8')); writeFileSync(f, JSON.stringify(l.slice(0, -1))); } },
  { id: 'T11', title: 'hash chain regenerated after editing an old entry (witness updated)', external: false, at: 'between-appends', attack: (c) => forgeConsistently(c, 1) },
  { id: 'T11x', title: 'hash chain regenerated after editing an old entry (external anchor bound)', external: true, at: 'between-appends', attack: (c) => forgeConsistently(c, 1) },
  { id: 'T12', title: 'decoy "verified cache" files planted, sealed segment altered', external: false, at: 'between-appends', attack: (c) => { for (const n of ['verified.json', 'verification-cache.json', '.verified', 'cache.json']) writeFileSync(join(c.dir, n), JSON.stringify({ verified: true, count: 999, hash: 'x' })); flip(c.seg(0), true); } },
  { id: 'T13', title: 'earlier section result replayed: sealed segment altered between two sections of ONE object', external: false, at: 'before-section', attack: (c) => flip(c.seg(0), true) },
  { id: 'T14', title: 'sealed segment altered, then a fresh object (restart) opens a section', external: false, at: 'before-section', attack: (c) => flip(c.seg(2), true) },
  { id: 'T15', title: 'external head moved/rolled back by someone else', external: true, at: 'between-appends', attack: (c) => { const h = c.memory.head(); c.memory.set({ ...h, count: h.count - 1, hash: '1'.repeat(64) }); } },
  // ---- Stage 3: races between verification and write ----
  { id: 'R01', title: 'history altered before the lock is taken', external: false, at: 'before-section', attack: (c) => flip(c.seg(0)) },
  { id: 'R02', title: 'history altered right after the lock is taken, before the first load', external: false, at: 'before-first-load', attack: (c) => flip(c.seg(0)) },
  { id: 'R03', title: 'history altered DURING verification, after that segment was already read', external: false, at: 'hook', attack: (c, h) => h.on('read', /segment-000003\.json$/, () => flip(c.seg(0), true)) },
  { id: 'R04', title: 'segment swapped right after verification, before the first append', external: false, at: 'after-read', attack: (c) => swapFiles(c.seg(0), c.seg(1)) },
  { id: 'R05', title: 'witness changed right before the append', external: false, at: 'after-read', attack: (c) => { const w = JSON.parse(readFileSync(c.witness, 'utf8')); w.digest = '0'.repeat(64); writeFileSync(c.witness, JSON.stringify(w)); } },
  { id: 'R06', title: 'sealed segment altered while the pending file is being saved', external: false, at: 'hook', attack: (c, h) => h.on('open', /\.pending-/, () => flip(c.seg(0), true)) },
  { id: 'R07', title: 'active file altered while the segment is being sealed', external: false, at: 'hook', attack: (c, h) => h.on('link', /segment-/, () => flip(join(c.dir, 'ledger.json'), false)) },
  { id: 'R08', title: 'witness replaced by a foreign file just before our witness rename', external: false, at: 'hook', attack: (c, h) => h.on('rename', /l\.checkpoint$/, () => writeFileSync(c.witness, '{"count":0}')) },
  { id: 'R12a', title: 'writer.lock deleted by a third party mid-section (ownership lost)', external: false, at: 'between-appends', attack: (c) => unlinkSync(join(c.dir, 'writer.lock')) },
  { id: 'R12b', title: 'writer.lock replaced by another owner mid-section', external: false, at: 'between-appends', attack: (c) => writeFileSync(join(c.dir, 'writer.lock'), JSON.stringify({ pid: process.pid, token: 'someone-else' })) },
  { id: 'R15', title: 'external head advanced by another writer just before our compare-and-set', external: true, at: 'hook', attack: (c, h) => h.on('rename', /l\.checkpoint$/, () => { const hd = c.memory.head(); c.memory.set({ ...hd, count: hd.count + 1, hash: '2'.repeat(64) }); }) },
];

function rollbackToSnapshot(c: Ctx) {
  settle();
  // The attacker kept a copy of everything from an earlier moment. Built here from the seed history by replaying it:
  // an older consistent state is what a real rollback restores, so derive it from the real files (drop the last cycle).
  const w = JSON.parse(readFileSync(c.witness, 'utf8')) as { sealed?: { file: string; count: number; hash: string; digest: string }[] };
  const sealed = w.sealed ?? [], last = sealed.at(-1)!;
  // Roll back to the moment just after the second-to-last segment was sealed: previous sealed list + that segment's
  // entries as the active file, and a witness describing exactly that.
  const keep = sealed.slice(0, -1), activeRaw = readFileSync(join(c.dir, last.file), 'utf8');
  writeFileSync(join(c.dir, 'ledger.json'), activeRaw);
  unlinkSync(join(c.dir, last.file));
  const entries = JSON.parse(activeRaw) as { hash: string }[];
  const total = keep.reduce((n, s) => n + s.count, 0) + entries.length;
  writeFileSync(c.witness, JSON.stringify({ count: total, hash: entries.at(-1)!.hash, digest: digestOf(keep, activeRaw), pending: '', ...(keep.length ? { sealed: keep } : {}) }));
}
