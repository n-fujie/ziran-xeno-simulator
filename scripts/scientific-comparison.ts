// Matched synthetic protocols; timings include ranking and the end-to-end ledger transaction.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir, cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { Ledger } from '../src/science/store.ts';
import { ScientificRuntime, METHODS, scientificFingerprint, PROTOCOL } from '../src/science/runtime.ts';
import type { CycleResult, Method } from '../src/science/runtime.ts';
import { CONDITIONS } from '../src/science/protocol.ts';
import type { Condition } from '../src/science/protocol.ts';
import { sha256 } from '../src/core/hash.ts';

const args = process.argv.slice(2);
function flag(name: string) { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; }
const output = flag('--out');
if (!output) throw Error('usage: node scripts/scientific-comparison.ts --out <file> [--receipts-dir <directory>]');
const retained = flag('--receipts-dir');
const evidence = retained ? resolve(retained) : mkdtempSync(join(tmpdir(), 'science-comparison-'));
mkdirSync(evidence, { recursive: true });
if (readdirSync(evidence).length) throw Error('receipts directory must be empty to avoid contaminating trial history');
type Row = Pick<CycleResult, 'state' | 'selected' | 'adoptionVerified' | 'finalScore' | 'decisions' | 'failures' | 'resources'> & {
  condition: Condition; budget: number; seed: number; round: number; targetSeed: number; method: Method; fingerprint: string;
  intervention: { action: number; expectedChange: number; actualChange: number | null; consistent: boolean } | null;
  historyRecords: number; endToEndWallMs: number; endToEndCpuUserMicros: number; endToEndCpuSystemMicros: number;
};
const rows: Row[] = [];
try {
  for (const condition of CONDITIONS) for (const budget of [3, 4]) for (const seed of [1, 2, 3]) {
    const runtimes = METHODS.map((method) => new ScientificRuntime(new Ledger(join(evidence, `${condition}-${budget}-${seed}-${method}`))));
    // Rotate order to reduce systematic startup/order bias. Each method runs alone on this machine.
    for (const round of [0, 1]) for (let offset = 0; offset < METHODS.length; offset++) {
      const index = (offset + seed + round) % METHODS.length;
      const method = METHODS[index];
      const cpu = process.cpuUsage(), start = performance.now();
      const result = runtimes[index].run({ method, condition, seed: seed * 100 + round, budget });
      const endToEndWallMs = performance.now() - start, usage = process.cpuUsage(cpu);
      rows.push({ condition, budget, seed, round, targetSeed: result.request.seed, method,
        fingerprint: scientificFingerprint(result), state: result.state, selected: result.selected, adoptionVerified: result.adoptionVerified,
        finalScore: result.finalScore, decisions: result.decisions, failures: result.failures,
        intervention: result.intervention && { action: result.intervention.action, expectedChange: result.intervention.expectedChange, actualChange: result.intervention.actualChange, consistent: result.intervention.consistent },
        historyRecords: result.provenance.historyRefs.length, resources: result.resources,
        endToEndWallMs, endToEndCpuUserMicros: usage.user, endToEndCpuSystemMicros: usage.system });
    }
  }
  const summary = CONDITIONS.flatMap((condition) => [3, 4].flatMap((budget) => METHODS.map((method) => {
    const group = rows.filter((r) => r.condition === condition && r.budget === budget && r.method === method);
    const average = (f: (r: typeof group[number]) => number) => group.reduce((sum, r) => sum + f(r), 0) / group.length;
    return { condition, budget, method, runs: group.length, verifiedAdoptions: group.filter((r) => r.adoptionVerified).length,
      consistentInterventions: group.filter((r) => r.intervention?.consistent).length, quarantined: group.filter((r) => r.state === 'quarantined').length,
      meanFinalScore: average((r) => r.finalScore ?? 0), meanMeasurementCount: average((r) => r.resources.measurementCount + r.resources.referenceMeasurements),
      meanRankingMs: average((r) => r.resources.rankingMs), meanEndToEndWallMs: average((r) => r.endToEndWallMs),
      meanEndToEndCpuMicros: average((r) => r.endToEndCpuUserMicros + r.endToEndCpuSystemMicros) };
  })));
  const sourceFiles = ['src/science/protocol.ts', 'src/science/runtime.ts', 'src/science/store.ts', 'scripts/scientific-comparison.ts'];
  const report = { protocol: PROTOCOL, claimStatus: 'synthetic-world result', generatedAt: new Date().toISOString(),
    environment: { node: process.version, platform: platform(), arch: arch(), cpuModel: cpus()[0]?.model, logicalCpus: cpus().length,
      baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceSha256: Object.fromEntries(sourceFiles.map((f) => [f, sha256(readFileSync(f, 'utf8'))])) },
    controls: { seeds: [1, 2, 3], rounds: 2, candidateBudgetCaps: [3, 4], adoptionCap: 1, interventionOpportunities: 1, pairsPerPartition: 3,
      partitions: ['generation', 'decision', 'evaluation'], execution: 'sequential, rotated method order, same process and machine',
      costs: 'unit charge per channel acquisition and reference probe; ranking CPU/wall included; end-to-end includes durable I/O; modeled costs are not physical energy',
      history: 'same number of prior trial opportunities; D uses its own compatible prior records, other methods also persist records but do not query them; no extra target source; realized prior measurements can differ with strategy',
      fairness: 'equal caps and opportunities, not equal realized measurement counts or CPU quotas; E is a separate incompatible-prior stress test, not a matched superiority comparison',
      limitations: 'small supplied synthetic grammar; target instances reset each episode; B and F are identical in this protocol; no history-specific performance advantage is established; rankings can change workload' },
    summary, rows };
  mkdirSync(dirname(resolve(output)), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`${rows.length} cycles completed; ${summary.length} comparison cells; report: ${output}`);
} finally { if (!retained) rmSync(evidence, { recursive: true, force: true }); }
