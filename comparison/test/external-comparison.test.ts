// Tests for the External Framework Comparison (research branch). Run: node --test comparison/test/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { runExternalComparison, forbiddenFieldsIn, EC_DEFINITIONS } from '../bench.ts';
import { runWorld1 } from '../worlds/w1-aliasing.ts';
import { CASCADED_TANKS, validateProvenance, claimFor } from '../empirical/provenance.ts';

const R = runExternalComparison();
const all = R.worlds.flatMap((w) => w.records);
const root = new URL('../../', import.meta.url);

test('every record fills the common schema and carries a claim status', () => {
  const keys = ['representationSupplied', 'representationGenerated', 'observationsSupplied', 'observationsRevised', 'interventions', 'detectedDifferences', 'inaccessibleDifferences', 'branchChanges', 'timing', 'failures', 'resourceUse', 'reorganization', 'modelRevisions', 'descriptionRevisions', 'burden', 'cost', 'conversions', 'profile', 'claimStatus'];
  for (const r of all) { for (const k of keys) assert.ok(k in r, `${r.configuration}: ${k}`); assert.equal(r.claimStatus, 'synthetic-world result'); assert.ok(r.representationSupplied.length > 0, r.configuration); }
});

test('no global score, rank or winner anywhere in the results', () => {
  assert.deepEqual(forbiddenFieldsIn(R), []);
});

test('each world states matched conditions with sameness levels and at least one fairness check', () => {
  for (const w of R.worlds) {
    const m = w.matched; for (const k of ['inputData', 'initialConditions', 'interventionHistory', 'temporalHorizon', 'computationalBudget', 'observationAvailability', 'measurementResolution', 'resourceConstraints', 'evaluationWindow'] as const) assert.ok(m[k], `${w.world}: ${k}`);
    assert.ok(m.sameness.length > 0 && m.sameness.every((s) => typeof s.sameRawSource === 'boolean' && s.transformation.length > 0));
    assert.ok(w.fairness.length > 0, w.world);
    assert.ok(w.records.some((r) => r.framework === 'ziran-xeno' && r.role === 'primary'));
  }
});

test('statements use the default §28 wording; no "cannot do X" claims about frameworks', () => {
  for (const w of R.worlds) for (const s of w.statements) assert.match(s, /^under configuration .+ and implementation .+, distinction ".+" (was retained|was not retained|was not evaluable)/);
  const text = JSON.stringify(R.negativeResults) + JSON.stringify(R.worlds.map((w) => w.statements));
  assert.doesNotMatch(text, /(existing|other) frameworks? cannot/i);
  assert.doesNotMatch(text, /best framework|overall winner/i);
});

test('comparison worlds cover the required frameworks, with reasons where not applicable', () => {
  const fams = new Set(all.map((r) => r.framework));
  for (const f of ['agent-based-modeling', 'control-mpc', 'reinforcement-learning', 'active-inference', 'digital-twin', 'dynamical-systems', 'viability-reachability', 'ziran-xeno']) assert.ok(fams.has(f as never), f);
  for (const w of R.worlds) for (const n of w.notApplicable) assert.ok(n.reason.length > 10);
});

test('Ziran / Xeno ablations run for every required mechanism, and unchanged results are reported as such', () => {
  const mech = R.ablations.map((a) => a.mechanism).join(' | ');
  for (const m of ['observation revision', 'multiple clocks', 'fragility transfer analysis', 'MetaConfiguration', 'description-space revision', 'open operational values']) assert.match(mech, new RegExp(m));
  for (const a of R.ablations.filter((x) => !x.changed)) assert.ok(R.negativeResults.some((n) => n.includes(`removing ${a.mechanism}`)));
});

test('negative and null results are published, including baselines matching the Ziran adapter', () => {
  assert.ok(R.negativeResults.length >= 5);
  assert.ok(R.negativeResults.some((n) => /matches the Ziran adapter|outperforms the Ziran adapter/.test(n)));
});

test('External Framework Comparison Benchmarks are defined separately from the v0.3.0 suites', () => {
  assert.equal(EC_DEFINITIONS.length, 6);
  for (const d of EC_DEFINITIONS) assert.ok(d.wouldCountAsFailure.length > 10 && d.predicate.length > 5);
  const v03 = readFileSync(new URL('docs/benchmark-results.md', root), 'utf8');
  assert.doesNotMatch(v03, /External Framework Comparison/);
  for (const f of ['src/bench/layers.ts', 'src/bench/theory.ts', 'src/bench/meta.ts']) assert.doesNotMatch(readFileSync(new URL(f, root), 'utf8'), /comparison\//);
});

test('the frozen v0.3.0 source tree is unchanged on this branch', (t) => {
  try { execFileSync('git', ['rev-parse', 'v0.3.0'], { cwd: root, stdio: 'ignore' }); } catch { t.skip('no git tag v0.3.0 available'); return; }
  const diff = execFileSync('git', ['diff', '--name-only', 'v0.3.0', '--', 'src', 'public', 'bin'], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(diff, '', `changed under src/public/bin: ${diff}`);
});

test('runs are deterministic apart from wall time', () => {
  const strip = (x: unknown) => JSON.stringify(x, (k, v) => (k === 'computeMs' ? undefined : v));
  assert.equal(strip(runWorld1([1, 2])), strip(runWorld1([1, 2])));
});

test('empirical candidate carries the full provenance record and a bounded claim status', () => {
  assert.deepEqual(validateProvenance(CASCADED_TANKS), []);
  assert.equal(CASCADED_TANKS.claimStatusIfUsed, 'replayed empirical result');
  assert.equal(claimFor(1), 'replayed empirical result');
  assert.ok(CASCADED_TANKS.selectionRisks.length > 0 && CASCADED_TANKS.selectionRationale.length > 0);
  assert.ok(existsSync(new URL('comparison/empirical/provenance.ts', root)));
});
