// Ledger verification cost: where the time goes, and how it scales with history size and segment count.
//   node scripts/ledger-verify-bench.ts build   --cycles <n> [--segment-bytes <n>] --dir <dir>
//   node scripts/ledger-verify-bench.ts measure --dir <dir> [--segment-bytes <n>] [--reps <n>] [--sections <n>] [--out <file>]
//                                               [--verification full|section]
// `build` creates a real ledger from the scientific workload (cycles over the seven conditions, methods alternating
// adaptive/history). `measure` never touches the source directory: appends run on a temporary copy. All figures are
// wall-clock/CPU on this machine; report medians and percentiles, never a single run. Run with `node --expose-gc`
// for meaningful heap figures.
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus, platform, arch, release } from 'node:os';
import { join, basename } from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { Ledger, nodeLedgerFs } from '../src/science/store.ts';
import type { LedgerFs, LedgerEntry } from '../src/science/store.ts';
import { ScientificRuntime } from '../src/science/runtime.ts';
import { CONDITIONS } from '../src/science/protocol.ts';
import { sha256 } from '../src/core/hash.ts';

const [command, ...rest] = process.argv.slice(2);
const flag = (name: string) => { const i = rest.indexOf(name); return i === -1 ? undefined : rest[i + 1]; };
const num = (name: string, fallback?: number) => { const v = flag(name); return v === undefined ? fallback : Number(v); };
const dir = flag('--dir')?.replace(/\/$/, ''), segment = num('--segment-bytes'), out = flag('--out');
if (!dir) throw Error('--dir is required');
const ledgerOptions = (fs?: LedgerFs) => ({ ...(segment === undefined ? {} : { maxSegmentBytes: segment }), ...(fs ? { fs } : {}), ...(flag('--verification') ? { verification: flag('--verification') } : {}) }) as ConstructorParameters<typeof Ledger>[3];

function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b), n = s.length, at = (p: number) => s[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))];
  const mean = s.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
  const r = (x: number) => +x.toFixed(3);
  return { n, min: r(s[0]), p50: r(at(0.5)), p95: r(at(0.95)), p99: r(at(0.99)), max: r(s[n - 1]), mean: r(mean), cv: r(mean ? sd / mean : 0) };
}
/** Run f once; return [value, wallMs, cpuMs]. */
function timed<T>(f: () => T): [T, number, number] {
  const c = process.cpuUsage(), t = performance.now(), v = f(), wall = performance.now() - t, u = process.cpuUsage(c);
  return [v, wall, (u.user + u.system) / 1000];
}
const witnessOf = (d: string) => `${d}.checkpoint`;

if (command === 'build') {
  const cycles = num('--cycles', 30)!;
  const ledger = new Ledger(dir, undefined, undefined, ledgerOptions());
  const runtime = new ScientificRuntime(ledger);
  for (let i = 0; i < cycles; i++) runtime.run({ seed: 1 + (i % 50), condition: CONDITIONS[i % CONDITIONS.length], method: i % 2 ? 'history' : 'adaptive' });
  const layout = ledger.layout();
  console.log(JSON.stringify({ built: basename(dir), cycles, entries: ledger.read().length, sealedSegments: layout.sealed.length, activeBytes: layout.activeBytes, sealedBytes: layout.sealedBytes }));
} else if (command === 'restart-child') {
  // A fresh process: node start-up is excluded; module load is not part of the timed region.
  const ledger = new Ledger(dir, undefined, undefined, ledgerOptions());
  const [entries, wall, cpu] = timed(() => ledger.read());
  console.log(JSON.stringify({ readMs: wall, cpuMs: cpu, entries: entries.length, rssMB: process.memoryUsage().rss / 1048576 }));
} else if (command === 'measure') {
  const reps = num('--reps', 30)!;
  const files = readdirSync(dir).filter((f) => f === 'ledger.json' || /^segment-\d{6}\.json$/.test(f)).sort();
  const copy = () => { const root = mkdtempSync(join(tmpdir(), 'verify-bench-')); cpSync(dir, join(root, 'ledger'), { recursive: true }); cpSync(witnessOf(dir), join(root, 'ledger.checkpoint')); return { root, path: join(root, 'ledger') }; };
  const heap = () => { global.gc?.(); const m = process.memoryUsage(); return { heapMB: m.heapUsed / 1048576, rssMB: m.rss / 1048576 }; };
  const totalBytes = files.reduce((n, f) => n + statSync(join(dir, f)).size, 0);
  const result: Record<string, unknown> = {
    environment: { node: process.version, platform: `${platform()} ${release()} ${arch()}`, cpu: cpus()[0]?.model, logicalCpus: cpus().length, exposeGc: typeof global.gc === 'function' },
    ledger: { name: basename(dir), files: files.length, sealedSegments: files.length - 1, totalBytes, segmentBytes: segment ?? null, verification: flag('--verification') ?? 'default' },
    reps, sections: num('--sections', 10),
  };

  // 1. Stage breakdown on the real files: the primitive operations a full verification performs, timed separately.
  const stage: Record<string, number[]> = { diskReadMs: [], jsonParseMs: [], segmentBytesDigestMs: [], perEntryHashValidationMs: [] };
  for (let r = 0; r < Math.max(7, Math.floor(reps / 3)); r++) {
    global.gc?.();
    const [raws, read] = timed(() => files.map((f) => readFileSync(join(dir, f), 'utf8')));
    const [parsed, parse] = timed(() => raws.map((raw) => JSON.parse(raw) as LedgerEntry[]));
    const [, digest] = timed(() => raws.map((raw) => sha256(raw)));
    const [, entries] = timed(() => { for (const list of parsed) for (const { hash, ...payload } of list) if (hash !== sha256(JSON.stringify(payload))) throw Error('stored hash differs from recomputed hash'); });
    stage.diskReadMs.push(read); stage.jsonParseMs.push(parse); stage.segmentBytesDigestMs.push(digest); stage.perEntryHashValidationMs.push(entries);
  }
  result.stageBreakdownMs = Object.fromEntries(Object.entries(stage).map(([k, v]) => [k, stats(v)]));

  // 2. End-to-end full verification through the public API, on a fresh Ledger object each time.
  const full: number[] = [], fullCpu: number[] = [], fullHeap: number[] = []; let baseHeap = heap().heapMB;
  for (let r = 0; r < reps; r++) {
    const ledger = new Ledger(dir, undefined, undefined, ledgerOptions());
    const [, wall, cpu] = timed(() => ledger.read());
    full.push(wall); fullCpu.push(cpu); fullHeap.push(process.memoryUsage().heapUsed / 1048576 - baseHeap);
  }
  result.fullVerificationMs = stats(full); result.fullVerificationCpuMs = stats(fullCpu); result.heapDeltaMBAfterRead = stats(fullHeap);

  // 3. Appends on a temporary copy, shaped like a real cycle: ONE critical section containing a full read followed by
  //    eight appends (prepared, six events, completed), on one long-lived Ledger object.
  const sections = num('--sections', 10)!;
  const work = copy(); const ledger = new Ledger(work.path, undefined, undefined, ledgerOptions());
  const all: number[] = [], allCpu: number[] = [], first: number[] = [], later: number[] = [], sectionMs: number[] = [], readInSection: number[] = [];
  const small = { padding: 'x'.repeat(200) };
  ledger.read();
  for (let i = 0; i < sections; i++) {
    const t0 = performance.now();
    ledger.exclusive(() => {
      readInSection.push(timed(() => ledger.read())[1]);
      for (let k = 0; k < 8; k++) {
        const kind = k === 0 ? 'prepared' : k === 7 ? 'completed' : 'event';
        const [, wall, cpu] = timed(() => ledger.append(kind, `bench-op-${i}`, kind === 'completed' ? { ok: true } : small));
        all.push(wall); allCpu.push(cpu); (k === 0 ? first : later).push(wall);
      }
    });
    sectionMs.push(performance.now() - t0);
  }
  result.appendMs = stats(all); result.appendCpuMs = stats(allCpu);
  result.appendFirstInSectionMs = stats(first); result.appendLaterInSectionMs = stats(later);
  result.readInSectionMs = stats(readInSection); result.cycleSectionMs = stats(sectionMs);
  rmSync(work.root, { recursive: true, force: true });

  // 4. I/O accounting for ONE cycle-shaped section (separate untimed pass; bytes counted exactly).
  const acc = copy(); let readBytes = 0, writeBytes = 0, reads = 0;
  const counting: LedgerFs = { ...nodeLedgerFs, readFileSync(path) { const v = nodeLedgerFs.readFileSync(path); readBytes += Buffer.byteLength(v); reads++; return v; }, writeFileSync(fd, data) { writeBytes += Buffer.byteLength(data); nodeLedgerFs.writeFileSync(fd, data); } };
  const counted = new Ledger(acc.path, undefined, undefined, ledgerOptions(counting));
  const perAppendRead: number[] = [], perAppendWritten: number[] = []; let sectionRead = 0, sectionWritten = 0, readOnly = 0;
  counted.exclusive(() => {
    counted.read(); readOnly = readBytes;
    for (let k = 0; k < 8; k++) {
      const r0 = readBytes, w0 = writeBytes;
      counted.append(k === 0 ? 'prepared' : k === 7 ? 'completed' : 'event', 'io-op', small);
      perAppendRead.push(readBytes - r0); perAppendWritten.push(writeBytes - w0);
    }
    sectionRead = readBytes; sectionWritten = writeBytes;
  });
  result.ioPerCycleSection = { bytesRead: sectionRead, bytesReadByTheInitialRead: readOnly, bytesWritten: sectionWritten, fileReads: reads, bytesReadByEachAppend: perAppendRead, bytesWrittenByEachAppend: perAppendWritten };
  rmSync(acc.root, { recursive: true, force: true });

  // 5. Restart: a brand-new process verifies the whole history.
  const restart: number[] = [];
  for (let r = 0; r < Math.max(5, Math.floor(reps / 5)); r++) {
    const p = spawnSync(process.execPath, [process.argv[1], 'restart-child', '--dir', dir, ...(segment === undefined ? [] : ['--segment-bytes', String(segment)]), ...(flag('--verification') ? ['--verification', flag('--verification')!] : [])], { encoding: 'utf8' });
    if (p.status !== 0) throw Error('restart child failed');
    restart.push(JSON.parse(p.stdout).readMs);
  }
  result.restartFullVerificationMs = stats(restart);
  result.memoryAfterAll = heap();

  console.log(JSON.stringify({ ledger: result.ledger, fullP50: (result.fullVerificationMs as { p50: number }).p50, appendP50: (result.appendMs as { p50: number }).p50, appendP95: (result.appendMs as { p95: number }).p95, appendP99: (result.appendMs as { p99: number }).p99, sectionP50: (result.cycleSectionMs as { p50: number }).p50, ioSection: { read: (result.ioPerCycleSection as { bytesRead: number }).bytesRead, written: (result.ioPerCycleSection as { bytesWritten: number }).bytesWritten }, restartP50: (result.restartFullVerificationMs as { p50: number }).p50 }));
  if (out) writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
} else {
  throw Error('usage: build | measure | restart-child');
}
