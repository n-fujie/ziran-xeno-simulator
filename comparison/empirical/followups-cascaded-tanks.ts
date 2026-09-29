// Exploratory follow-ups to protocol CT-P1 (§19). These do NOT replace the pre-registered results in
// results/external-comparison/cascaded-tanks/*.json; they are written to exploratory-followups.json.
// Usage: node comparison/empirical/followups-cascaded-tanks.ts
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { load, MODELS, ziran, ekfPredict, rmse, FIT } from './cascaded-tanks.ts';
import { round } from '../frameworks/lib.ts';

const out = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const d = load();
const pre = JSON.parse(readFileSync(out('results/external-comparison/cascaded-tanks/result-summary.json'), 'utf8'));

// determinism check of the pre-registered models (no files overwritten)
const m4b = MODELS.M4(d, true), m1 = MODELS.M1(d);
const reproduced = { 'M1-ARX sim': round(rmse(d.yTest, m1.simulate!(d.uTest, d.yTest))!, 4), 'M4b sim': round(rmse(d.yTest, m4b.simulate!(d.uTest, d.yTest))!, 4), 'Z-full pred': round(rmse(d.yTest, ziran(d, 'Z-full').predict)!, 4) };
const determinism = { reproduced, preRegistered: { 'M1-ARX sim': pre.simulationE_RMSt['M1-ARX'], 'M4b sim': pre.simulationE_RMSt['M4b-grey-box-overflow'], 'Z-full pred': pre.predictionE_RMSt['Z-full'] } };

// F1 — twin: extended EKF noise grid (the pre-registered grid selected q = 0.1, its upper boundary; mean NIS 0.12)
let best = { v: Infinity, q: 0, r: 0 };
for (const q of [1e-2, 1e-1, 1, 10, 100]) for (const r of [1e-5, 1e-4, 1e-3, 1e-2]) { const v = rmse(d.yEst.slice(FIT), ekfPredict(m4b.gb, d.uEst, d.yEst, q, r).pred.slice(FIT)) ?? Infinity; if (v < best.v) best = { v, q, r }; }
const f1Test = round(rmse(d.yTest, ekfPredict(m4b.gb, d.uTest, d.yTest, best.q, best.r).pred)!, 4);

// F2 — Ziran adapter readout with the current input u(t) (removes the information asymmetry against nk = 0 models)
const f2 = Object.fromEntries((['Z-full', 'Z-fixed-observations', 'Z-no-grammar-revision'] as const).map((v) => [v, round(rmse(d.yTest, ziran(d, v, { includeCurrentInput: true }).predict)!, 4)]));

const followups = {
  status: 'exploratory follow-up — not part of the pre-registered comparison; pre-registered results unchanged',
  determinism,
  F1_twin_extended_noise_grid: { oldModel: 'M5 with q ∈ {1e-4…1e-1}, r ∈ {1e-4…1e-2}', observedProblem: 'selected q at the grid boundary; mean NIS on estimation 0.12', change: 'q ∈ {1e-2…100}, r ∈ {1e-5…1e-2}, selected on the same validation rows', benefits: 'the twin only', evaluationRestarted: false, selected: { q: best.q, r: best.r, validationPredRMSE: round(best.v, 4) }, testPredE_RMSt: f1Test, preRegisteredTestPredE_RMSt: pre.predictionE_RMSt['M5-twin'] },
  F2_ziran_readout_with_current_input: { oldModel: 'readout on u(t−1), y(t−1), generated(t−1)', observedProblem: 'the adapter uses less information than ARX-type models with nk = 0', change: 'add u(t) to the readout', benefits: 'the Ziran adapter only', evaluationRestarted: false, testPredE_RMSt: f2, preRegistered: { 'Z-full': pre.predictionE_RMSt['Z-full'], 'Z-fixed-observations': pre.predictionE_RMSt['Z-fixed-observations'], 'Z-no-grammar-revision': pre.predictionE_RMSt['Z-no-grammar-revision'] }, conventionalForReference: { 'M1-ARX': pre.predictionE_RMSt['M1-ARX'], 'M7-PWARX': pre.predictionE_RMSt['M7-PWARX'] } },
  claimStatus: 'replayed empirical result (exploratory)',
};
writeFileSync(out('results/external-comparison/cascaded-tanks/exploratory-followups.json'), JSON.stringify(followups, null, 2) + '\n');
console.log(JSON.stringify(followups, null, 2));
