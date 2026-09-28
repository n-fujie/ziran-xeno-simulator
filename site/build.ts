// Builds the static, read-only project site (Vercel) into site/dist/.
// Every number on the page is read from committed result files or computed by the v0.3.0 benchmark code at build
// time; nothing is typed by hand. The interactive simulator is not hosted: its server is long-lived and keeps runs in
// memory, which a static host cannot provide. Usage: node site/build.ts
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ensurePresets } from '../src/presets/index.ts';
import { runBenchmark } from '../src/bench/layers.ts';
import { runTheoryBenchmarks } from '../src/bench/theory.ts';
import { runMetaBenchmarks } from '../src/bench/meta.ts';

const R = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const J = (p: string) => (existsSync(R(p)) ? JSON.parse(readFileSync(R(p), 'utf8')) : null);
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const REPO = 'https://github.com/n-fujie/ziran-xeno-simulator';
const git = (a: string[]) => { try { return execFileSync('git', a, { cwd: R(''), encoding: 'utf8' }).trim(); } catch { return 'unknown'; } };

ensurePresets();
const L = runBenchmark(), T = runTheoryBenchmarks(), M = runMetaBenchmarks();
const nChecks = L.reduce((s, l) => s + l.checks.length, 0), nFail = L.reduce((s, l) => s + l.checks.filter((c) => !c.pass).length, 0);
const neg = J('results/external-comparison/negative-results.json') as string[] | null;
const ct = J('results/external-comparison/cascaded-tanks/result-summary.json');
const x14 = J('results/xeno14/x14-1/summary.json');
const x14b = J('results/xeno14/x14-1b/analysis.json');
const commit = git(['rev-parse', '--short', 'HEAD']);

const tag = (s: string, cls = '') => `<span class="tag ${cls}">${esc(s)}</span>`;
const outcome = (o: string) => tag(o, o === 'positive' ? 'good' : o === 'negative' ? 'bad' : 'unk');
const shots = readdirSync(R('docs/screenshots')).filter((f) => f.endsWith('.png'));

const theoryRows = T.map((t) => `<tr><td>${esc(t.id)}</td><td>${esc(t.title)}</td><td>${outcome(String(t.outcomeType))}</td><td>${esc(t.claimStatus)}</td><td class="small">${esc(t.verdict)}</td></tr>`).join('');
const metaRows = M.map((m) => `<tr><td>${esc(m.id)}</td><td>${esc(m.question)}</td><td>${m.stableOverall ? tag('stable', 'good') : tag('meta-dependent', 'warn')}</td><td class="small">${esc(m.statement)}</td></tr>`).join('');
const ctRows = ct ? Object.entries(ct.simulationE_RMSt as Record<string, number>).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td><td>${esc((ct.predictionE_RMSt as Record<string, number>)[k] ?? '—')}</td></tr>`).join('') + Object.entries(ct.predictionE_RMSt as Record<string, number>).filter(([k]) => k.startsWith('Z-')).map(([k, v]) => `<tr><td>${esc(k)}</td><td>not evaluable</td><td>${esc(v)}</td></tr>`).join('') : '';
const x14Rows = x14 ? Object.entries(x14.configs as Record<string, { role: string; eval: Record<string, Record<string, { mean: number; sd: number | null }>> }>).map(([k, c]) => `<tr><td>${esc(k)}</td><td>${esc(c.role)}</td><td>${esc(c.eval['140'].survival.mean)} ± ${esc(c.eval['140'].survival.sd)}</td></tr>`).join('') : '';
const x14bBlock = x14b ? `<p>Pre-registered redesign X14-1b (Walker2d-v5 and Hopper-v5, 10 seeds each; protocol frozen in <code>${esc(x14b.meta.protocolFreezeCommit.slice(0, 7))}</code>): the frozen decision rule returns <b>${esc(x14b.decision.recommendation)}</b> (consistent ignition: ${esc(x14b.decision.d_consistentIgnition)}); hypothesis H1 supported: ${esc(x14b.H1?.supported)} (reversed); H2 supported: ${esc(x14b.H2?.supported)}.</p><p class="small">Analyst assessment, reported separately from the rule: the only robust declared transfer is reproduced in direction, with a larger absolute effect, by an ordinary scalarized multi-objective controller; Xeno-14 is not demonstrated to be nonredundant, and expansion to fourteen principles is not recommended. See <a href="${REPO}/blob/research/xeno14-integration/docs/xeno14-x14-1b-report.md">xeno14-x14-1b-report.md</a>.</p>` : `<p>A pre-registered redesign (X14-1b: two embodiments, ten seeds, uncapped metrics) is frozen on the research branch; its results are not yet published here.</p>`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ziran / Xeno Simulator</title><meta name="description" content="Open research prototype for operational-shape dynamics, observability generation and description-space reorganization. Benchmark results are synthetic and are not empirical validation.">
<style>
:root{--bg:#f7f7f5;--panel:#fff;--ink:#1d1d1f;--muted:#5d6068;--line:#e3e3e0;--accent:#2f5bd3;--good:#1f7a4d;--bad:#b3261e;--warn:#8a5a00;--soft:#f0f0ec}
@media (prefers-color-scheme:dark){:root{--bg:#141517;--panel:#1c1d20;--ink:#e8e8ea;--muted:#9a9ca3;--line:#2c2e33;--accent:#7ea2ff;--good:#6fd39b;--bad:#ff8a80;--warn:#e7b35a;--soft:#24262a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1040px;margin:0 auto;padding:24px 16px 64px}h1{font-size:28px;margin:8px 0 2px}h2{font-size:20px;margin:36px 0 10px;border-top:1px solid var(--line);padding-top:24px}h3{font-size:16px;margin:18px 0 6px}
.sub{color:var(--muted);margin:0 0 14px}.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:12px 0}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13.5px}td,th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}th{color:var(--muted);font-weight:600}
.small{font-size:12.5px;color:var(--muted)}.tag{display:inline-block;border:1px solid var(--line);border-radius:6px;padding:0 6px;font-size:12px;background:var(--soft)}.good{color:var(--good)}.bad{color:var(--bad)}.warn{color:var(--warn)}.unk{color:var(--muted)}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}pre{background:var(--soft);padding:10px 12px;border-radius:8px;overflow-x:auto}a{color:var(--accent)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr));gap:12px}.grid figure{margin:0}.grid img{width:100%;border:1px solid var(--line);border-radius:8px;background:var(--panel)}figcaption{font-size:12.5px;color:var(--muted)}
ul{padding-left:20px}li{margin:3px 0}footer{margin-top:40px;color:var(--muted);font-size:12.5px}
</style></head><body><main>
<h1>Ziran / Xeno Operational World Simulator</h1>
<p class="sub">Operational-Shape Dynamics, Observability Generation, and Description-Space Reorganization · v0.3.0 · open research prototype · <a href="${REPO}">GitHub</a></p>
<div class="panel"><p>Ziran / Xeno Operational World Simulator is an experimental framework for studying how operational differences ignite under configuration-dependent conditions, alter downstream reachability, penetrate across coupled configurations, and reorganize observation and description systems.</p>
<p>The current release supports explicit analysis of configuration reorganization, description-space transformation, and partially revisable meta-configuration. Its benchmark results are synthetic and are not empirical validation of the underlying theoretical framework.</p>
<p class="small">Not a completed theory implementation, not an empirically validated theory, not an unrestricted autonomous-science system, not an ontology-free simulator, not a historical-person simulator. A/B/C/D are revisable analytical distinctions, not ontological strata. The framework exposes and partially revises some presuppositions; it does not eliminate them.</p></div>

<h2>Run it</h2>
<p>This page is a static, read-only summary. The interactive simulator runs locally (Node.js ≥ 23.6, no runtime dependencies):</p>
<pre>git clone ${REPO}.git
cd ziran-xeno-simulator
npm start        # http://127.0.0.1:3010</pre>

<h2>Benchmark suites (v0.3.0, computed at build time)</h2>
<p>Implementation Conformance: <b>${nChecks} checks, ${nFail} failed</b> (claim status: implementation property). None of the suites is empirical validation.</p>
<h3>Theory-Discriminating A–N</h3><div class="scroll"><table><tr><th>id</th><th>benchmark</th><th>outcome</th><th>claim status</th><th>result</th></tr>${theoryRows}</table></div>
<h3>Meta-Boundedness MB1–MB7</h3><div class="scroll"><table><tr><th>id</th><th>question</th><th>result</th><th>statement</th></tr>${metaRows}</table></div>

<h2>Negative and null results</h2>
<p>The simulator is not designed to force Ziran / Xeno mechanisms to win. See <a href="${REPO}/blob/main/docs/negative-results.md">negative-results.md</a>.</p>

<h2>Research branch: external model comparison (unreleased)</h2>
<p class="small">Branch <a href="${REPO}/tree/research/external-comparison"><code>research/external-comparison</code></a>. Synthetic worlds W1–W5 against ABM, control/MPC, RL, active inference, digital twins, dynamical systems, viability and feature learning; no global ranking.</p>
${neg ? `<details class="panel"><summary>${neg.length} negative / null statements derived from the records</summary><ul>${neg.map((n) => `<li class="small">${esc(n)}</li>`).join('')}</ul></details>` : ''}
${ct ? `<h3>Cascaded Tanks (real data, replayed empirical result)</h3><p class="small">4TU.ResearchData DOI 10.4121/12960104.v1 (CC BY-SA 4.0); protocol ${esc(ct.protocol)} frozen in <code>${esc(String(ct.protocolFreezeCommit).slice(0, 7))}</code> before fitting. e_RMSt on the test record (V). ${esc(ct.fairnessVerdict)}.</p><div class="scroll"><table><tr><th>model</th><th>simulation</th><th>one-step prediction</th></tr>${ctRows}</table></div><p><b>No non-redundant Ziran / Xeno distinction was observed under this protocol.</b></p>` : ''}

<h2>Research branch: Xeno-14 embodied experiment (unreleased)</h2>
<p class="small">Branch <a href="${REPO}/tree/research/xeno14-integration"><code>research/xeno14-integration</code></a>. Walker2d-v5 (MuJoCo), three Xeno-14 organizations as removable PyTorch modules, Fragility Transfer by intervention.</p>
${x14 ? `<p>Milestone X14-1 recommendation: <b>STOP (redesign required)</b> — no sign-consistent Fragility Transfer; scalarized training of the same architecture and gates-off controllers performed as well or better.</p><div class="scroll"><table><tr><th>configuration</th><th>role</th><th>survival at 140 N push (3 seeds)</th></tr>${x14Rows}</table></div>` : ''}
${x14bBlock}

<h2>Screenshots</h2>
<div class="grid">${shots.map((f) => `<figure><img src="screenshots/${esc(f)}" alt="${esc(f.replace('.png', '').replace(/-/g, ' '))}" loading="lazy"><figcaption>${esc(f.replace('.png', '').replace(/-/g, ' '))}</figcaption></figure>`).join('')}</div>

<h2>Documents</h2>
<ul>${['README.md', 'DESIGN.md', 'LIMITATIONS.md', 'BENCHMARKS.md', 'REPRODUCIBILITY.md', 'CHANGELOG.md', 'docs/claims.md', 'docs/negative-results.md'].map((d) => `<li><a href="${REPO}/blob/main/${d}">${esc(d)}</a></li>`).join('')}</ul>

<footer>Naoto Fujie · MIT License · no DOI · built from commit <code>${esc(commit)}</code> · all results are synthetic-world results unless marked otherwise</footer>
</main></body></html>`;

const out = R('site/dist'); mkdirSync(out + '/screenshots', { recursive: true });
writeFileSync(out + '/index.html', html);
for (const f of shots) copyFileSync(R(`docs/screenshots/${f}`), `${out}/screenshots/${f}`);
writeFileSync(out + '/vercel.json', JSON.stringify({ $schema: 'https://openapi.vercel.sh/vercel.json', framework: null, buildCommand: null, installCommand: null, outputDirectory: '.', cleanUrls: true, trailingSlash: false, github: { silent: true } }, null, 2) + '\n');
console.log(`site/dist built from ${commit}: ${nChecks} checks, ${T.length} theory, ${M.length} meta, ${shots.length} screenshots`);
