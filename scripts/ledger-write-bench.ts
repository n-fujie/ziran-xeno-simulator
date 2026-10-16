// Measures bytes written per ledger append, with and without segment rotation, on a real scientific workload.
// Usage: node scripts/ledger-write-bench.ts --cycles <n> [--segment-bytes <n>] [--out <file>]
// Byte counts come from instrumenting every file write the ledger performs (pending file + witness), not from
// estimates. Byte totals are reproducible to within ~1% (results embed timing floats); times are machine-dependent.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Ledger, nodeLedgerFs } from '../src/science/store.ts';
import type { LedgerFs } from '../src/science/store.ts';
import { ScientificRuntime } from '../src/science/runtime.ts';
import { CONDITIONS } from '../src/science/protocol.ts';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; };
const cycles = Number(flag('--cycles') ?? 30), segment = flag('--segment-bytes') === undefined ? undefined : Number(flag('--segment-bytes')), out = flag('--out');
if (!Number.isSafeInteger(cycles) || cycles < 1) throw Error('--cycles must be a positive integer');

const roles = new Map<number, string>(); let pending = 0, witness = 0, appendIndex = -1;
const perAppend: { pending: number; witness: number; ms: number }[] = [];
const fs: LedgerFs = {
  ...nodeLedgerFs,
  openSync(path, flags, mode) {
    const fd = nodeLedgerFs.openSync(path, flags, mode);
    const name = path.split('/').pop()!;
    if (name.startsWith('.pending-')) { roles.set(fd, 'pending'); perAppend.push({ pending: 0, witness: 0, ms: 0 }); appendIndex++; }
    else if (name.endsWith('.tmp')) roles.set(fd, 'witness');
    return fd;
  },
  writeFileSync(fd, data) {
    nodeLedgerFs.writeFileSync(fd, data);
    const n = Buffer.byteLength(data);
    if (roles.get(fd) === 'pending') { pending += n; perAppend[appendIndex].pending = n; } else if (roles.get(fd) === 'witness') { witness += n; perAppend[appendIndex].witness = n; }
  },
};
const root = mkdtempSync(join(tmpdir(), 'ledger-write-bench-'));
try {
  const ledger = new Ledger(join(root, 'ledger'), undefined, undefined, { fs, ...(segment === undefined ? {} : { maxSegmentBytes: segment }) });
  const runtime = new ScientificRuntime(ledger);
  const append = ledger.append.bind(ledger);
  (ledger as { append: Ledger['append'] }).append = (...a) => { const t = performance.now(); const r = append(...a); perAppend[appendIndex].ms = performance.now() - t; return r; };
  const start = performance.now();
  for (let i = 0; i < cycles; i++) runtime.run({ seed: 1 + (i % 50), condition: CONDITIONS[i % CONDITIONS.length], method: i % 2 ? 'history' : 'adaptive' });
  const wall = performance.now() - start;
  const layout = ledger.layout(), logical = layout.activeBytes + layout.sealedBytes;
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const result = {
    cycles, appends: perAppend.length, segmentBytes: segment ?? null, sealedSegments: layout.sealed.length,
    logicalBytes: logical, bytesWritten: pending + witness, pendingBytesWritten: pending, witnessBytesWritten: witness,
    writeAmplification: +((pending + witness) / logical).toFixed(2),
    maxPendingBytesPerAppend: Math.max(...perAppend.map((a) => a.pending)), maxWitnessBytesPerAppend: Math.max(...perAppend.map((a) => a.witness)),
    lastAppendBytes: perAppend.at(-1)!.pending + perAppend.at(-1)!.witness,
    machineDependent: { avgAppendMsFirst10: +avg(perAppend.slice(0, 10).map((a) => a.ms)).toFixed(2), avgAppendMsLast10: +avg(perAppend.slice(-10).map((a) => a.ms)).toFixed(2), wallMs: Math.round(wall) },
  };
  console.log(JSON.stringify(result));
  if (out) writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
} finally { rmSync(root, { recursive: true, force: true }); }
