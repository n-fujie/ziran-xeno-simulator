// Runs protocol CT-P1 on the Cascaded Tanks benchmark and writes results/external-comparison/cascaded-tanks/*.json
// and docs/cascaded-tanks-results.md. The test record is evaluated once per final model.
// Usage: node comparison/empirical/run-cascaded-tanks.ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { load, MODELS, ziran, rmse, mae, fitPct, N, FIT, type ZiranOut } from './cascaded-tanks.ts';
import { mean, round } from '../frameworks/lib.ts';

const out = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const R = 'results/external-comparison/cascaded-tanks/';
const git = (a: string[]) => { try { return execFileSync('git', a, { cwd: out(''), encoding: 'utf8' }).trim(); } catch { return 'unknown'; } };
const d = load();
const BAND = 9.0; const hi = d.yTest.map((v, i) => i).filter((i) => d.yTest[i] >= BAND), lo = d.yTest.map((v, i) => i).filter((i) => d.yTest[i] < BAND);
const r4 = (x: number | null) => (x === null ? null : Number.isFinite(x) ? round(x, 4) : 'diverged');
const lag1 = (e: number[]) => { const m = mean(e); const v = mean(e.map((x) => (x - m) ** 2)); return mean(e.slice(1).map((x, i) => (x - m) * (e[i] - m))) / (v || 1); };

// ------------------------------------------------------------------ fit conventional models
const m1 = MODELS.M1(d), m2 = MODELS.M2(d), m3 = MODELS.M3(d), m4a = MODELS.M4(d, false), m4b = MODELS.M4(d, true), m5 = MODELS.M5(d, m4b), m6 = MODELS.M6(d), m7 = MODELS.M7(d);
const conv = [m1, m2, m3, m4a, m4b, m5, m6, m7];
const initLag = (id: string) => ({ 'M1-ARX': m1.describe.na, 'M3-NARX': m3.describe.na, 'M6-MLP': m6.describe.lags, 'M7-PWARX': m7.describe.na } as Record<string, unknown>)[id] as number | undefined ?? 0;

const baseline = conv.map((m) => {
  const L = initLag(m.id);
  const ti = performance.now(); const sim = m.simulate ? m.simulate(d.uTest, d.yTest) : null; const pred = m.predict ? m.predict(d.uTest, d.yTest) : null; const inferMs = performance.now() - ti;
  const simEst = m.simulate ? m.simulate(d.uEst, d.yEst) : null, predEst = m.predict ? m.predict(d.uEst, d.yEst) : null;
  const resEst = (predEst ?? simEst)!.map((v, t) => d.yEst[t] - v).slice(Math.max(L, 2));
  return {
    id: m.id, family: m.family, describe: m.describe,
    simulation: sim ? { e_RMSt: r4(rmse(d.yTest, sim)), rmseExclInit: r4(rmse(d.yTest, sim, L)), mae: r4(mae(d.yTest, sim, L)), fitPct: r4(fitPct(d.yTest, sim, L)), rmse_band_y_ge_9: r4(rmse(d.yTest, sim, 0, hi)), rmse_band_y_lt_9: r4(rmse(d.yTest, sim, 0, lo)) } : 'not defined for this model',
    prediction: pred ? { e_RMSt: r4(rmse(d.yTest, pred)), rmseExclInit: r4(rmse(d.yTest, pred, L)), mae: r4(mae(d.yTest, pred, L)), fitPct: r4(fitPct(d.yTest, pred, L)), rmse_band_y_ge_9: r4(rmse(d.yTest, pred, 0, hi)), rmse_band_y_lt_9: r4(rmse(d.yTest, pred, 0, lo)) } : 'not defined for this model',
    initializationSamples: L,
    residualLag1Autocorr_estimation: round(lag1(resEst), 3), insufficiencySignal: Math.abs(lag1(resEst)) > 2 / Math.sqrt(resEst.length),
    perSeed: 'perSeed' in m ? (m as typeof m6).perSeed.map((p) => ({ seed: p.seed, simE_RMSt: r4(rmse(d.yTest, p.model(d.uTest, d.yTest, true))), predE_RMSt: r4(rmse(d.yTest, p.model(d.uTest, d.yTest, false))) })) : undefined,
    cost: { fitMs: round(m.fitMs, 1), inferenceMs: round(inferMs, 2), trainableParameters: m.params, observationsUsed: N, adaptationSteps: m.adaptationSteps },
    claimStatus: 'replayed empirical result',
  };
});

// ------------------------------------------------------------------ Ziran / Xeno adapter and ablations
const variants = ['Z-full', 'Z-fixed-observations', 'Z-no-grammar-revision', 'Z-fixed-description-space', 'Z-no-multiple-windows', 'Z-no-meta'] as const;
const Z: Record<string, ZiranOut> = {}; for (const v of variants) Z[v] = ziran(d, v);
const zRes = (z: ZiranOut) => ({ id: z.id, simulation: 'not evaluable: generated variables are functions of measured series; the adapter has no generative simulation of y', prediction: { e_RMSt: r4(rmse(d.yTest, z.predict)), mae: r4(mae(d.yTest, z.predict)), fitPct: r4(fitPct(d.yTest, z.predict)), rmse_band_y_ge_9: r4(rmse(d.yTest, z.predict, 0, hi)), rmse_band_y_lt_9: r4(rmse(d.yTest, z.predict, 0, lo)) }, generatedVariables: z.generated, operatorOrigins: z.origins, retainedGrammarChanges: z.retainedChanges, representationChanged: z.representationChanged, aliasingRecords_v030Key: z.aliasingRecords, replayRoundTrip: z.replayRoundTrip, configuration: z.configuration, cost: { fitMs: round(z.fitMs, 1), trainableParameters: z.params, observationsUsed: N }, predictionInformation: 'ŷ(t) from u(t−1), y(t−1) and generated variables at t−1 (the current input u(t) is not used)', protocolInterpretation: 'the adapter has no validation-selected hyperparameters, so the final fit uses all 1024 estimation rows (trainUntil = 1024); test rows are never used for selection', claimStatus: 'replayed empirical result' });
const ziranResults = zRes(Z['Z-full']);
const ablations = variants.filter((v) => v !== 'Z-full').map((v) => { const a = zRes(Z[v]), f = ziranResults; return { ablation: v, predE_RMSt: a.prediction.e_RMSt, fullPredE_RMSt: f.prediction.e_RMSt, generatedVariables: a.generatedVariables, changedFromFull: a.prediction.e_RMSt !== f.prediction.e_RMSt || JSON.stringify(a.generatedVariables) !== JSON.stringify(f.generatedVariables) }; });

// ------------------------------------------------------------------ fairness (mandatory, §17)
const predictive = baseline.filter((b) => typeof b.prediction === 'object').map((b) => ({ id: b.id, v: (b.prediction as { e_RMSt: number }).e_RMSt }));
const bestConv = predictive.reduce((a, b) => (b.v < a.v ? b : a));
const bestZ = [ziranResults, ...variants.slice(1).map((v) => zRes(Z[v]))].map((z) => ({ id: z.id, v: z.prediction.e_RMSt as number })).reduce((a, b) => (b.v < a.v ? b : a));
const extensions = ['M3-NARX', 'M5-twin', 'M6-MLP', 'M7-PWARX'].map((id) => predictive.find((p) => p.id === id)!).filter(Boolean);
const fairness = {
  rule: 'if a Ziran / Xeno variant improves over the best conventional model on one-step prediction, conventional extensions are compared on the same metric',
  bestConventionalOneStep: bestConv, bestZiranOneStep: bestZ,
  ziranImproves: bestZ.v < bestConv.v,
  extensionsAtLeastAsGood: bestZ.v < bestConv.v ? extensions.filter((e) => e.v <= bestZ.v) : 'not triggered',
  verdict: bestZ.v < bestConv.v ? (extensions.some((e) => e.v <= bestZ.v) ? 'a conventional extension matches or exceeds the Ziran variant: not uniquely required' : 'no tested conventional extension matched the Ziran variant on this metric') : 'not triggered: no Ziran variant improved over the best conventional one-step model',
};

// ------------------------------------------------------------------ Q3 and Q5 (empirical observations)
const pairs: [number, number][] = []; let near = 0;
for (let a = 0; a < N - 1; a++) for (let b = a + 1; b < N - 1; b++) if (Math.abs(d.yEst[a] - d.yEst[b]) <= 0.05 && Math.abs(d.uEst[a] - d.uEst[b]) <= 0.05) { near++; const da = d.yEst[a + 1] - d.yEst[a], db = d.yEst[b + 1] - d.yEst[b]; if (Math.abs(da - db) > 0.3) pairs.push([a, b]); }
const du = d.uEst.slice(1).map((v, i) => v - d.uEst[i]), dy = d.yEst.slice(1).map((v, i) => v - d.yEst[i]);
const xc = Array.from({ length: 31 }, (_, k) => { const n = du.length - k; const a = du.slice(0, n), b = dy.slice(k, k + n); const ma = mean(a), mb = mean(b); const sa = Math.sqrt(mean(a.map((x) => (x - ma) ** 2))), sb = Math.sqrt(mean(b.map((x) => (x - mb) ** 2))); return mean(a.map((x, i) => (x - ma) * (b[i] - mb))) / (sa * sb); });
const bestLag = xc.reduce((bi, v, i) => (v > xc[bi] ? i : bi), 0);
const questions = {
  Q1: 'see baseline-results.json and ziran-results.json (e_RMSt per model and mode)',
  Q2: { band: `y_test ≥ ${BAND} V`, samplesInBand: hi.length, samplesBelow: lo.length },
  Q3: { claimStatus: 'empirical observation', nearIdenticalPairs_estimation: near, withDivergentNextStep_gt_0_3V: pairs.length, examples: pairs.slice(0, 5).map(([a, b]) => ({ a: a + 1, b: b + 1, y: [round(d.yEst[a], 3), round(d.yEst[b], 3)], u: [round(d.uEst[a], 3), round(d.uEst[b], 3)], nextChange: [round(d.yEst[a + 1] - d.yEst[a], 3), round(d.yEst[b + 1] - d.yEst[b], 3)] })), perModelInsufficiencySignals: Object.fromEntries([...baseline.map((b) => [b.id, `residual lag-1 autocorrelation ${b.residualLag1Autocorr_estimation} (${b.insufficiencySignal ? 'signal' : 'no signal'})`]), ['M5-twin NIS', `mean NIS on estimation ${round(m5.nisEst, 2)} (≈ 1 expected when consistent)`], ['Ziran aliasing records (v0.3.0 key, 1e-3 quantization)', String(ziranResults.aliasingRecords_v030Key)]]) },
  Q4: { generatedByFull: ziranResults.generatedVariables, fullVsFixedObservations: { full: ziranResults.prediction.e_RMSt, fixedObservations: zRes(Z['Z-fixed-observations']).prediction.e_RMSt } },
  Q5: { claimStatus: 'empirical observation', lagOfMaxCrossCorrelation_samples: bestLag, lagSeconds: bestLag * 4, maxCorrelation: round(xc[bestLag], 3), crossCorrelation_0_to_10: xc.slice(0, 11).map((x) => round(x, 3)), tooLateAnalysis: 'not applicable: the dataset contains no recorded corrections' },
};

// ------------------------------------------------------------------ counterfactual (unvalidated)
const u12 = d.uTest.map((v) => v * 1.2);
const cf = [m1, m4b, m5].map((m) => { const s = m.simulate!(u12, d.yTest); return { model: m.id, maxPredicted: round(Math.max(...s), 3), fractionAbove9V: round(s.filter((v) => v >= 9).length / s.length, 3) }; });
const counterfactual = { input: 'test input × 1.2', claimStatus: 'unvalidated model output — no recorded outcome exists for this input', results: cf, measuredTestFractionAbove9V: round(hi.length / N, 3) };

// ------------------------------------------------------------------ write
const protocolCommit = git(['log', '-1', '--format=%H', '--', 'results/external-comparison/cascaded-tanks/protocol.json']);
const resource = [...baseline.map((b) => ({ id: b.id, ...b.cost })), ...variants.map((v) => ({ id: v, fitMs: round(Z[v].fitMs, 1), inferenceMs: null, trainableParameters: Z[v].params, observationsUsed: N, adaptationSteps: 'morphogenesis 3 rounds' }))];
const summary = {
  protocol: 'CT-P1', protocolFreezeCommit: protocolCommit, dataset: 'Cascaded Tanks, DOI 10.4121/12960104.v1', claimStatus: 'replayed empirical result',
  simulationE_RMSt: Object.fromEntries(baseline.filter((b) => typeof b.simulation === 'object').map((b) => [b.id, (b.simulation as { e_RMSt: unknown }).e_RMSt])),
  predictionE_RMSt: Object.fromEntries([...predictive.map((p) => [p.id, p.v]), ...variants.map((v) => [v, zRes(Z[v]).prediction.e_RMSt])]),
  fairnessVerdict: fairness.verdict, ablationsWithoutChange: ablations.filter((a) => !a.changedFromFull).map((a) => a.ablation),
  note: 'no global ranking; per-mode, per-metric values only',
};
const W = (f: string, x: unknown) => writeFileSync(out(R + f), JSON.stringify(x, null, 2) + '\n');
W('baseline-results.json', baseline); W('ziran-results.json', ziranResults); W('ablations.json', ablations); W('fairness-checks.json', fairness); W('resource-costs.json', resource); W('questions.json', questions); W('counterfactual.json', counterfactual); W('result-summary.json', summary);

// ------------------------------------------------------------------ generated report
const fmt = (x: unknown) => (x === null || x === undefined ? 'n/a' : typeof x === 'object' ? JSON.stringify(x) : String(x));
const M: string[] = ['# Cascaded Tanks — results (generated)', '', `Generated by \`node comparison/empirical/run-cascaded-tanks.ts\`. Protocol **CT-P1**, frozen in commit \`${protocolCommit}\` before any model was fitted. Dataset: Cascaded Tanks benchmark, 4TU.ResearchData, DOI 10.4121/12960104.v1 (CC BY-SA 4.0). Claim status of all replay metrics: **replayed empirical result**. No framework is ranked. Limitations: [cascaded-tanks-limitations.md](cascaded-tanks-limitations.md).`, '',
  '## Q1 — replay fidelity (test record, volts)', '', '| model | family | simulation e_RMSt | prediction e_RMSt | sim RMSE excl. init | sim fit % | pred fit % | params | fit ms |', '|---|---|---|---|---|---|---|---|---|'];
for (const b of baseline) { const s = b.simulation as Record<string, unknown>, p = b.prediction as Record<string, unknown>; M.push(`| ${b.id} | ${b.family} | ${fmt(s?.e_RMSt ?? s)} | ${fmt(p?.e_RMSt ?? p)} | ${fmt(s?.rmseExclInit)} | ${fmt(s?.fitPct)} | ${fmt(p?.fitPct)} | ${b.cost.trainableParameters} | ${b.cost.fitMs} |`); }
for (const v of variants) { const z = zRes(Z[v]); M.push(`| ${v} | Ziran / Xeno adapter | not evaluable | ${z.prediction.e_RMSt} | — | — | ${z.prediction.fitPct} | ${z.cost.trainableParameters} | ${z.cost.fitMs} |`); }
M.push('', 'Simulation seeds input–output models with their first L measured outputs (counted in e_RMSt). M2, M4a, M4b use initial states estimated on the estimation record. The Ziran adapter predicts ŷ(t) from u(t−1), y(t−1) and its generated variables; ARX-type models with nk = 0 also use u(t).', '',
  '## Q2 — regime bands (RMSE, V)', '', `Band: measured test output ≥ ${BAND} V (${hi.length} samples) vs below (${lo.length} samples).`, '', '| model | sim ≥ 9 V | sim < 9 V | pred ≥ 9 V | pred < 9 V |', '|---|---|---|---|---|');
for (const b of baseline) { const s = b.simulation as Record<string, unknown>, p = b.prediction as Record<string, unknown>; M.push(`| ${b.id} | ${fmt(s?.rmse_band_y_ge_9)} | ${fmt(s?.rmse_band_y_lt_9)} | ${fmt(p?.rmse_band_y_ge_9)} | ${fmt(p?.rmse_band_y_lt_9)} |`); }
for (const v of variants) { const z = zRes(Z[v]); M.push(`| ${v} | — | — | ${z.prediction.rmse_band_y_ge_9} | ${z.prediction.rmse_band_y_lt_9} |`); }
M.push('', '## Q3 — observation adequacy', '', `Empirical observation: ${near} pairs of estimation samples with |Δy| ≤ 0.05 V and |Δu| ≤ 0.05 V; ${pairs.length} of them have next-step output changes differing by more than 0.3 V.`, '', ...Object.entries(questions.Q3.perModelInsufficiencySignals).map(([k, v]) => `- ${k}: ${v}`), '',
  '## Q4 — description revision (Ziran / Xeno)', '', `Generated variables (full adapter): ${ziranResults.generatedVariables.join(', ') || 'none'}; retained grammar changes: ${ziranResults.retainedGrammarChanges}; representation changed: ${ziranResults.representationChanged}. Replay round trip: ${ziranResults.replayRoundTrip}.`, '', '| ablation | prediction e_RMSt | full adapter | generated variables | changed |', '|---|---|---|---|---|', ...ablations.map((a) => `| ${a.ablation} | ${a.predE_RMSt} | ${a.fullPredE_RMSt} | ${a.generatedVariables.join(', ') || 'none'} | ${a.changedFromFull ? 'yes' : 'no'} |`), '',
  '## Fairness check (mandatory)', '', `Best conventional one-step model: ${bestConv.id} (${bestConv.v}); best Ziran variant: ${bestZ.id} (${bestZ.v}). Verdict: ${fairness.verdict}.`, '',
  '## Q5 — timing', '', `Empirical observation: cross-correlation between Δu and Δy on the estimation record peaks at lag ${bestLag} samples (${bestLag * 4} s, r = ${round(xc[bestLag], 3)}). Too-late-correction analysis is not applicable: no corrections are recorded.`, '',
  '## Counterfactual (unvalidated)', '', 'Test input × 1.2, simulated. These are model outputs without a recorded outcome and are not empirical findings.', '', ...cf.map((c) => `- ${c.model}: max ${c.maxPredicted} V, fraction ≥ 9 V ${c.fractionAbove9V} (measured test record at the original input: ${counterfactual.measuredTestFractionAbove9V})`), '',
  '## Statements', '');
const simOf = (id: string) => (baseline.find((b) => b.id === id)!.simulation as { e_RMSt: number }).e_RMSt;
M.push(`- On the Cascaded Tanks replay task under protocol CT-P1, the Ziran / Xeno adapter's generated variables ${ablations.find((a) => a.ablation === 'Z-fixed-observations')!.predE_RMSt === ziranResults.prediction.e_RMSt ? 'did not change' : 'changed'} held-out one-step error relative to the same readout without generated variables (${ziranResults.prediction.e_RMSt} vs ${ablations.find((a) => a.ablation === 'Z-fixed-observations')!.predE_RMSt} V).`);
M.push(`- On the Cascaded Tanks replay task under protocol CT-P1, ${fairness.verdict}.`);
M.push(`- On the Cascaded Tanks replay task under protocol CT-P1, the grey-box model with the documented overflow (M4b) had simulation e_RMSt ${simOf('M4b-grey-box-overflow')} V against ${simOf('M4a-grey-box')} V without it.`);
M.push('', `Per-seed MLP results, full per-model details and compute: \`${R}\`.`, '');
writeFileSync(out('docs/cascaded-tanks-results.md'), M.join('\n'));
console.log(JSON.stringify(summary, null, 2));
