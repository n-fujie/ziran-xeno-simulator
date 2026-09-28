#!/usr/bin/env node
// CLI: list presets, run an experiment, export traces, run the benchmark suite.
import { writeFileSync } from 'node:fs';
import { ensurePresets, listPresets } from '../src/presets/index.ts';
import { runExperiment, rerun } from '../src/core/experiment.ts';
import { runBenchmark } from '../src/bench/layers.ts';
import { runTheoryBenchmarks } from '../src/bench/theory.ts';
import { runMetaBenchmarks } from '../src/bench/meta.ts';
import { tiiJsonl } from '../src/core/tii.ts';
import { validateTrace } from '../src/core/trace.ts';

ensurePresets();
const [cmd, ...args] = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : undefined; };

if (cmd === 'list') {
  for (const p of listPresets()) console.log(`${String(p.layer ?? '').padStart(2)}  ${p.id.padEnd(34)} ${p.title}`);
} else if (cmd === 'run') {
  const preset = args[0];
  const params = flag('params') ? JSON.parse(flag('params')!) : {};
  const x = { preset, params, seed: flag('seed') ? Number(flag('seed')) : undefined };
  const tr = runExperiment(x);
  console.log(JSON.stringify({ meta: tr.meta, summary: tr.summary, probes: tr.probes }, null, 2));
  if (flag('out')) { writeFileSync(flag('out')!, JSON.stringify(tr)); console.log('trace →', flag('out')); }
  if (flag('tii')) { writeFileSync(flag('tii')!, tiiJsonl(tr)); console.log('TII records →', flag('tii')); }
  if (args.includes('--verify-rerun')) console.log('exact rerun:', rerun(x, tr));
} else if (cmd === 'bench') {
  const only = flag('layers')?.split(',').map(Number);
  const suite = flag('suite') ?? 'all';
  if (!['all', 'conformance', 'theory', 'meta'].includes(suite)) { console.error('--suite must be all | conformance | theory | meta'); process.exit(2); }
  const t0 = Date.now();
  const res = suite === 'all' || suite === 'conformance' ? runBenchmark(only) : [];
  const icon = { pass: '✓', fail: '✗', untrusted: '?' } as const;
  let failed = 0;
  if (res.length) console.log('Implementation Conformance Benchmarks (spec conformance — not theory validation; claim status: implementation property)');
  for (const L of res) {
    console.log(`\nLayer ${L.layer} — ${L.title}  [${L.status}]`);
    for (const c of L.checks) {
      if (!c.pass) failed++;
      console.log(`  ${icon[c.status]} ${c.id.padEnd(36)} ${String(c.ms).padStart(5)}ms  ${c.claim}`);
      if (!c.pass || args.includes('--verbose')) console.log('      evidence:', JSON.stringify(c.evidence)?.slice(0, 600), c.error ? '\n      ' + c.error.split('\n').slice(0, 3).join('\n      ') : '');
    }
  }
  if (res.length) console.log(`\n${res.reduce((a, l) => a + l.checks.length, 0)} conformance checks, ${failed} failed, ${Date.now() - t0}ms`);
  let theory: ReturnType<typeof runTheoryBenchmarks> = [];
  if (!only && (suite === 'all' || suite === 'theory')) {
    console.log('\nTheory-Discriminating Benchmarks (competing model classes / ablations; simulation-internal)');
    theory = runTheoryBenchmarks();
    for (const r of theory) {
      console.log(`  ${r.discriminates ? '◆' : '◇'} ${r.id}  ${r.title}  [${r.definition?.kind ?? ''}; discriminates: ${r.discriminates}; hypothesis: ${r.hypothesis === null ? 'none (no winner predefined)' : r.hypothesisHolds ? 'holds' : 'does not hold'}; outcome: ${r.outcomeType}]  ${r.ms}ms`);
      console.log(`      ${r.verdict}  [claim status: ${r.claimStatus}; evidence: ${r.evidence}]`);
      if (r.error) { failed++; console.log('      ' + r.error.split('\n')[0]); }
      if (args.includes('--verbose')) console.log('      axes:', JSON.stringify(r.axes).slice(0, 800));
    }
  }
  let meta: ReturnType<typeof runMetaBenchmarks> = [];
  if (!only && (suite === 'all' || suite === 'meta')) {
    console.log('\nMeta-Boundedness Benchmarks (dependence of results on the supplied meta-configuration)');
    meta = runMetaBenchmarks();
    for (const r of meta) { console.log(`  ${r.stableOverall ? '=' : '≠'} ${r.id}  ${r.question}  ${r.ms}ms\n      ${r.statement}`); if (r.error) { failed++; console.log('      ' + r.error.split('\n')[0]); } }
  }
  if (flag('out')) writeFileSync(flag('out')!, JSON.stringify({ conformance: res, theory, meta }, null, 2));
  if (theory.length) console.log(`\n${theory.length} theory benchmarks: ${['positive', 'negative', 'null'].map((k) => `${theory.filter((r) => r.outcomeType === k).length} ${k}`).join(', ')}, ${theory.filter((r) => r.error).length} errors`);
  if (meta.length) console.log(`${meta.length} meta-boundedness benchmarks: ${meta.filter((r) => r.stableOverall).length} stable, ${meta.filter((r) => !r.stableOverall && !r.error).length} meta-dependent, ${meta.filter((r) => r.error).length} errors`);
  process.exitCode = failed ? 1 : 0;
} else if (cmd === 'check-presets') {
  // Runs every preset with defaults, validates the trace and verifies an exact rerun.
  let bad = 0;
  for (const p of listPresets()) {
    const t0 = Date.now();
    try {
      const x = { preset: p.id, params: {} };
      const tr = runExperiment(x);
      const v = validateTrace(tr), rr = rerun(x, tr);
      const ok = v.length === 0 && rr.equal;
      if (!ok) bad++;
      console.log(`${ok ? '✓' : '✗'} ${p.id.padEnd(36)} ${String(tr.events.length).padStart(6)} events  rerun ${rr.equal ? "identical" : "DIFFERENT"}  ${v.length ? v.length + ' violations' : ''} ${Date.now() - t0}ms`);
    } catch (e) { bad++; console.log(`✗ ${p.id}  ${(e as Error).message}`); }
  }
  console.log(`\n${listPresets().length} presets, ${bad} failed`);
  process.exitCode = bad ? 1 : 0;
} else {
  console.log('usage: zx list | zx run <preset> [--params JSON] [--seed N] [--out trace.json] [--tii tii.jsonl] [--verify-rerun] | zx bench [--suite all|conformance|theory|meta] [--layers 1,2] [--verbose] [--out results.json] | zx check-presets');
}
