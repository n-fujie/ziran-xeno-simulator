import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger } from '../src/science/store.ts';
import { ScientificRuntime, scientificFingerprint } from '../src/science/runtime.ts';
import { CONDITIONS } from '../src/science/protocol.ts';
import { sha256 } from '../src/core/hash.ts';
import { control, faultyFs, memoryStore } from './fixtures/ledger-faults.ts';

type Cleanup = { after: (fn: () => void) => void };
const FIXTURE = new URL('./fixtures/legacy-ledger-v1/', import.meta.url).pathname;
const tmp = (t: Cleanup, prefix = 'ledger-seg-') => { const root = mkdtempSync(join(tmpdir(), prefix)); t.after(() => rmSync(root, { recursive: true, force: true })); return root; };
const pad = (n: number) => 'x'.repeat(n);
function appendOperations(ledger: Ledger, count: number, size = 600, from = 0) {
  for (let i = from; i < from + count; i++) ledger.exclusive(() => { ledger.append('prepared', `op-${i}`, { pad: pad(size) }); ledger.append('completed', `op-${i}`, { ok: i }); });
}
const sealedFiles = (dir: string) => readdirSync(dir).filter((f) => /^segment-\d{6}\.json$/.test(f)).sort();
const expectedFixture = JSON.parse(readFileSync(join(FIXTURE, 'expected.json'), 'utf8')) as { count: number; hash: string; kinds: Record<string, number> };

function legacyCopy(t: Cleanup) {
  const root = tmp(t, 'legacy-ledger-'); cpSync(FIXTURE, root, { recursive: true });
  return { root, dir: join(root, 'ledger'), witness: join(root, 'ledger.checkpoint') };
}

test('a ledger written by the previous version (real bytes) is read unchanged and stays in the old format by default', (t) => {
  const { dir, witness } = legacyCopy(t);
  const rawBefore = readFileSync(join(dir, 'ledger.json'), 'utf8'), witnessBefore = JSON.parse(readFileSync(witness, 'utf8'));
  assert.equal('sealed' in witnessBefore, false);
  const ledger = new Ledger(dir);
  const entries = ledger.read();
  assert.equal(entries.length, expectedFixture.count); assert.equal(entries.at(-1)?.hash, expectedFixture.hash);
  const kinds: Record<string, number> = {}; for (const e of entries) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  assert.deepEqual(kinds, expectedFixture.kinds);
  assert.equal(witnessBefore.digest, sha256(rawBefore), 'the legacy head digest is the whole-file digest');
  // Default mode appends exactly as before: one array, no sealed list, no rotation keys.
  ledger.exclusive(() => ledger.append('prepared', 'post-fixture-op', { note: 'appended by new code' }));
  const raw = readFileSync(join(dir, 'ledger.json'), 'utf8'), after = JSON.parse(raw);
  assert.equal(raw, JSON.stringify([...JSON.parse(rawBefore), after.at(-1)]), 'byte-identical to the historic whole-array rewrite');
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(witness, 'utf8'))).sort(), ['count', 'digest', 'hash', 'pending']);
  assert.deepEqual(sealedFiles(dir), []);
});

test('opting in to rotation seals the previous-version ledger byte-for-byte and keeps every old entry', (t) => {
  const { dir } = legacyCopy(t);
  const original = readFileSync(join(dir, 'ledger.json'));
  const ledger = new Ledger(dir, undefined, undefined, { maxSegmentBytes: 4096 });
  const before = ledger.read();
  ledger.exclusive(() => ledger.append('prepared', 'first-rotating-op', { n: 1 }));
  assert.deepEqual(sealedFiles(dir), ['segment-000001.json']);
  assert.ok(readFileSync(join(dir, 'segment-000001.json')).equals(original), 'the pre-migration history is retained verbatim');
  appendOperations(ledger, 15);
  const after = ledger.read();
  assert.deepEqual(after.slice(0, before.length), before, 'old entries unchanged; chain continues across the segment boundary');
  assert.equal(after.length, before.length + 1 + 30);
  assert.ok(sealedFiles(dir).length > 1);
  const reopened = new Ledger(dir, undefined, undefined, { maxSegmentBytes: 4096 });
  assert.deepEqual(reopened.read(), after);
  // A reader that does not enable rotation still reads (and may append to) a rotated ledger; it never merges segments.
  const plain = new Ledger(dir);
  assert.deepEqual(plain.read(), after);
  plain.exclusive(() => plain.append('prepared', 'plain-reader-op', {}));
  assert.equal(new Ledger(dir, undefined, undefined, { maxSegmentBytes: 4096 }).read().length, after.length + 1);
});

test('the same appends produce identical history in both modes; only the physical layout differs', (t) => {
  const plain = new Ledger(join(tmp(t), 'l')), rotating = new Ledger(join(tmp(t), 'l'), undefined, undefined, { maxSegmentBytes: 3000 });
  for (const ledger of [plain, rotating]) appendOperations(ledger, 25, 400);
  const a = plain.read(), b = rotating.read();
  assert.deepEqual(a.map((e) => e.hash), b.map((e) => e.hash));
  assert.equal(a.length, 50); assert.ok(rotating.layout().sealed.length >= 5);
  assert.equal(plain.layout().sealed.length, 0);
  const layout = rotating.layout();
  assert.equal(layout.sealed.reduce((n, s) => n + s.count, 0) + layout.activeEntries, 50, 'every entry lives in exactly one segment');
});

test('scientific results are identical whether the ledger rotates or not, including history read across segments', { timeout: 180000 }, (t) => {
  const plain = new ScientificRuntime(new Ledger(join(tmp(t), 'l')));
  const rotatingLedger = new Ledger(join(tmp(t), 'l'), undefined, undefined, { maxSegmentBytes: 60000 });
  const rotating = new ScientificRuntime(rotatingLedger);
  const requests = CONDITIONS.flatMap((condition, i) => [
    { seed: 1 + i, condition, method: 'adaptive' as const }, { seed: 20 + i, condition, method: 'history' as const }, { seed: 40 + i, condition, method: 'history' as const },
  ]);
  const left = requests.map((r) => scientificFingerprint(plain.run(r))), right = requests.map((r) => scientificFingerprint(rotating.run(r)));
  assert.deepEqual(right, left, 'all fingerprints match');
  assert.ok(rotatingLedger.layout().sealed.length >= 3, 'history queries really spanned sealed segments');
  const usedHistory = rotatingLedger.read().filter((e) => e.kind === 'completed' || e.kind === 'quarantined').some((e) => ((e.data as { provenance?: { historyRefs: string[] } }).provenance?.historyRefs.length ?? 0) > 0);
  assert.equal(usedHistory, true);
});

test('rotation bounds the bytes written per append and makes total writes grow linearly, not quadratically', (t) => {
  const run = (limit: number | undefined, appends: number) => {
    const c = control(), ledger = new Ledger(join(tmp(t), 'l'), undefined, undefined, { fs: faultyFs(c), maxSegmentBytes: limit });
    appendOperations(ledger, appends / 2, 500);
    return { total: c.bytes, max: Math.max(...c.appendBytes), maxWitness: Math.max(...c.witnessBytes), segments: ledger.layout().sealed.length, appends: c.appendBytes.length };
  };
  const plainSmall = run(undefined, 100), plainBig = run(undefined, 200), rotSmall = run(8000, 100), rotBig = run(8000, 200);
  assert.ok(plainBig.total / plainSmall.total > 3.5, `unsegmented growth is quadratic: ${plainBig.total / plainSmall.total}`);
  assert.ok(rotBig.total / rotSmall.total < 2.3, `segmented growth is linear: ${rotBig.total / rotSmall.total}`);
  assert.ok(rotBig.max < 8000 + 1000, `the pending file is at most one active segment plus one entry: ${rotBig.max}`);
  // The witness lists every sealed segment (~190 bytes each), so it grows with history, but ~4 orders of magnitude slower.
  assert.ok(rotBig.maxWitness < 300 + 220 * rotBig.segments, `witness cost per sealed segment: ${rotBig.maxWitness} for ${rotBig.segments} segments`);
  assert.ok(rotBig.maxWitness < rotBig.max, 'at this scale the active segment still dominates');
  assert.ok(plainBig.max > 5 * rotBig.max);
  assert.ok(rotBig.total < plainBig.total / 4);
});

test('sealed segments are never modified, moved or deleted by later appends and recovery', (t) => {
  const root = tmp(t), ledger = new Ledger(join(root, 'l'), undefined, undefined, { maxSegmentBytes: 2500 });
  appendOperations(ledger, 10, 300);
  const snapshot = () => Object.fromEntries(sealedFiles(ledger.directory).map((f) => [f, sha256(readFileSync(join(ledger.directory, f), 'utf8'))]));
  const first = snapshot(); assert.ok(Object.keys(first).length >= 2);
  appendOperations(ledger, 30, 300, 100); ledger.recover();
  const later = snapshot();
  for (const [file, digest] of Object.entries(first)) assert.equal(later[file], digest, file);
  const layout = ledger.layout();
  for (const s of layout.sealed) assert.ok(statSync(join(ledger.directory, s.file)).size < 2500 + 1200, 'a sealed segment is one threshold plus at most one entry');
  assert.ok(layout.activeBytes < 2500 + 1200);
});

test('rotation option is validated and off by default', (t) => {
  for (const bad of [0, 100, -1, 1.5, 2 ** 31, NaN]) assert.throws(() => new Ledger(join(tmp(t), 'l'), undefined, undefined, { maxSegmentBytes: bad }), /invalid segment size limit/);
  const ledger = new Ledger(join(tmp(t), 'l')); assert.equal(ledger.segmentLimit, undefined);
  appendOperations(ledger, 50, 2000);
  assert.deepEqual(sealedFiles(ledger.directory), []);
});

function segmented(t: Cleanup, external = true) {
  const root = tmp(t), memory = memoryStore();
  const open = () => new Ledger(join(root, 'l'), undefined, external ? memory.binding : undefined, { maxSegmentBytes: 2500 });
  const ledger = open(); appendOperations(ledger, 12, 300);
  assert.ok(ledger.layout().sealed.length >= 3);
  return { root, dir: join(root, 'l'), witness: join(root, 'l.checkpoint'), open, memory, ledger };
}
const cases: [string, (f: ReturnType<typeof segmented>) => void][] = [
  ['delete the newest sealed segment', ({ dir }) => unlinkSync(join(dir, sealedFiles(dir).at(-1)!))],
  ['delete the oldest sealed segment', ({ dir }) => unlinkSync(join(dir, sealedFiles(dir)[0]))],
  ['drop the last entry of a sealed segment (still valid JSON)', ({ dir }) => { const f = join(dir, sealedFiles(dir)[1]); writeFileSync(f, JSON.stringify(JSON.parse(readFileSync(f, 'utf8')).slice(0, -1))); }],
  ['change one byte inside a sealed segment', ({ dir }) => { const f = join(dir, sealedFiles(dir)[0]); writeFileSync(f, readFileSync(f, 'utf8').replace('xxx', 'xxy')); }],
  ['swap two sealed segments', ({ dir }) => { const [a, b] = sealedFiles(dir).slice(0, 2).map((f) => join(dir, f)); const x = readFileSync(a), y = readFileSync(b); writeFileSync(a, y); writeFileSync(b, x); }],
  ['delete the active segment', ({ dir }) => unlinkSync(join(dir, 'ledger.json'))],
  ['empty the active segment', ({ dir }) => writeFileSync(join(dir, 'ledger.json'), '[]')],
  ['truncate the active segment to a valid prefix', ({ dir }) => { const f = join(dir, 'ledger.json'); writeFileSync(f, JSON.stringify(JSON.parse(readFileSync(f, 'utf8')).slice(0, -1))); }],
  ['corrupt the active segment JSON', ({ dir }) => writeFileSync(join(dir, 'ledger.json'), readFileSync(join(dir, 'ledger.json'), 'utf8').slice(0, 50))],
  ['strip the sealed list from the witness', ({ witness }) => { const w = JSON.parse(readFileSync(witness, 'utf8')); delete w.sealed; writeFileSync(witness, JSON.stringify(w)); }],
  ['forge a sealed digest in the witness', ({ witness }) => { const w = JSON.parse(readFileSync(witness, 'utf8')); w.sealed[0].digest = 'a'.repeat(64); writeFileSync(witness, JSON.stringify(w)); }],
  ['point the witness at an invalid segment name', ({ witness }) => { const w = JSON.parse(readFileSync(witness, 'utf8')); w.sealed[0].file = '../ledger.json'; writeFileSync(witness, JSON.stringify(w)); }],
];
for (const [name, tamper] of cases) test(`segmented ledger detects and refuses to bless: ${name}`, (t) => {
  const f = segmented(t); tamper(f);
  const reopened = f.open();
  assert.throws(() => reopened.read(), /ledger integrity|external checkpoint mismatch|invalid|Unexpected|JSON/);
  assert.throws(() => reopened.recover(), /ledger integrity|external checkpoint mismatch|invalid|Unexpected|JSON/);
  assert.throws(() => new ScientificRuntime(reopened).run({ seed: 1 }), /ledger integrity|external checkpoint mismatch|invalid|Unexpected|JSON/);
});

test('a consistent rollback of segments, witness and active file is rejected by the external head', (t) => {
  const f = segmented(t);
  const snapshot = new Map(readdirSync(f.dir).map((name) => [name, readFileSync(join(f.dir, name))])), witness = readFileSync(f.witness);
  appendOperations(f.ledger, 10, 300, 100);
  for (const name of readdirSync(f.dir)) unlinkSync(join(f.dir, name));
  for (const [name, bytes] of snapshot) writeFileSync(join(f.dir, name), bytes);
  writeFileSync(f.witness, witness);
  const rolled = f.open();
  assert.throws(() => rolled.read(), /external checkpoint mismatch/);
  assert.throws(() => rolled.recover(), /external checkpoint mismatch/);
  // The same rollback with no external binding is internally consistent and therefore NOT detectable locally.
  const local = segmented(t, false), localSnapshot = new Map(readdirSync(local.dir).map((name) => [name, readFileSync(join(local.dir, name))])), localWitness = readFileSync(local.witness);
  appendOperations(local.ledger, 10, 300, 100);
  for (const name of readdirSync(local.dir)) unlinkSync(join(local.dir, name));
  for (const [name, bytes] of localSnapshot) writeFileSync(join(local.dir, name), bytes);
  writeFileSync(local.witness, localWitness);
  assert.equal(local.open().read().length, 24, 'local-only witnesses cannot detect a whole-directory rollback; that is what the external checkpoint is for');
});

test('an unreferenced segment file neither changes the verified history nor is silently adopted', (t) => {
  const f = segmented(t);
  const before = f.ledger.read();
  writeFileSync(join(f.dir, 'segment-000099.json'), '[]');
  const layout = f.open().layout();
  assert.deepEqual(layout.unreferencedSegments, ['segment-000099.json']);
  assert.deepEqual(f.open().read(), before);
  appendOperations(f.open(), 5, 300, 200);
  assert.equal(readFileSync(join(f.dir, 'segment-000099.json'), 'utf8'), '[]', 'never overwritten or deleted');
  assert.ok(existsSync(join(f.dir, 'segment-000099.json')));
});
