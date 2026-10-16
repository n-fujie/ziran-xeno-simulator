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
import { sha256, hashOf } from '../src/core/hash.ts';

const args = process.argv.slice(2);
function flag(name: string) { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; }
const output = flag('--out');
const verifyAgainst = flag('--verify-against');
if (!output) throw Error('usage: node scripts/scientific-comparison.ts --out <file> [--receipts-dir <directory>] [--verify-against <file>] [--segment-bytes <n>]');
const retained = flag('--receipts-dir');
// Optional: store every chain with segment rotation. Scientific fingerprints must not depend on the storage layout.
const segmentBytes = flag('--segment-bytes') === undefined ? undefined : Number(flag('--segment-bytes'));
const evidence = retained ? resolve(retained) : mkdtempSync(join(tmpdir(), 'science-comparison-'));
mkdirSync(evidence, { recursive: true });
if (readdirSync(evidence).length) throw Error('receipts directory must be empty to avoid contaminating trial history');
type Row = Pick<CycleResult, 'state' | 'selected' | 'adoptionVerified' | 'finalScore' | 'decisions' | 'failures' | 'resources' | 'generationRevision' | 'connection'> & {
  condition: Condition; budget: number; seed: number; round: number; targetSeed: number; method: Method; fingerprint: string;
  intervention: { action: number; expectedChange: number; actualChange: number | null; consistent: boolean } | null;
  historyRecords: number; endToEndWallMs: number; endToEndCpuUserMicros: number; endToEndCpuSystemMicros: number;
  accessAudit: { generation: string; evaluation: string; control: string; decisionReferenceAcquisitions: number };
};
const rows: Row[] = [];
const sharedPackets = new Map<string, string>();
try {
  for (const condition of CONDITIONS) for (const budget of [3, 4]) for (const seed of [1, 2, 3]) {
    const runtimes = METHODS.map((method) => new ScientificRuntime(new Ledger(join(evidence, `${budget}-${seed}-${method}`), undefined, undefined, segmentBytes === undefined ? {} : { maxSegmentBytes: segmentBytes })));
    // Rotate order to reduce systematic startup/order bias. Each method runs alone on this machine.
    for (const round of [0, 1]) for (let offset = 0; offset < METHODS.length; offset++) {
      const index = (offset + seed + round) % METHODS.length;
      const method = METHODS[index];
      const cpu = process.cpuUsage(), start = performance.now();
      const result = runtimes[index].run({ method, condition, seed: seed * 100 + round, budget });
      if (result.resources.evaluatedCandidates > budget || result.resources.adoptions > 1 || result.resources.interventions > 1 || result.resources.measurementCount + result.resources.referenceMeasurements !== result.measurements.length) throw Error('protocol/resource invariant violated');
      const referencePackets = result.measurements.filter((m) => m.apparatus === 'independent-reference-probe');
      for (const m of referencePackets) {
        const key = `${condition}:${budget}:${m.acquisitionKey}`, digest = hashOf({ value: m.value, status: m.status, scale: m.scale, window: m.window, route: m.route });
        if (sharedPackets.has(key) && sharedPackets.get(key) !== digest) throw Error('matched acquisition slot received different target/noise information');
        sharedPackets.set(key, digest);
      }
      const packetDigest = (partition: string) => hashOf(referencePackets.filter((m) => m.partition === partition).map((m) => ({ key: m.acquisitionKey, value: m.value, status: m.status })));
      const endToEndWallMs = performance.now() - start, usage = process.cpuUsage(cpu);
      rows.push({ condition, budget, seed, round, targetSeed: result.request.seed, method,
        fingerprint: scientificFingerprint(result), state: result.state, selected: result.selected, adoptionVerified: result.adoptionVerified,
        finalScore: result.finalScore, decisions: result.decisions, failures: result.failures,
        intervention: result.intervention && { action: result.intervention.action, expectedChange: result.intervention.expectedChange, actualChange: result.intervention.actualChange, consistent: result.intervention.consistent },
        historyRecords: result.provenance.historyRefs.length, resources: result.resources, generationRevision: result.generationRevision, connection: result.connection,
        accessAudit: { generation: packetDigest('generation'), evaluation: packetDigest('evaluation'), control: packetDigest('control'), decisionReferenceAcquisitions: referencePackets.filter((m) => m.partition === 'decision').length },
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
  if (rows.length !== 504 || summary.some((s) => s.runs !== 6)) throw Error('comparison did not execute all targets');
  if (verifyAgainst) {
    const previous = JSON.parse(readFileSync(verifyAgainst, 'utf8'));
    if (previous.protocol !== PROTOCOL || previous.rows.length !== rows.length || rows.some((row, i) => row.fingerprint !== previous.rows[i].fingerprint)) throw Error('scientific reproducibility mismatch');
    console.log('All 504 scientific fingerprints reproduced exactly');
  }
  const report = { protocol: PROTOCOL, claimStatus: 'synthetic-world result', generatedAt: new Date().toISOString(),
    environment: { node: process.version, platform: platform(), arch: arch(), cpuModel: cpus()[0]?.model, logicalCpus: cpus().length,
      baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceSha256: Object.fromEntries(sourceFiles.map((f) => [f, sha256(readFileSync(f, 'utf8'))])) },
    controls: { seeds: [1, 2, 3], rounds: 2, candidateBudgetCaps: [3, 4], adoptionCap: 1, interventionOpportunities: 1, pairsPerPartition: 3,
      partitions: ['generation', 'independent decision cohort per candidate slot', 'evaluation', 'control'], execution: 'sequential, rotated method order, same process and machine; no exogenous noise in these fixtures',
      accessAudit: 'every common reference acquisition key is checked for identical target/noise payload across methods; generation/final/control packet digests are retained per run; candidate-slot datasets are disjoint within each method',
      costs: 'all recorded channel/reference acquisitions; generation/decision CPU and wall separately measured; ranking CPU in cycle total plus ranking wall; end-to-end includes history query and durable phase/checkpoint I/O; unit costs are not physical energy',
      history: 'all methods persist all previous condition episodes; D queries compatible and E queries foreign-condition real records with the same eight-record cap, no extra target source; actual historical packets can differ with prior choices; original synthetic bad-prior test retained separately',
      fairness: 'equal access opportunities and explicit candidate/adoption/actuation caps, not equal realized information or CPU quotas; fixed/trigger/no-history are policy ablations and E is a context-mismatch stress test; no strict universal fairness or superiority claim',
      limitations: 'small supplied synthetic grammar; target instances reset each episode; B and F are identical in this protocol; no history-specific performance advantage is established; rankings can change workload' },
    summary, rows };
  mkdirSync(dirname(resolve(output)), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`${rows.length} cycles completed; ${summary.length} comparison cells; report: ${output}`);
} finally { if (!retained) rmSync(evidence, { recursive: true, force: true }); }
