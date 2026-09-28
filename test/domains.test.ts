import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensurePresets, listPresets } from '../src/presets/index.ts';
import { runExperiment, rerun } from '../src/core/experiment.ts';
import { validateTrace } from '../src/core/trace.ts';
import { runSpec } from '../src/core/counterfactual.ts';
import { bodySpec, XENO14 } from '../src/domains/body.ts';
import { assertNoCertainty, reconstructionStatement, RECONSTRUCTIONS } from '../src/domains/thought.ts';
import { marketSpec, compareParticipants, PARTICIPANTS } from '../src/domains/market.ts';

ensurePresets();

test('every preset runs, validates, and reruns exactly', () => {
  const ps = listPresets();
  assert.ok(ps.length >= 24);
  for (const p of ps) {
    const x = { preset: p.id, horizon: Math.min(Number(p.defaults.horizon ?? 100), 120) };
    const tr = runExperiment(x);
    assert.deepEqual(validateTrace(tr), [], p.id);
    assert.ok(tr.events.length > 0, p.id);
    assert.equal(rerun(x, tr).equal, true, p.id + ' exact rerun');
  }
});

test('all 14 Xeno-14 bundles are optional and can ignite together', () => {
  assert.equal(XENO14.length, 14);
  for (const o of XENO14) assert.deepEqual(validateTrace(runSpec(bodySpec({ organizations: [o], horizon: 60 }))), [], o);
  const all = runSpec(bodySpec({ organizations: [...XENO14], horizon: 60 }));
  const bundlesIgnited = new Set(all.events.filter((e) => e.kind === 'ignition').map((e) => e.rule.split('.')[0]));
  assert.ok(XENO14.filter((b) => bundlesIgnited.has(b)).length >= 10);
});

test('historical reconstructions separate evidence, configuration, model, inference and uncertainty; no certainty claims', () => {
  for (const r of Object.values(RECONSTRUCTIONS)) {
    assert.ok(r.sources.length && r.historicalConfiguration.length && r.model.length && r.inferenceRules.length && r.uncertainty.notes.length, r.id);
  }
  assert.throws(() => assertNoCertainty('Aristotle would definitely sell here.'));
  assert.throws(() => assertNoCertainty('Spinoza believes the market is rational.'));
  assert.match(reconstructionStatement(RECONSTRUCTIONS.aristotle, 'C', 'P', 'T'), /^Under reconstruction R-aristotle/);
});

test('market comparison reports operational differences, not only wealth', () => {
  const tr = runSpec(marketSpec({ horizon: 200, participants: [...PARTICIPANTS] }));
  const c = compareParticipants(tr);
  assert.equal(c.length, 5);
  for (const x of c) {
    assert.ok('detects' in x && 'unavailable' in x && 'timing' in x && 'feedback' in x && 'penetration' in x && 'goalTransformations' in x, x.participant);
    assert.ok(!Object.keys(x.unavailable['mkt/fundamental']).includes('detected'), 'hidden fundamental is never detected directly');
  }
});
