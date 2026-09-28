// Implementation Conformance Benchmarks.
// These test whether the implementation behaves according to the specification. They are NOT theory
// validation: each check runs presets written by the same authors and verifies the expected mechanism.
// Competing model classes and ablations live in theory.ts (Theory-Discriminating Benchmarks).
// Only after the lower layers work should higher layers be trusted: a passing check above a failing layer
// is reported as 'untrusted', not 'pass'.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorldSpec } from '../core/types.ts';
import { runSpec, runLight, nonRedundancy } from '../core/counterfactual.ts';
import { validateTrace, type Trace } from '../core/trace.ts';
import { applyPerturbations } from '../core/perturbations.ts';
import { penetration } from '../core/penetration.ts';
import { tiiRecords } from '../core/tii.ts';
import { corrections, correctionSummary } from '../analysis/timing.ts';
import { fragilityTransfer } from '../analysis/fragility.ts';
import { optimize } from '../analysis/optimize.ts';
import { interplay, pathAndResources } from '../analysis/interplay.ts';
import { vocabularyProfile } from '../analysis/vocabulary.ts';
import { relationSpread, addressing, novelDimension } from '../domains/open.ts';
import { runtimeKindWorld, causalFacetWorld } from '../domains/meta-worlds.ts';
import { listTheory } from './theory.ts';
import { diffTraces } from '../core/counterfactual.ts';
import { sensorBudget } from '../domains/foundations.ts';
import { operationalSampler, hiddenPhase, branchClosure, tooLate, sharedLoad, SHARED_LOAD_REGIONS } from '../domains/foundations.ts';
import { MEDIA, xenoCoordination, nonreciprocalChain, bistableRamp, hysteresis, chaoticLattice, divergence } from '../domains/physical.ts';
import { bodySpec, XENO14, BODY_REGIONS } from '../domains/body.ts';
import { hiddenAttraction, discoverFromTrace, replacementPersistence, persistenceAcrossReplacement, stepResponse, categoryRetention } from '../domains/science.ts';
import { lawPenetration, scoreEcology } from '../domains/institution.ts';
import { marketSpec, marketPreset, compareParticipants, traderCategoryTest } from '../domains/market.ts';
import { reignition, reasonVocabulary, assertNoCertainty, reconstructionStatement, reconstructionClaim, RECONSTRUCTIONS } from '../domains/thought.ts';
import { aiPipeline, separationReport } from '../domains/ai.ts';
import { distributedTask, humanNecessity } from '../domains/hybrid.ts';
import { cicgi, cicgiIntervals, capitalCategoryTest, heatCropPolicy } from '../domains/civilization.ts';

export interface CheckResult { id: string; claim: string; pass: boolean; evidence: unknown; ms: number; error?: string; claimStatus: 'implementation property' }
export interface LayerResult { layer: number; title: string; status: 'pass' | 'fail' | 'untrusted'; checks: (CheckResult & { status: 'pass' | 'fail' | 'untrusted' })[] }

interface Check { id: string; claim: string; run: () => { pass: boolean; evidence: unknown } }
interface Layer { layer: number; title: string; checks: Check[] }

const build = (p: { build: (x: Record<string, unknown>) => WorldSpec; defaults: Record<string, unknown> }, over: Record<string, unknown> = {}) => p.build({ ...p.defaults, ...over });
const memo = new Map<string, Trace>();
const run = (key: string, spec: () => WorldSpec) => { if (!memo.has(key)) memo.set(key, runSpec(spec())); return memo.get(key)!; };

const here = dirname(fileURLToPath(import.meta.url));

const LAYERS: Layer[] = [
  { layer: 0, title: 'Anti-regression (core ontology stays thin)', checks: [
    { id: 'core-vocabulary', claim: 'The core defines no thick categories (human, agent, belief, goal, capability, market, organism, …) as types or fields.', run: () => {
      const dir = join(here, '..', 'core'); const bad: string[] = [];
      const words = /\b(human|agent|belief|goal|capabilit|responsibilit|market|organism|neuron|trader|person|reason)\w*/i;
      for (const f of readdirSync(dir)) {
        const src = readFileSync(join(dir, f), 'utf8').split('\n');
        src.forEach((line, i) => { const code = line.replace(/\/\/.*$/, '').replace(/'[^']*'/g, "''").replace(/`[^`]*`/g, '``'); if (/^\s*\*|^\s*\/\*/.test(line)) return; if (words.test(code)) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 80)}`); });
      }
      return { pass: bad.length === 0, evidence: bad.length ? bad : 'no thick category identifiers in src/core' };
    } },
    { id: 'open-values-not-collapsed', claim: 'Relation, event and opaque values are stored and traced as such — never converted to numeric placeholders.', run: () => {
      const tr = runSpec(build(relationSpread)); const kinds = new Set(tr.events.filter((e) => e.kind === 'effect').map((e) => e.valueKind ?? 'scalar'));
      const v = validateTrace(tr);
      return { pass: kinds.has('relation') && kinds.has('event') && kinds.has('opaque') && v.length === 0 && typeof tr.final.state['net/edges'] === 'object', evidence: { valueKinds: [...kinds], storage: tr.summary.valueKinds, violations: v } };
    } },
    { id: 'runtime-value-kind', claim: 'A value kind registered at runtime (Level D) is compared, serialized, rendered and penetrates along a coupling without core edits; built-in kinds are not a closed ontology.', run: () => {
      const tr = runSpec(build(runtimeKindWorld));
      const eff = tr.events.filter((e) => e.kind === 'effect' && e.valueKind === 'interval');
      const meta = tr.metaLineage.find((m) => m.registry === 'value-kind' && m.id === 'interval');
      return { pass: !!meta && eff.some((e) => e.address === 'report/band') && eff.every((e) => typeof e.rendered === 'string' && e.after?.interval) && validateTrace(tr).length === 0, evidence: { meta, effects: eff.slice(0, 3).map((e) => `${e.address} ${e.rendered} via ${e.via}`), levels: tr.summary.levels } };
    } },
    { id: 'meta-configuration-inspectable', claim: 'The meta-configuration in force (value kinds, facets, transition-class constructors, trace schema) is recorded with origins in every trace.', run: () => {
      const tr = runSpec(build(causalFacetWorld, { registerAtRuntime: false })); const regs = new Set(tr.initial.meta.map((m) => m.registry));
      return { pass: ['value-kind', 'description-facet', 'transition-class', 'trace-schema'].every((r) => regs.has(r)) && tr.initial.meta.some((m) => m.id === 'causal-order' && m.origin === 'domain-registered'), evidence: [...regs] };
    } },
    { id: 'benchmark-predicates-exposed', claim: 'Every theory benchmark exposes model classes, predicate, uncertainty and what would count against it.', run: () => {
      const L = listTheory() as any[]; const missing = L.filter((d) => !d.successPredicate || !d.counterEvidence || !d.modelClasses?.length).map((d) => d.id);
      return { pass: L.length >= 14 && !missing.length, evidence: { benchmarks: L.length, missing } };
    } },
    { id: 'no-absence-status', claim: 'The epistemic status type contains no "absent".', run: () => {
      const src = readFileSync(join(here, '..', 'core', 'types.ts'), 'utf8');
      const m = src.match(/export type EpistemicStatus =([\s\S]*?);/);
      return { pass: !!m && !/absent/.test(m[1]), evidence: m?.[1].replace(/\s+/g, ' ').trim() };
    } },
  ] },
  { layer: 1, title: 'Minimal operational dynamics', checks: [
    { id: 'trace-valid', claim: 'Trace validates: every effect is an actual difference, no absence claims, replay reproduces the final state.', run: () => { const tr = run('sampler', () => build(operationalSampler)); const v = validateTrace(tr); return { pass: v.length === 0, evidence: v.length ? v : tr.summary.counts }; } },
    { id: 'causal-chain', claim: 'Real effects descend from operations, operations from ignitions, and ignitions from earlier differences.', run: () => {
      const tr = run('sampler', () => build(operationalSampler)); const ev = tr.events;
      const eff = ev.find((e) => e.kind === 'effect' && e.address === 'd')!; const op = ev[eff.cause[0]]; const ign = ev[op.cause[0]];
      return { pass: op.kind === 'operation' && ign.kind === 'ignition' && ign.cause.length > 0, evidence: { effect: eff.seq, operation: op.seq, ignition: ign.seq, ignitionCause: ign.cause.map((s: number) => ev[s].kind + ':' + (ev[s].address ?? ev[s].channel)) } };
    } },
    { id: 'delayed-activation', claim: 'An operation computed at ignition lands after its delay.', run: () => { const tr = run('sampler', () => build(operationalSampler)); const op = tr.events.find((e) => e.kind === 'operation' && e.rule === 'b.ignite')!; const ign = tr.events[op.ignition]; return { pass: op.t - ign.t === 2, evidence: { ignitionT: ign.t, operationT: op.t } }; } },
    { id: 'blocked-by-resource', claim: 'Operations whose resource needs cannot be met are recorded as blocked, not silently dropped.', run: () => { const tr = runSpec(build(operationalSampler, { resource: 1, latchAt: 50 })); const b = tr.events.filter((e) => e.kind === 'blocked'); return { pass: b.length > 0, evidence: b.slice(0, 2) }; } },
    { id: 'penetration-loss', claim: 'A threshold coupling loses sub-threshold differences and records the loss.', run: () => { const tr = run('sampler', () => build(operationalSampler)); const l = tr.events.filter((e) => e.kind === 'loss'); return { pass: l.length > 0, evidence: l.slice(0, 2).map((x) => ({ coupling: x.coupling, why: x.why, value: x.value })) }; } },
    { id: 'feedback-structural', claim: 'Feedback is detected structurally (a descendant of an ignition modifies what it read).', run: () => { const tr = run('sampler', () => build(operationalSampler)); return { pass: (tr.loops as unknown[]).length > 0, evidence: (tr.loops as any[]).map((l) => `${l.originRule}→${l.key} (${l.kind}, ×${l.count})`) }; } },
    { id: 'closure-monotone', claim: 'A latching operation produces a monotone occurrence (probe-declared; not demonstrated irreversibility) and a configuration reorganization.', run: () => { const tr = run('sampler', () => build(operationalSampler)); const re = tr.events.filter((e) => e.kind === 'reorganization' && e.target === 'dimension'); return { pass: (tr.summary.horizonRelativeClosure as any[]).some((x) => x.probe === 'latched' && x.kind === 'monotone-occurrence') && re.length > 0, evidence: { horizonRelativeClosure: tr.summary.horizonRelativeClosure, reorganizations: re.map((e) => e.key) } }; } },
    { id: 'exact-rerun', claim: 'Deterministic reruns reproduce the run hash and the same TIIs.', run: () => { const a = runSpec(build(operationalSampler)), b = runSpec(build(operationalSampler)); const ta = tiiRecords(a).map((r) => r.tii), tb = tiiRecords(b).map((r) => r.tii); return { pass: a.meta.runHash === b.meta.runHash && ta.length > 0 && ta.join() === tb.join(), evidence: { runHash: a.meta.runHash.slice(0, 16), tiis: ta.length } }; } },
    { id: 'operational-addressing', claim: 'Operational addresses are independent of storage: they span nodes, share nodes, split, merge, become unavailable and re-ignite under a new address.', run: () => {
      const tr = runSpec(build(addressing)); const A = Object.fromEntries((tr.final.operationalAddresses as any[]).map((o) => [o.id, o]));
      const ops = new Set(tr.events.filter((e) => e.kind === 'reorganization' && e.target === 'op-address').map((e) => e.op));
      return { pass: ['split', 'merge', 'unavailable', 'reignite', 'unresolve', 'relate'].every((o) => ops.has(o)) && A['tension-archival']?.lineage.includes('tension-left') && A['rhythm'].storage.includes('s/shared') && validateTrace(tr).length === 0,
        evidence: { operations: [...ops], final: Object.values(A).map((o: any) => `${o.id}:${o.status}←[${o.lineage.join(',')}]`) } };
    } },
    { id: 'multi-clock', claim: 'Processes run on several asynchronous clocks.', run: () => { const tr = runSpec(build(tooLate)); const cl = (tr.final.clocks as any[]).map((c) => `${c.id}:${c.ticks}`); return { pass: cl.length >= 3, evidence: cl }; } },
  ] },
  { layer: 2, title: 'Observation revision', checks: [
    { id: 'non-detection-reasons', claim: 'Non-detection is classified by reason (boundary, resolution, scale, window, range, placement) and never as absence.', run: () => {
      const spec: WorldSpec = { id: 'epistemic-probe', seed: 1, horizon: 12, state: { 'in/a': 0, 'in/b': 0, 'out/c': 0, blip: 0, big: 0, unseen: 0 },
        clocks: [{ id: 'fast', period: 1 }, { id: 'slow', period: 4 }],
        rules: [
          { id: 'tiny', clock: 'fast', when: (c) => c.tick === 2, then: (_c, e) => e.add('in/a', 0.01) },
          { id: 'cancel', clock: 'fast', when: (c) => c.tick === 3, then: (_c, e) => { e.add('in/a', 1); e.add('in/b', -1); } },
          { id: 'hidden', clock: 'fast', when: (c) => c.tick === 4, then: (_c, e) => e.add('out/c', 1) },
          { id: 'blip-on', clock: 'fast', when: (c) => c.tick === 5, then: (_c, e) => e.set('blip', 1) },
          { id: 'blip-off', clock: 'fast', when: (c) => c.tick === 6, then: (_c, e) => e.set('blip', 0) },
          { id: 'huge', clock: 'fast', when: (c) => c.tick === 7, then: (_c, e) => e.set('big', 1e6) },
          { id: 'elsewhere', clock: 'fast', when: (c) => c.tick === 8, then: (_c, e) => e.set('unseen', 1) },
        ],
        apparatus: [{ id: 'A', channels: [
          { id: 'sum', clock: 'fast', reads: ['in/a', 'in/b'], aggregate: 'sum', resolution: 0.5 },
          { id: 'bounded', clock: 'fast', reads: ['out/c'], boundary: ['in/'] },
          { id: 'slow', clock: 'slow', reads: ['blip'] },
          { id: 'ranged', clock: 'fast', reads: ['big'], range: [0, 100] },
        ] }] };
      const tr = runSpec(spec); const seen = new Set(Object.values(tr.epistemic.A));
      const want = ['below-resolution', 'scale-incompatible', 'boundary-hidden', 'temporal-window-incompatible', 'apparatus-incompatible', 'not-measured'];
      return { pass: want.every((w) => seen.has(w as any)) && !seen.has('absent' as any) && validateTrace(tr).length === 0, evidence: [...seen] };
    } },
    { id: 'aliasing-detected', claim: 'States identical under the observation map that diverge under the same intervention trigger an aliasing record.', run: () => { const tr = runSpec(build(hiddenPhase, { reviser: false })); const a = tr.events.filter((e) => e.kind === 'aliasing'); return { pass: a.length > 0, evidence: a.slice(0, 2).map((x) => ({ key: x.key, sig: x.sig, next: x.next })) }; } },
    { id: 'self-revision', claim: 'The Ziran reviser grows a sensor along the physical coupling graph and records the three questions.', run: () => {
      const tr = run('hidden', () => build(hiddenPhase)); const n = tr.events.find((e) => e.kind === 'note' && e.note === 'observability-revision');
      return { pass: !!n && n.data.apparatusChange?.kind === 'placement' && !!n.data.previouslyUnavailable, evidence: n ? { unavailable: n.data.previouslyUnavailable, change: n.data.apparatusChange } : null };
    } },
    { id: 'revision-tradeoff-exposed', claim: 'Observation revision is evaluated downstream: lost observability and resource depletion are recorded; the cheapest resolving revision is not assumed best; no-selection mode exists.', run: () => {
      const a = runSpec(build(sensorBudget)), z = runSpec(build(sensorBudget, { policy: 'none' }));
      const T = a.events.find((e) => e.kind === 'note' && e.note === 'observability-revision')?.data.tradeoff ?? [];
      const reloc = T.find((x: any) => x.kind === 'relocate'), grow = T.find((x: any) => x.kind === 'placement');
      const none = z.events.find((e) => e.kind === 'note' && e.note === 'observability-revision.tradeoff-only');
      return { pass: !!reloc && reloc.lostObservability.length > 0 && !!grow && grow.fragility.resourcesDepleted.length > 0 && T.filter((x: any) => x.pareto).length >= 2 && !!none && !z.events.some((e) => e.kind === 'reorganization' && e.target === 'apparatus'),
        evidence: T.map((x: any) => ({ kind: x.kind, lost: x.lostObservability, gained: x.newObservability, depleted: x.fragility.resourcesDepleted, pareto: x.pareto, selected: x.selected })) };
    } },
    { id: 'revision-alters-reachability', claim: 'The new distinction changes later reachability (negative excursions largely closed).', run: () => {
      const a = run('hidden', () => build(hiddenPhase)), b = runSpec(build(hiddenPhase, { reviser: false }));
      const lastA = a.probeRelativeReachability.at(-1)?.probes['negative-excursion'].fraction, lastB = b.probeRelativeReachability.at(-1)?.probes['negative-excursion'].fraction;
      return { pass: a.probes['negative-excursion'].flips < b.probes['negative-excursion'].flips && lastA === 0 && lastB > 0, evidence: { flipsWith: a.probes['negative-excursion'].flips, flipsWithout: b.probes['negative-excursion'].flips, reachWith: lastA, reachWithout: lastB } };
    } },
  ] },
  { layer: 3, title: 'Probe-relative reachability and branch closure', checks: [
    { id: 'conditional-then-closed', claim: 'A branch is conditionally reachable before commitment and becomes unreachable after it.', run: () => {
      const tr = run('branch', () => build(branchClosure)); const R = tr.probeRelativeReachability;
      const early = R[0].probes['B-complete'].status; const closed = tr.events.find((e) => e.kind === 'reachability.probe-relative' && e.changes.some((c: any) => c.probe === 'B-complete' && c.change === 'became-unreachable'));
      return { pass: early === 'conditionally-reachable' && !!closed, evidence: { early, closedAt: closed?.t } };
    } },
    { id: 'horizon-relative-closure', claim: 'Probe-relative closure persists to the end of the run (horizon-relative closure, not demonstrated irreversibility) and branches disappear.', run: () => {
      const tr = run('branch', () => build(branchClosure)); const irr = tr.summary.horizonRelativeClosure as any[];
      const dis = tr.probeRelativeReachability.some((r) => r.branchesDisappeared.length > 0);
      return { pass: irr.some((x) => x.probe === 'B-complete' && x.kind === 'horizon-relative-closure') && dis, evidence: { horizonRelativeClosure: irr, branches: tr.probeRelativeReachability.map((r) => r.branches) } };
    } },
  ] },
  { layer: 3.5, title: 'Emergent reachability (description-space change)', checks: [
    { id: 'probe-identical-but-operationally-different', claim: 'Two runs with identical predefined probe results are reported operationally different when one generates a new configuration dimension and transition class.', run: () => {
      const a = runSpec(build(novelDimension)), b = runSpec(build(novelDimension, { novel: false })); const d = diffTraces(a, b);
      return { pass: d.probeIdentical && d.operationallyDifferent && !d.stateSpace.identical && d.emergent.grammarOnlyA.length > 0, evidence: { probeIdentical: d.probeIdentical, finalOnlyA: d.stateSpace.finalOnlyA, emergentGrammarOnlyA: d.emergent.grammarOnlyA } };
    } },
    { id: 'domain-facet-level-c-and-d', claim: 'A domain facet unknown to the core yields Level-C lineage; registering it during the run is a separate Level-D change.', run: () => {
      const pre = runSpec(build(causalFacetWorld, { registerAtRuntime: false })), rt = runSpec(build(causalFacetWorld));
      const cPre = pre.stateSpaceLineage.filter((x) => x.added['causal-order']?.length);
      const dRt = rt.stateSpaceLineage.find((x) => x.facetsAdded.includes('causal-order')), cRt = rt.stateSpaceLineage.filter((x) => x.level === 'C' && x.added['causal-order']?.length);
      return { pass: cPre.length > 0 && !!dRt && dRt.level === 'D' && cRt.length > 0 && rt.metaLineage.some((m) => m.id === 'causal-order'), evidence: { preRegistered: cPre.map((x) => `t=${x.t} ${x.signature}`), runtime: rt.stateSpaceLineage.map((x) => `t=${x.t} [${x.level}] ${x.signature}`) } };
    } },
    { id: 'state-space-lineage', claim: 'S_t → S_{t+1} is recorded with lineage and Level-C reorganizations are distinguished from Level-B ones.', run: () => {
      const a = runSpec(build(novelDimension)); const lv = a.summary.levels;
      return { pass: a.stateSpaceLineage.length > 0 && lv.C > 0 && a.events.some((e) => e.kind === 'reorganization' && e.level === 'C'), evidence: { lineage: a.stateSpaceLineage.map((x) => `t=${x.t} ${x.from}→${x.to}: ${x.signature}`), levels: lv } };
    } },
  ] },
  { layer: 4, title: 'Delayed correction', checks: [
    { id: 'in-time-vs-too-late', claim: 'The same correction is in time when the environment is slow and too late when it is fast.', run: () => {
      const slow = correctionSummary(runSpec(build(tooLate, { envPeriod: 30 }))), fast = correctionSummary(runSpec(build(tooLate, { envPeriod: 5 })));
      return { pass: !slow['correct-but-too-late'] && (fast['correct-but-too-late'] ?? 0) > 0, evidence: { slow, fast } };
    } },
    { id: 'misread-basis-incorrect', claim: 'A correction based on a misread observation is classified as incorrect, distinct from too late.', run: () => { const s = correctionSummary(runSpec(build(tooLate, { sensorError: 0.25 }))); return { pass: (s['incorrect'] ?? 0) > 0 && (s['correct-in-time'] ?? 0) > 0, evidence: s }; } },
    { id: 'too-slow-truth', claim: 'Too-late corrections are exactly those whose correction time exceeds the environmental reconfiguration time.', run: () => {
      const cs = corrections(runSpec(build(tooLate, { envPeriod: 5 }))); const bad = cs.filter((c) => c.epistemic === 'correct' && c.operational !== 'not-executed' && (c.operational === 'too-late') !== c.tooSlow);
      return { pass: cs.length > 0 && bad.length === 0, evidence: { corrections: cs.length, inconsistent: bad.length, example: cs.find((c) => c.tooSlow) } };
    } },
  ] },
  { layer: 5, title: 'Fragility transfer', checks: [
    { id: 'transfer-detected', claim: 'Strengthening A improves A while moving risk/burden/observability loss to B and the pool.', run: () => {
      const r = fragilityTransfer(runSpec(build(sharedLoad, { k: 0 })), runSpec(build(sharedLoad, { k: 2 })), SHARED_LOAD_REGIONS, 'A');
      return { pass: r.verdict === 'local-improvement-with-fragility-transfer' && r.transfers.some((t) => t.region === 'B') && r.transfers.some((t) => t.region === 'pool'), evidence: r.transfers.map((t) => `${t.region}:${t.kind}`) };
    } },
    { id: 'optimizer-reports-transfer', claim: 'An optimizer that improves A reports the fragility it moved.', run: () => {
      const o = optimize({ base: build(sharedLoad, { k: 0 }), knobs: [{ id: 'k', values: [1, 2, 3], apply: (_s, v) => build(sharedLoad, { k: v }) }], objective: (tr) => (tr.events.filter((e) => e.kind === 'effect' && e.address === 'A/stress').reduce((a, e) => a + Math.max(0, e.after - 1), 0)), regions: SHARED_LOAD_REGIONS, target: 'A', rounds: 1 });
      return { pass: o.transferDetected, evidence: { setting: o.setting, transfers: o.overall.transfers.map((t) => `${t.region}:${t.kind}`) } };
    } },
  ] },
  { layer: 6, title: 'Medium substitution', checks: [
    { id: 'electricity-where-nonredundant', claim: 'Fast coordination needs a fast medium (electrical or optical substitute); slow holding does not care.', run: () => {
      const probes = (m: string) => runLight(applyPerturbations(build(xenoCoordination), [{ type: 'medium-substitution', to: m, table: MEDIA }])).probeState;
      const r = Object.fromEntries(['electrical', 'optical', 'liquid-metal', 'ionic', 'hydrogel', 'chemical', 'mechanical'].map((m) => [m, { fast: probes(m)['fast-coordination'].first !== null, holding: probes(m)['holding'].first !== null }]));
      return { pass: r.electrical.fast && r.optical.fast && !r.chemical.fast && Object.values(r).every((x) => x.holding), evidence: r };
    } },
    { id: 'nonreciprocity', claim: 'One-way coupling transmits downstream only; reciprocal coupling also reaches upstream.', run: () => {
      const a = runLight(build(nonreciprocalChain, { reciprocal: 0 })).probeState, b = runLight(build(nonreciprocalChain, { reciprocal: 1 })).probeState;
      return { pass: a['downstream-reached'].first !== null && a['upstream-reached'].first === null && b['upstream-reached'].first !== null, evidence: { oneWay: a['upstream-reached'].first, reciprocal: b['upstream-reached'].first } };
    } },
  ] },
  { layer: 7, title: 'Body reorganization', checks: [
    { id: 'simultaneous-organizations', claim: 'Several bodily organizations ignite at once and compete, cooperate and suppress each other.', run: () => {
      const tr = run('body-all', () => bodySpec({ organizations: [...XENO14] })); const ip = interplay(tr);
      const active = ip.bundles.filter((b) => ip.share.some((s) => s.shares[b] > 0));
      return { pass: active.length >= 8 && Object.keys(ip.competition).length > 0 && Object.keys(ip.cooperation).length > 0 && Object.keys(ip.suppression).length > 0, evidence: { active: active.length, competition: Object.keys(ip.competition).slice(0, 4), suppression: Object.keys(ip.suppression).slice(0, 4), lockIn: ip.lockIn, silenced: ip.silenced } };
    } },
    { id: 'endpoint-removal-reorganizes', claim: 'Endpoint removal is a traced reorganization that changes the movement path.', run: () => {
      const a = run('body-cmd', () => bodySpec({ organizations: [] })), b = runSpec(bodySpec({ organizations: ['endpoint-removal', 'lower-abdominal-continuity'] }));
      const re = b.events.filter((e) => e.kind === 'reorganization' && e.target === 'rule').map((e) => e.key);
      const pr = pathAndResources(a, b, ['body/move/pos', 'body/seg/0/lean'], ['body/energy']);
      return { pass: re.includes('cmd.endpoint.windup') && pr.pathDeviation > 0, evidence: { disabled: re, pathDeviation: pr.pathDeviation, energy: [pr.resourcesA, pr.resourcesB] } };
    } },
    { id: 'body-fragility', claim: 'Changing bodily organization is evaluated for fragility transfer across body regions.', run: () => {
      const r = fragilityTransfer(run('body-cmd', () => bodySpec({ organizations: [] })), runSpec(bodySpec({ organizations: ['endpoint-removal', 'zero-run-up-transition', 'axis-maintenance'] })), BODY_REGIONS, 'axis');
      return { pass: Object.keys(r.profiles.variant).length === BODY_REGIONS.length, evidence: { verdict: r.verdict, transfers: r.transfers.map((t) => `${t.region}:${t.kind}`) } };
    } },
  ] },
  { layer: 8, title: 'Variable construction (supplied and revisable grammar)', checks: [
    { id: 'grammar-bounded-inverse-square', claim: 'Given only positions, the system selects an inverse-square relational variable from the supplied construction grammar (grammar-bounded selection, not reconstruction of gravity).', run: () => {
      const d = discoverFromTrace(runSpec(build(hiddenAttraction)));
      return { pass: d.relativeImprovement > 0.99 && d.accepted.some((g) => /inv_sq\(sub/.test(g.expr)) && d.mode === 'grammar-bounded', evidence: { claims: d.claims, claimStrength: d.claimStrength, inheritedComparison: d.inheritedComparison } };
    } },
    { id: 'not-forced-into-inherited-law', claim: 'Under a different hidden law a different variable is selected from the same supplied grammar (success is not similarity to human science).', run: () => {
      const d = discoverFromTrace(runSpec(build(hiddenAttraction, { law: 1 })), 20, 1);
      return { pass: d.accepted.some((g) => /^inv\(sub/.test(g.expr)) && !d.accepted.some((g) => /inv_sq/.test(g.expr)), evidence: d.accepted.map((g) => `${g.id}=${g.expr}`) };
    } },
    { id: 'persistence-without-gene', claim: 'A persistence-across-replacement distinction is found when (and only when) the hidden process carries it.', run: () => {
      const a = persistenceAcrossReplacement(runSpec(build(replacementPersistence))), b = persistenceAcrossReplacement(runSpec(build(replacementPersistence, { inheritance: false })));
      return { pass: a.nonRedundant && !b.nonRedundant, evidence: { withHiddenInheritance: a.ratio, without: b.ratio } };
    } },
    { id: 'inherited-category-retention', claim: 'The inherited distinction "discrete levels" is retained only where it changes prediction.', run: () => {
      const a = categoryRetention(runSpec(build(stepResponse))), b = categoryRetention(runSpec(build(stepResponse, { discrete: false })));
      return { pass: a.retained && !b.retained, evidence: { discreteWorld: a.relativeGain, gradedWorld: b.relativeGain } };
    } },
  ] },
  { layer: 9, title: 'Institutional penetration', checks: [
    { id: 'law-media', claim: 'An enacted text penetrates through software, permissions, finance, behaviour and enforcement; the unregistered are reached later by procedure.', run: () => {
      const tr = runSpec(build(lawPenetration)); const o = tr.events.find((e) => e.kind === 'effect' && e.address === 'law/text')!;
      const p = penetration(tr, o.seq); const t = (a: string) => tr.events.find((e) => e.kind === 'effect' && e.address === a)?.t;
      return { pass: p.media.length >= 5 && (t('perm/p4') ?? 0) > (t('perm/p1') ?? Infinity), evidence: { media: p.media, registeredReached: t('perm/p1'), unregisteredReached: t('perm/p4') } };
    } },
    { id: 'score-changes-measurement', claim: 'A score reorganizes future measurement (adds surveillance), closing a loop through observation.', run: () => {
      const tr = runSpec(build(scoreEcology)); const re = tr.events.filter((e) => e.kind === 'reorganization' && e.target === 'apparatus');
      const loops = (tr.loops as any[]).filter((l) => l.kind === 'observation' || l.kind === 'observation-mediated' || l.key.startsWith('o:'));
      return { pass: re.length > 0 && loops.length > 0, evidence: { surveillanceAdded: re.map((e) => e.key), observationLoops: loops.slice(0, 4).map((l) => `${l.originRule}→${l.key}`) } };
    } },
  ] },
  { layer: 10, title: 'Market configurations', checks: [
    { id: 'configurations-differ-operationally', claim: 'Configurations differ in what they detect, when they respond, and whose positions their trades penetrate; the hidden fundamental is unavailable to all (not absent).', run: () => {
      const tr = run('market', () => marketSpec(marketPreset.defaults)); const c = compareParticipants(tr);
      const lat = c.map((x) => x.timing.meanLatency); const reached = c.some((x) => (x.penetration?.otherParticipantsReached.length ?? 0) > 0);
      const unavailable = c.every((x) => Object.keys(x.unavailable['mkt/fundamental']).every((k) => k !== 'detected'));
      return { pass: new Set(lat.map((l) => Math.round(l ?? -1))).size >= 3 && reached && unavailable, evidence: c.map((x) => ({ p: x.participant, latency: x.timing.meanLatency, trades: x.trades, reaches: x.penetration?.otherParticipantsReached, wealth: Math.round(x.wealth) })) };
    } },
    { id: 'goal-transformation', claim: 'The historically constrained operational reconstruction R-aristotle-oikonomia-v1 transforms its goal (bounded acquisition) and reports only in reconstruction form.', run: () => {
      const c = compareParticipants(run('market', () => marketSpec(marketPreset.defaults))).find((x) => x.participant === 'aristotle')!;
      return { pass: c.goalTransformations.length > 0 && c.reconstructionStatements.every((s) => s.startsWith('Under reconstruction')), evidence: c.reconstructionStatements };
    } },
    { id: 'trader-category-evaluated', claim: 'Aggregate-flow failure is not taken as proof of "trader": lower-level operational bundle descriptions and an event-level trader-beyond-role test are run first.', run: () => {
      const r = traderCategoryTest({}, [44, 45, 46]);
      const allowed = ['matched aggregate flow sufficient on the measured axes; trader category not needed here', 'trader non-redundant given the tested bundle descriptions', 'trader vocabulary redundant given operational bundle description', 'aggregate-flow model insufficient; trader-category necessity unresolved'];
      return { pass: allowed.includes(r.verdict) && Object.keys(r.vsBundles).length === 5 && Object.keys(r.eventLevel.axes).length === 3, evidence: { verdict: r.verdict, aggregateInsufficient: r.aggregateInsufficient, bundlesReproduce: r.bundlesReproduce, traderBeyondRoles: r.eventLevel.axes } };
    } },
  ] },
  { layer: 11, title: 'Historical thought re-ignition', checks: [
    { id: 'cross-address-reignition', claim: 'Commitments re-ignite in later address domains after their origin domain is lost; re-ignition transforms them.', run: () => {
      const tr = run('thought', () => build(reignition)); const n = tr.events.filter((e) => e.kind === 'note');
      const lost = n.find((e) => e.note === 'address-domain.lost' && e.data.domain === 'lyceum')!; const after = n.filter((e) => e.note === 're-ignition' && e.t > lost.t);
      return { pass: after.length > 0 && after.every((e) => e.data.fidelity < 1), evidence: after.slice(0, 4).map((e) => `${e.t}:${e.data.domain}/${e.data.commitment} via ${e.data.medium} ×${e.data.fidelity}`) };
    } },
    { id: 'remnants', claim: 'Medium destruction makes some commitments permanently inaccessible unless another medium carried them.', run: () => {
      const a = run('thought', () => build(reignition)).probes, b = runSpec(build(reignition, { printCopy: 0 })).probes;
      return { pass: a['c.practice:inaccessible'].first === null && b['c.practice:inaccessible'].first !== null, evidence: { withPrint: a['c.practice:inaccessible'], withoutPrint: b['c.practice:inaccessible'] } };
    } },
    { id: 'no-certainty-claims', claim: 'Reconstruction output never claims what a historical person "would definitely" do.', run: () => {
      let threw = false; try { assertNoCertainty('Aristotle would definitely buy'); } catch { threw = true; }
      let threw2 = false; try { assertNoCertainty('Aristotle predicts a crash'); } catch { threw2 = true; }
      const ok = reconstructionStatement(RECONSTRUCTIONS.spinoza, 'C', 'persevere', 'T');
      const claim = reconstructionClaim(RECONSTRUCTIONS.aristotle, 'C', 'P', 'T');
      return { pass: threw && threw2 && ok.startsWith('Under reconstruction') && claim.historicalFactualClaim === false && claim.uncertainty.notes.length > 0 && /uncertainty/.test(claim.statement), evidence: { statement: ok, claim } };
    } },
    { id: 'reason-vocabulary-local', claim: 'A reason-giving vocabulary is evaluated only where it has ignited, along several non-redundancy axes (not prediction only).', run: () => {
      const tr = run('thought', () => build(reignition));
      const pr = vocabularyProfile(tr, reasonVocabulary, { dt: 2, window: 10 });
      const evaluable = Object.values(pr.axes).filter((a) => a.evaluable).length;
      return { pass: pr.appliedFraction < 1 && pr.appliedFraction > 0 && evaluable >= 3, evidence: { appliedFraction: pr.appliedFraction, summary: pr.summary } };
    } },
  ] },
  { layer: 12, title: 'Human / AI / hybrid comparison', checks: [
    { id: 'human-unit-local', claim: 'The human-addressed part is interventionally necessary in some configurations and redundant in others.', run: () => {
      const a = humanNecessity('body+nervous'), b = humanNecessity('ai-direct');
      return { pass: a.humanInterventionallyNecessary && !b.humanInterventionallyNecessary, evidence: { 'body+nervous': a.perMetric, 'ai-direct': b.perMetric } };
    } },
    { id: 'loss-is-not-concept', claim: 'Loss can fall further under artifact-following labels while post-shift decisions become worse: loss ≠ concept.', run: () => {
      const a = separationReport(runSpec(build(aiPipeline))), b = separationReport(runSpec(build(aiPipeline, { artifact: false })));
      return { pass: a.lossBeforeShift < b.lossBeforeShift && (a.outcomesAfterShift.precision ?? 1) < (b.outcomesAfterShift.precision ?? 0), evidence: { artifact: { loss: a.lossBeforeShift, postShiftPrecision: a.outcomesAfterShift.precision }, concept: { loss: b.lossBeforeShift, postShiftPrecision: b.outcomesAfterShift.precision } } };
    } },
    { id: 'pipeline-stages-separate', claim: 'Encoding, label implementation, objective, gradient, parameter update, output, institutional effect and data feedback are separate ignitions.', run: () => {
      const r = separationReport(runSpec(build(aiPipeline))); const need = ['input-encoding', 'concept-to-label', 'label-to-objective', 'objective-to-gradient', 'gradient-to-parameter', 'activation', 'output-to-institutional-effect', 'effect-to-training-data'];
      return { pass: need.every((k) => (r.stages[k] ?? 0) > 0), evidence: r.stages };
    } },
  ] },
  { layer: 13, title: 'Cross-scale physical / biological / institutional coupling', checks: [
    { id: 'cross-scale-penetration', claim: 'A heat difference penetrates biological, market and groundwater addresses across scales and clocks; subsidy policy turns it into geological depletion.', run: () => {
      const tr = runSpec(build(heatCropPolicy)); const o = tr.events.find((e) => e.via === 'intervention:heat-pulse')!;
      const p = penetration(tr, o.seq, { maxDepth: 60, maxNodes: 6000 }); const nos = runLight(build(heatCropPolicy, { subsidy: false })).probeState;
      return { pass: p.scales.length >= 3 && p.clocks.length >= 2 && tr.probes['aquifer-depleted'].first !== null && nos['aquifer-depleted'].first === null, evidence: { scales: p.scales, media: p.media, clocks: p.clocks, depletedAt: tr.probes['aquifer-depleted'].first } };
    } },
    { id: 'multistability', claim: 'Hysteresis and rising variance before a critical transition.', run: () => { const h = hysteresis(runSpec(build(bistableRamp)) as any); return { pass: (h.hysteresisWidth ?? 0) > 0.5 && (h.preTipVariance ?? 0) > (h.earlyVariance ?? 0), evidence: h }; } },
    { id: 'chaotic-divergence', claim: 'Identical observations at t=0 do not fix later states: exponential divergence.', run: () => { const d = divergence(build(chaoticLattice), build(chaoticLattice, { perturb: 1e-9 }), 40); return { pass: (d.lyapunovEstimate ?? 0) > 0.05, evidence: { lyapunovEstimate: d.lyapunovEstimate } }; } },
    { id: 'cicgi-and-remnants', claim: 'Cumulative generation through inheritance is identified as intervals; after collapse, remnant stores re-ignite growth.', run: () => {
      const w = cicgiIntervals(); const tr = runSpec(build(cicgi));
      return { pass: w.some((x) => x.cicgi) && tr.probes['recovered-cumulative'].first !== null, evidence: { intervals: w.filter((x) => x.cicgi).length + '/' + w.length, recovered: tr.probes['recovered-cumulative'].first } };
    } },
    { id: 'capital-category', claim: 'A single fungible capital scalar is tested against distinct resources and found to erase differences here.', run: () => { const r = capitalCategoryTest(); return { pass: !r.redundant, evidence: r.perMetric }; } },
  ] },
];

export function listLayers() { return LAYERS.map((l) => ({ layer: l.layer, title: l.title, checks: l.checks.map((c) => ({ id: c.id, claim: c.claim })) })); }

export function runBenchmark(only?: number[]): LayerResult[] {
  memo.clear();
  const out: LayerResult[] = [];
  let failedBelow = false;
  for (const L of LAYERS) {
    if (only && !only.includes(L.layer)) continue;
    const checks = L.checks.map((c) => {
      const t0 = Date.now();
      try { const r = c.run(); return { id: c.id, claim: c.claim, pass: r.pass, evidence: r.evidence, ms: Date.now() - t0, claimStatus: 'implementation property' as const }; }
      catch (e) { return { id: c.id, claim: c.claim, pass: false, evidence: null, ms: Date.now() - t0, error: String((e as Error).stack ?? e), claimStatus: 'implementation property' as const }; }
    }).map((c) => ({ ...c, status: (!c.pass ? 'fail' : failedBelow ? 'untrusted' : 'pass') as 'pass' | 'fail' | 'untrusted' }));
    const anyFail = checks.some((c) => !c.pass);
    out.push({ layer: L.layer, title: L.title, status: anyFail ? 'fail' : failedBelow ? 'untrusted' : 'pass', checks });
    if (anyFail) failedBelow = true;
  }
  return out;
}
