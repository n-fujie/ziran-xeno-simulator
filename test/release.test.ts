// Release anti-regression: claim labels, release statements and restrained language stay in place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { claim, promote } from '../src/meta/claims.ts';
import { reconstructionClaim, RECONSTRUCTIONS } from '../src/domains/thought.ts';
import { ENGINE_VERSION } from '../src/core/engine.ts';
import { runBenchmark } from '../src/bench/layers.ts';
import { listMeta } from '../src/bench/meta.ts';
import { listTheory } from '../src/bench/theory.ts';
import { replaySpec } from '../src/external/adapter.ts';
import { runSpec } from '../src/core/counterfactual.ts';
import { ensurePresets } from '../src/presets/index.ts';

const root = new URL('../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');

test('release documents exist; package version 0.4.0; core engine version unchanged at 0.3.0', () => {
  for (const f of ['README.md', 'DESIGN.md', 'LIMITATIONS.md', 'BENCHMARKS.md', 'REPRODUCIBILITY.md', 'CHANGELOG.md', 'CITATION.cff', 'LICENSE', 'docs/claims.md', 'docs/negative-results.md']) assert.ok(existsSync(new URL(f, root)), f);
  assert.equal(JSON.parse(read('package.json')).version, '0.4.0');
  assert.equal(ENGINE_VERSION, '0.3.0'); // the core engine is unchanged in v0.4.0
  assert.match(read('CITATION.cff'), /version: "0\.4\.0"/);
  assert.doesNotMatch(read('CITATION.cff'), /^doi:/m);
  const REPO = 'https://github.com/n-fujie/ziran-xeno-simulator';
  assert.match(read('CITATION.cff'), /family-names: "Fujie"/);
  assert.match(read('LICENSE'), /Copyright \(c\) 2026 Naoto Fujie/);
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.author, 'Naoto Fujie'); assert.equal(pkg.license, 'MIT'); assert.ok(pkg.repository.url.includes(REPO));
  for (const f of ['CITATION.cff', 'README.md', 'SECURITY.md', 'CHANGELOG.md']) assert.ok(read(f).includes(REPO), f);
  for (const f of ['README.md', 'DESIGN.md', 'LIMITATIONS.md', 'BENCHMARKS.md', 'REPRODUCIBILITY.md', 'CHANGELOG.md', 'CITATION.cff', 'LICENSE', 'SECURITY.md', 'CONTRIBUTING.md', 'package.json'])
    assert.doesNotMatch(read(f), /AUTHOR NAME|PLACEHOLDER|to be confirmed|example\.org|TODO/, f);
});

test('README and DESIGN state the A/B/C/D and stopping-principle commitments', () => {
  for (const f of ['README.md', 'DESIGN.md']) {
    const s = read(f).replace(/\s+/g, ' ');
    assert.match(s, /A\/B\/C\/D are not ontological strata/, f);
    assert.match(s, /revisable analytical distinctions used to localize different forms of operational change/, f);
    assert.match(s, /A fixed condition is not automatically a theoretical defect/, f);
  }
  assert.match(read('LIMITATIONS.md'), /does not remove presuppositions; it exposes and partially revises some of them/);
});

test('overclaiming phrases appear only in negated form in public documents', () => {
  const bad = /unrestricted emergence|unlimited emergence|presupposition-free|ontology-free|natural category emerged|discovered gravity|Aristotle (predicts|chooses|would)|historical-person simulat|category-free/i;
  const neg = /\b(not|no|never|does not|must not|instead of|without)\b|“|"/i;
  for (const f of ['README.md', 'DESIGN.md', 'LIMITATIONS.md', 'BENCHMARKS.md', 'CHANGELOG.md', 'docs/claims.md', 'docs/negative-results.md', 'public/index.html']) {
    const lines = read(f).split('\n');
    // A matching line passes if it is itself negated, or sits in a list introduced by a negated heading / lead-in line.
    let context = '';
    lines.forEach((l, i) => {
      if (/^#/.test(l) || /:\s*$/.test(l)) context = l;
      if (bad.test(l)) assert.ok(neg.test(l) || /\bnot\b/i.test(context), `${f}:${i + 1}: ${l}`);
    });
  }
});

test('every result family carries a claim status', () => {
  ensurePresets();
  const L = runBenchmark([0]);
  assert.ok(L.every((l) => l.checks.every((c) => c.claimStatus === 'implementation property')));
  const rc = reconstructionClaim(RECONSTRUCTIONS.aristotle, 'C', 'P', 'T');
  assert.equal(rc.claimStatus, 'reconstruction inference');
  assert.equal(rc.historicalFactualClaim, false);
  assert.ok(rc.sources.length > 0 && rc.inferenceAssumptions.length > 0 && rc.uncertainty);
  assert.ok(listMeta().every((m) => m.definition && m.definition.counterEvidence && m.definition.stabilityPredicate));
  assert.ok(listTheory().every((d: any) => d.successPredicate && d.counterEvidence));
  assert.throws(() => promote(claim('synthetic result', 'synthetic-world result'), 'empirically supported generalization'));
  const tr = runSpec(replaySpec({ source: 'test', domain: 'physical-experiment', samplingRegime: 'regular', missingness: 'one gap', apparatus: 'test rig', timebase: 's', uncertainty: '±0.1', provenance: 'generated in test', preprocessing: 'none', evidence: 'replayed-empirical', channels: [{ id: 'a', samples: [[0, 1], [1, null], [2, 3]] }] }));
  assert.equal(tr.meta.claimStatus, 'replayed empirical result');
});
