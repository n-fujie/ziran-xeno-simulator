import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger } from '../src/science/store.ts';
import { ScientificRuntime } from '../src/science/runtime.ts';
import type { FaultPoint } from '../src/science/runtime.ts';
import { sha256 } from '../src/core/hash.ts';
import { control, faultyFs, memoryStore } from './fixtures/ledger-faults.ts';
import type { Fault } from './fixtures/ledger-faults.ts';

// Simulated faults: errors injected at exact filesystem steps (the real writes before the fault really happen,
// including genuine torn writes). Real-process and real-kernel faults are in ledger-real-faults.test.ts.
type Cleanup = { after: (fn: () => void) => void };
type Mode = 'compat' | 'rotating';
const tmp = (t: Cleanup) => { const root = mkdtempSync(join(tmpdir(), 'ledger-fault-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; };
const pad = (n: number) => 'x'.repeat(n);
const strays = (dir: string, witness: string) => [...readdirSync(dir).filter((f) => f.startsWith('.pending-')), ...readdirSync(join(dir, '..')).filter((f) => f.startsWith('l.checkpoint.') && f.endsWith('.tmp'))];
const sealed = (dir: string) => Object.fromEntries(readdirSync(dir).filter((f) => /^segment-\d{6}\.json$/.test(f)).map((f) => [f, sha256(readFileSync(join(dir, f), 'utf8'))]));

function build(t: Cleanup, mode: Mode) {
  const root = tmp(t), memory = memoryStore(), c = control();
  const limit = mode === 'rotating' ? 1000 : undefined;
  const open = (faulty: boolean) => new Ledger(join(root, 'l'), undefined, memory.binding, { fs: faulty ? faultyFs(c) : undefined, maxSegmentBytes: limit });
  const ledger = open(true);
  // Two completed operations with fat payloads: in rotating mode the next append must seal the active segment.
  for (let i = 0; i < 2; i++) ledger.exclusive(() => { ledger.append('prepared', `seed-op-${i}`, { pad: pad(700) }); ledger.append('completed', `seed-op-${i}`, { ok: true }); });
  return { root, dir: join(root, 'l'), witness: join(root, 'l.checkpoint'), memory, c, ledger, open };
}
const attempt = (ledger: Ledger) => ledger.exclusive(() => ledger.append('prepared', 'fault-op', { marker: 'attempted' }));

type Outcome = 'absent' | 'present-after-recovery' | 'present-immediately';
const COMMON: [string, Outcome, Partial<Fault>][] = [
  ['write:pending', 'absent', { partial: true, code: 'ENOSPC' }],
  ['fsync:pending', 'absent', { code: 'EIO' }],
  ['fsync:dir#1', 'absent', { code: 'EIO' }],
  ['write:witness', 'absent', { partial: true, code: 'ENOSPC' }],
  ['fsync:witness', 'absent', { code: 'EIO' }],
  ['rename:witness', 'absent', { code: 'EXDEV' }],
  ['fsync:dir#2', 'present-after-recovery', { code: 'EIO' }],
  ['rename:pending', 'present-after-recovery', { code: 'EXDEV' }],
];
const PLAN: Record<Mode, [string, Outcome, Partial<Fault>][]> = {
  compat: [...COMMON, ['fsync:dir#3', 'present-immediately', { code: 'EIO' }]],
  rotating: [...COMMON, ['link:segment', 'present-after-recovery', { code: 'EIO' }], ['fsync:dir#3', 'present-after-recovery', { code: 'EIO' }], ['fsync:dir#4', 'present-immediately', { code: 'EIO' }]],
};

for (const mode of ['compat', 'rotating'] as const) for (const [label, outcome, extra] of PLAN[mode]) test(`${mode}: a fault at ${label} fails the append, never yields partial history, and recovers to a defined state`, (t) => {
  const f = build(t, mode);
  const before = f.ledger.read(), segmentsBefore = sealed(f.dir);
  if (mode === 'rotating') assert.ok(Object.keys(segmentsBefore).length >= 1);
  f.c.armed = { label, ...extra };
  // The injected failure is reported to the caller: a failed storage step is never treated as success.
  assert.throws(() => attempt(f.ledger), /injected storage fault/);
  assert.equal(f.c.fired, 1, `${label} was reached exactly once`);
  // Restart with a healthy filesystem and the same external store.
  const restarted = f.open(false);
  let immediate: 'readable' | 'needs-recovery';
  try { immediate = restarted.read().length >= 0 ? 'readable' : 'readable'; } catch (e) { assert.match(String((e as Error).message), /interrupted commit|checkpoint mismatch/); immediate = 'needs-recovery'; }
  assert.equal(immediate, outcome === 'present-after-recovery' ? 'needs-recovery' : 'readable', `state right after the fault: ${immediate}`);
  if (outcome === 'present-immediately') assert.equal(restarted.read().length, before.length + 1);
  if (outcome === 'absent') assert.equal(restarted.read().length, before.length);
  const after = restarted.recover();
  if (outcome === 'absent') assert.deepEqual(after, before, 'no trace of the failed append');
  else {
    // The attempted prepared entry is durable and verified; recovery then quarantines the unfinished operation.
    assert.deepEqual(after.slice(0, before.length), before);
    assert.deepEqual(after.slice(before.length).map((e) => `${e.kind}:${e.operation}`), ['prepared:fault-op', 'quarantined:fault-op']);
    assert.deepEqual((after[before.length].data as { marker: string }).marker, 'attempted');
    assert.equal((after.at(-1)!.data as { physicalRecoveryVerified: boolean }).physicalRecoveryVerified, false);
  }
  // Whatever happened, local history and the external head agree, nothing abandoned lingers, history is append-only.
  const head = f.memory.head();
  assert.equal(head.count, after.length); assert.equal(head.hash, after.at(-1)!.hash);
  assert.deepEqual(strays(f.dir, f.witness), []);
  const segmentsAfter = sealed(f.dir);
  for (const [file, digest] of Object.entries(segmentsBefore)) assert.equal(segmentsAfter[file], digest, `${file} untouched`);
  if (mode === 'rotating') assert.equal(Object.keys(segmentsAfter).length, Object.keys(segmentsBefore).length + (outcome === 'absent' ? 0 : 1));
  restarted.exclusive(() => restarted.append('prepared', 'after-fault-op', { ok: true }));
  assert.equal(restarted.read().at(-1)!.operation, 'after-fault-op');
});

for (const mode of ['compat', 'rotating'] as const) test(`${mode}: an unreachable or ambiguous external checkpoint update is recovered without losing or duplicating the entry`, (t) => {
  for (const [name, arm] of [['not applied', (m: ReturnType<typeof memoryStore>) => { m.state.failBefore = true; }], ['applied but acknowledgement lost', (m: ReturnType<typeof memoryStore>) => { m.state.failAfter = true; }]] as const) {
    const f = build(t, mode); arm(f.memory);
    const before = f.ledger.read();
    assert.throws(() => attempt(f.ledger), /outcome unknown/, name);
    const restarted = f.open(false);
    assert.throws(() => restarted.read(), /interrupted commit|checkpoint mismatch/, name);
    // While the service is down the store stays isolated: recovery fails closed and loses nothing.
    f.memory.state.failBefore = true;
    if (name === 'not applied') { f.memory.state.failBefore = true; assert.throws(() => restarted.recover(), /unavailable|outcome unknown/); }
    f.memory.state.failBefore = false;
    const after = restarted.recover();
    assert.deepEqual(after.slice(0, before.length), before, name);
    assert.deepEqual(after.slice(before.length).map((e) => `${e.kind}:${e.operation}`), ['prepared:fault-op', 'quarantined:fault-op'], name);
    assert.equal(f.memory.head().count, after.length, name); assert.deepEqual(strays(f.dir, f.witness), []);
  }
});

for (const mode of ['compat', 'rotating'] as const) test(`${mode}: transient read failures (storage briefly unavailable) change nothing and never produce history`, (t) => {
  const labels = mode === 'rotating' ? ['read:ledger', 'read:segment', 'read:checkpoint'] : ['read:ledger', 'read:checkpoint'];
  for (const label of labels) {
    const f = build(t, mode), before = f.ledger.read();
    f.c.armed = { label, code: 'EIO' };
    assert.throws(() => attempt(f.ledger), /injected storage fault/, label);
    assert.deepEqual(f.open(false).read(), before, `${label}: unchanged`);
    f.ledger.exclusive(() => f.ledger.append('prepared', 'retry-after-outage', {})); // the outage is over; a deliberate new append works
    assert.equal(f.open(false).read().length, before.length + 1);
  }
});

for (const mode of ['compat', 'rotating'] as const) test(`${mode}: a disk that stays full fails every later write; after repair, recovery reaches a verified state`, (t) => {
  const f = build(t, mode), before = f.ledger.read();
  f.c.armed = { label: 'write:pending', partial: true, code: 'ENOSPC', persistent: true };
  for (let i = 0; i < 3; i++) assert.throws(() => attempt(f.ledger), /ENOSPC/);
  assert.deepEqual(f.open(false).read(), before, 'three failed attempts left the history untouched');
  const abandoned = readdirSync(f.dir).filter((n) => n.startsWith('.pending-'));
  assert.ok(abandoned.length >= 1, 'torn pending files remain until a verified recovery removes them');
  assert.deepEqual(f.open(false).recover(), before);
  assert.deepEqual(strays(f.dir, f.witness), []);
});

// Runtime-level sweep: fail the k-th ledger write of a real cycle, for every k, transient and persistent.
function appendsPerRun(): number {
  const c = control(), root = mkdtempSync(join(tmpdir(), 'ledger-count-'));
  try { new ScientificRuntime(new Ledger(join(root, 'l'), undefined, undefined, { fs: faultyFs(c) })).run({ operationId: 'sweep-op-0001', seed: 5, condition: 'coupled', method: 'adaptive' }); } finally { rmSync(root, { recursive: true, force: true }); }
  return c.appendBytes.length;
}
const EFFECTS: [FaultPoint, string][] = [['after-connect', 'connect-issued'], ['after-intervention', 'intervention-issued'], ['after-disconnect', 'disconnect-issued']];
for (const mode of ['compat', 'rotating'] as const) for (const persistent of [false, true]) test(`${mode}/${persistent ? 'persistent' : 'transient'}: failing every ledger write of a cycle never reports success and never runs an effect that was not written ahead`, { timeout: 240000 }, (t) => {
  const total = appendsPerRun(); assert.ok(total >= 8, `a cycle performs ${total} durable writes`);
  for (let k = 1; k <= total; k++) {
    const root = tmp(t), memory = memoryStore(), c = control();
    const open = (faulty: boolean) => new Ledger(join(root, 'l'), undefined, memory.binding, { fs: faulty ? faultyFs(c) : undefined, maxSegmentBytes: mode === 'rotating' ? 20000 : undefined });
    const runtime = new ScientificRuntime(open(true)), reached = new Set<FaultPoint>();
    c.armed = { label: 'write:pending', nth: k, partial: true, code: 'ENOSPC', persistent };
    assert.throws(() => runtime.run({ operationId: 'sweep-op-0001', seed: 5, condition: 'coupled', method: 'adaptive' }, (p) => { reached.add(p); }), /ENOSPC|injected/, `write ${k}/${total}`);
    const restarted = open(false);
    const entries = restarted.recover();
    const own = entries.filter((e) => e.operation === 'sweep-op-0001');
    if (k === 1) assert.equal(own.length, 0, 'a failed first write leaves no operation');
    else {
      assert.equal(own.at(-1)!.kind, 'quarantined', `write ${k}: unfinished work is isolated, never completed`);
      assert.equal((own.at(-1)!.data as { version?: number }).version, undefined, 'the quarantine is not a cycle result');
    }
    const phases = own.filter((e) => e.kind === 'event').map((e) => (e.data as { phase: string }).phase);
    for (const [point, issued] of EFFECTS) {
      if (reached.has(point)) assert.ok(phases.includes(issued), `write ${k}: effect "${point}" ran, so "${issued}" must already be durable`);
      assert.ok(phases.filter((p) => p === issued).length <= 1, 'an effect is never issued twice');
    }
    assert.equal(memory.head().count, entries.length);
    // After repair, the same operation id is refused (never replayed) and new work proceeds.
    if (k > 1) assert.throws(() => new ScientificRuntime(restarted).run({ operationId: 'sweep-op-0001', seed: 5, condition: 'coupled', method: 'adaptive' }), /quarantined|conflict/);
    assert.equal(new ScientificRuntime(restarted).run({ operationId: 'sweep-op-0002', seed: 6, condition: 'stable', method: 'fixed' }).state, 'completed');
  }
});

test('rotating: where the filesystem cannot hard-link, sealing falls back to an atomic byte-identical copy; other link errors still fail the append', (t) => {
  for (const code of ['EPERM', 'ENOTSUP', 'EXDEV']) {
    const f = build(t, 'rotating'), before = f.ledger.read(), segmentsBefore = sealed(f.dir);
    f.c.armed = { label: 'link:segment', code, persistent: false };
    attempt(f.ledger); // succeeds: the copy fallback sealed the segment
    assert.equal(f.c.fired, 1);
    const entries = f.open(false).read();
    assert.equal(entries.length, before.length + 1);
    const segmentsAfter = sealed(f.dir), added = Object.keys(segmentsAfter).filter((n) => !(n in segmentsBefore));
    assert.equal(added.length, 1, code);
    assert.equal(segmentsAfter[added[0]], f.open(false).layout().sealed.find((s) => s.file === added[0])!.digest, 'the copy is byte-identical to what the witness records');
    for (const [file, digest] of Object.entries(segmentsBefore)) assert.equal(segmentsAfter[file], digest);
    assert.deepEqual(strays(f.dir, f.witness), []);
    assert.deepEqual(readdirSync(f.dir).filter((n) => n.endsWith('.tmp')), []);
  }
  // A failure while writing the copy itself is a storage failure: the append fails and recovery completes the seal.
  const g = build(t, 'rotating'), before = g.ledger.read();
  const faulty = g.open(true); // a second instance sharing the same fault control
  g.c.armed = { label: 'link:segment', code: 'EPERM', persistent: true };
  assert.throws(() => attempt(faulty), /EPERM|injected/);
  const after = g.open(false).recover();
  assert.deepEqual(after.slice(0, before.length), before);
  assert.deepEqual(after.slice(before.length).map((e) => `${e.kind}:${e.operation}`), ['prepared:fault-op', 'quarantined:fault-op']);
});
