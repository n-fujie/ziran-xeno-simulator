// Zero-dependency HTTP server: JSON API + static interface.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensurePresets, listPresets } from './presets/index.ts';
import { getPreset, buildExperiment, type Experiment } from './core/experiment.ts';
import { runSpec, diffTraces } from './core/counterfactual.ts';
import { replayState, type Trace } from './core/trace.ts';
import { penetration, forwardIndex } from './core/penetration.ts';
import { PERTURBATION_TYPES, describePerturbation, type Perturbation } from './core/perturbations.ts';
import { tiiJsonl, tiiRecords } from './core/tii.ts';
import { compareRuns } from './analysis/compare.ts';
import { allRates } from './analysis/rates.ts';
import { corrections, correctionSummary, detectionLatencies } from './analysis/timing.ts';
import { fragilityTransfer, type Region } from './analysis/fragility.ts';
import { interplay } from './analysis/interplay.ts';
import { goalTimeline } from './analysis/goals.ts';
import { runBenchmark, listLayers } from './bench/layers.ts';
import { runTheoryBenchmarks, listTheory } from './bench/theory.ts';
import { runMetaBenchmarks, listMeta } from './bench/meta.ts';
import { globalMeta } from './meta/registry.ts';
import { traceSchemaSensitivity } from './meta/schema-sensitivity.ts';
import { TRACE_SCHEMAS, projectTrace, schemaDetail } from './meta/trace-schema.ts';
import { multiEmergence, DEFAULT_FEATURES, FEATURE_CONSTRUCTORS } from './analysis/emergence.ts';
import { metaLatencies } from './analysis/meta-time.ts';
import { EVIDENCE_STATUS } from './meta/claims.ts';
import { discoverBundles, compareLabels } from './analysis/emergence.ts';
import { vocabularyProfile } from './analysis/vocabulary.ts';
import { observationSeries } from './analysis/samples.ts';
import { grammarBoundedDiscovery } from './analysis/grammar-bounded.ts';
import { grammarMorphogenesis } from './analysis/grammar-morphogenesis.ts';
import { reasonVocabulary } from './domains/thought.ts';
import { DISPLAY } from './domains/market.ts';
import { compareParticipants } from './domains/market.ts';
import { discoverFromTrace, persistenceAcrossReplacement, categoryRetention } from './domains/science.ts';
import { separationReport } from './domains/ai.ts';
import { hysteresis } from './domains/physical.ts';
import { RECONSTRUCTIONS } from './domains/thought.ts';
import { hashOf } from './core/hash.ts';
import type { RuleSpec, TraceEvent } from './core/types.ts';

ensurePresets();
const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(here, '..', 'public');
const PORT = Number(process.env.PORT ?? 3010);

interface Run { id: string; label: string; experiment: Experiment; trace: Trace; fwd?: Map<number, number[]>; createdAt: string }
const runs = new Map<string, Run>();
let counter = 0;
let benchCache: unknown = null;

/** Declarative goal rule so goals can be inserted from JSON: moves an address toward a target. */
function goalRule(g: { id: string; clock: string; address: string; target: number; gain?: number; band?: number }): RuleSpec {
  return {
    id: `goal.${g.id}`, clock: g.clock, tags: ['goal'], label: `pursue ${g.address} → ${g.target}`,
    when: (c) => Math.abs(c.get(g.address) - g.target) > (g.band ?? 0.05),
    then: (c, e) => { e.add(g.address, (g.gain ?? 0.2) * (g.target - c.get(g.address))); if (c.tick <= 1) e.note('goal.declared', { goal: g.id }); },
  };
}

function hydrate(ps: any[] = []): Perturbation[] {
  return ps.map((p) => {
    if (p.type === 'goal-insertion' && p.goal) return { type: 'goal-insertion', rule: goalRule(p.goal), at: p.at };
    if (p.type === 'reorganization-trigger' || p.type === 'reconstruction-transfer' || p.type === 'hybridization') throw new Error(`${p.type} needs code; use preset parameters (e.g. participants / organizations) instead`);
    return p as Perturbation;
  });
}

function doRun(x: Experiment, label?: string): Run {
  const spec = buildExperiment(x);
  const trace = runSpec(spec, {}, { presetId: x.preset, params: spec.params, perturbations: (x.perturbations ?? []).map(describePerturbation) });
  const id = `run-${++counter}`;
  const r: Run = { id, label: label ?? x.label ?? `${x.preset}${x.perturbations?.length ? ' + ' + x.perturbations.length + ' perturbation(s)' : ''} · seed ${spec.seed}`, experiment: x, trace, createdAt: new Date().toISOString() };
  runs.set(id, r);
  if (runs.size > 40) runs.delete(runs.keys().next().value!);
  return r;
}

function summary(r: Run) {
  const t = r.trace;
  return { id: r.id, label: r.label, preset: r.experiment.preset, createdAt: r.createdAt, meta: t.meta, summary: t.summary, events: t.events.length };
}

function domainAnalysis(r: Run): unknown {
  const t = r.trace, p = r.experiment.preset, params = { ...getPreset(p).defaults, ...(r.experiment.params ?? {}) };
  switch (p) {
    case 'market.synthetic': return { kind: 'market', participants: compareParticipants(t, (params.participants as string[]) ?? undefined), reconstruction: RECONSTRUCTIONS.aristotle, display: DISPLAY };
    case 'science.hidden-attraction': return { kind: 'variables', grammarBounded: discoverFromTrace(t, Number(params.G ?? 20), Number(params.law ?? 2)) };
    case 'science.replacement-persistence': return { kind: 'science', ...persistenceAcrossReplacement(t, Number(params.slots ?? 8)) };
    case 'science.step-response': return { kind: 'science', ...categoryRetention(t, Number(params.levels ?? 4)) };
    case 'ai.pipeline': return { kind: 'ai', ...separationReport(t, Number(params.shiftAt ?? 180)) };
    case 'physical.bistable-ramp': return { kind: 'physical', ...hysteresis(t as any) };
    case 'body.xeno14': return { kind: 'body', ...interplay(t) };
    case 'thought.reignition': return { kind: 'thought', reconstructions: RECONSTRUCTIONS, reasonVocabularyProfile: vocabularyProfile(t, reasonVocabulary, { dt: 2, window: 10 }) };
    case 'science.delayed-law': {
      const S = observationSeries(t, 'O', ['x']);
      const gb = grammarBoundedDiscovery(S, { maxAccept: 5 });
      const mg = grammarMorphogenesis(S, { changeAt: Number(params.switchAt ?? 160), interventions: [60, 120, 200, 260] });
      return { kind: 'variables', grammarBounded: { ...gb, accepted: gb.accepted.map(({ values, ...g }) => g) }, morphogenesis: { ...mg, values: undefined } };
    }
    default: return null;
  }
}

function neighborhood(r: Run, seq: number, depth = 6) {
  const ev = r.trace.events;
  const up: { seq: number; depth: number; parent: number }[] = [];
  const seen = new Set<number>([seq]);
  let fr = [{ s: seq, d: 0 }];
  while (fr.length && up.length < 120) {
    const nx: { s: number; d: number }[] = [];
    for (const { s, d } of fr) { if (d >= depth) continue; for (const c of (ev[s]?.cause as number[]) ?? []) if (!seen.has(c)) { seen.add(c); up.push({ seq: c, depth: d + 1, parent: s }); nx.push({ s: c, d: d + 1 }); } }
    fr = nx;
  }
  r.fwd ??= forwardIndex(ev);
  const down: { seq: number; depth: number; parent: number }[] = [];
  fr = [{ s: seq, d: 0 }]; const seen2 = new Set<number>([seq]);
  while (fr.length && down.length < 160) {
    const nx: { s: number; d: number }[] = [];
    for (const { s, d } of fr) { if (d >= depth) continue; for (const c of r.fwd.get(s) ?? []) if (!seen2.has(c)) { seen2.add(c); down.push({ seq: c, depth: d + 1, parent: s }); nx.push({ s: c, d: d + 1 }); } }
    fr = nx;
  }
  const brief = (s: number) => { const e = ev[s]; return { seq: s, t: e.t, kind: e.kind, label: e.rule ?? e.address ?? (e.apparatus ? e.apparatus + '/' + e.channel : e.key), via: e.via, delta: e.delta }; };
  return { event: ev[seq], epistemic: Object.fromEntries(Object.entries(r.trace.epistemic).map(([a, m]) => [a, m[seq] ?? null]).filter(([, v]) => v)),
    upstream: up.map((u) => ({ ...brief(u.seq), depth: u.depth, parent: u.parent })), downstream: down.map((d) => ({ ...brief(d.seq), depth: d.depth, parent: d.parent })) };
}

function analysis(r: Run) {
  const t = r.trace;
  const revisions = t.events.filter((e) => e.kind === 'note' && String(e.note).startsWith('observability-revision'));
  const reorganizations = t.events.filter((e) => e.kind === 'reorganization');
  return {
    rates: allRates(t), corrections: corrections(t).slice(0, 200), correctionSummary: correctionSummary(t), detectionLatencies: detectionLatencies(t),
    loops: t.loops, interactions: (t.interactions as any[]).slice(0, 200), probeRelativeReachability: t.probeRelativeReachability, emergentReachability: t.emergentReachability, stateSpaceLineage: t.stateSpaceLineage, metaLineage: t.metaLineage, meta: { initial: t.initial.meta, final: t.final.meta }, metaLatencies: metaLatencies(t), evidence: t.meta.evidence, claimStatus: t.meta.claimStatus, levelEvents: t.events.filter((e) => e.kind === 'reorganization' || e.kind === 'state-space' || e.kind === 'meta-configuration').slice(0, 400).map((e) => ({ seq: e.seq, t: e.t, kind: e.kind, level: e.kind === 'state-space' ? e.level : e.kind === 'meta-configuration' ? 'D' : e.level ?? 'B', what: e.kind === 'reorganization' ? `${e.target}.${e.op} ${e.key}` : e.kind === 'state-space' ? e.signature : `${e.op} ${e.registry}:${e.id} (${e.origin})`, distinctions: e.distinctions ?? null })), levels: t.summary.levels, space: { initial: t.initial.space, final: t.final.space }, operationalAddresses: t.final.operationalAddresses, probes: t.probes,
    revisions: revisions.map((e) => ({ seq: e.seq, t: e.t, note: e.note, data: e.data })), aliasing: t.events.filter((e) => e.kind === 'aliasing').slice(0, 60),
    reorganizations: reorganizations.slice(0, 300), tii: tiiRecords(t).slice(0, 300), goals: goalTimeline(t),
    notes: t.events.filter((e) => e.kind === 'note').slice(0, 300).map((e) => ({ seq: e.seq, t: e.t, note: e.note, data: e.data, via: e.via })),
    clocks: t.final.clocks, config: { initial: t.initial.config, final: t.final.config }, apparatus: { initial: t.initial.apparatus, final: t.final.apparatus },
    domain: domainAnalysis(r),
  };
}

function send(res: ServerResponse, code: number, body: unknown, type = 'application/json') {
  const data = type === 'application/json' ? JSON.stringify(body) : String(body);
  res.writeHead(code, { 'content-type': type + '; charset=utf-8', 'cache-control': 'no-store' });
  res.end(data);
}
async function body(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
  const s = Buffer.concat(chunks).toString('utf8'); return s ? JSON.parse(s) : {};
}
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const P = url.pathname;
    const m = (re: RegExp) => P.match(re);
    if (req.method === 'GET' && P === '/api/presets') return send(res, 200, listPresets().map((p) => ({ id: p.id, title: p.title, area: p.area, layer: p.layer, summary: p.summary, questions: p.questions ?? [], defaults: p.defaults, options: p.options ?? {}, perturbations: (p.perturbations ?? []).map((x) => ({ label: x.label, list: x.list.map(describePerturbation) })) })));
    if (req.method === 'GET' && P === '/api/perturbation-types') return send(res, 200, PERTURBATION_TYPES);
    if (req.method === 'GET' && P === '/api/runs') return send(res, 200, [...runs.values()].map(summary).reverse());
    if (req.method === 'POST' && P === '/api/run') { const b = await body(req); const r = doRun({ preset: b.preset, params: b.params, seed: b.seed, horizon: b.horizon, perturbations: hydrate(b.perturbations), label: b.label }); return send(res, 200, summary(r)); }
    if (req.method === 'POST' && P === '/api/batch') { const b = await body(req); const out = (b.experiments as any[]).map((x) => summary(doRun({ ...x, perturbations: hydrate(x.perturbations) }))); return send(res, 200, out); }
    let mm;
    if ((mm = m(/^\/api\/runs\/([\w-]+)$/)) && req.method === 'GET') { const r = runs.get(mm[1]); return r ? send(res, 200, summary(r)) : send(res, 404, { error: 'no such run' }); }
    if ((mm = m(/^\/api\/runs\/([\w-]+)\/trace$/))) { const r = runs.get(mm[1]); if (!r) return send(res, 404, { error: 'no such run' }); res.setHeader('content-disposition', `attachment; filename="${r.id}-${r.experiment.preset}.trace.json"`); return send(res, 200, r.trace); }
    if ((mm = m(/^\/api\/runs\/([\w-]+)\/tii$/))) { const r = runs.get(mm[1]); if (!r) return send(res, 404, { error: 'no such run' }); res.setHeader('content-disposition', `attachment; filename="${r.id}.tii.jsonl"`); return send(res, 200, tiiJsonl(r.trace), 'application/x-ndjson'); }
    if ((mm = m(/^\/api\/runs\/([\w-]+)\/events$/))) {
      const r = runs.get(mm[1]); if (!r) return send(res, 404, { error: 'no such run' });
      const kinds = url.searchParams.get('kinds')?.split(',').filter(Boolean); const q = url.searchParams.get('q')?.toLowerCase();
      const from = Number(url.searchParams.get('from') ?? 0), limit = Math.min(1000, Number(url.searchParams.get('limit') ?? 200));
      const t0 = Number(url.searchParams.get('t0') ?? -Infinity), t1 = Number(url.searchParams.get('t1') ?? Infinity);
      const match = (e: TraceEvent) => (!kinds || kinds.includes(e.kind)) && e.t >= t0 && e.t <= t1 && (!q || JSON.stringify(e).toLowerCase().includes(q));
      const all = r.trace.events.filter(match);
      return send(res, 200, { total: all.length, from, events: all.slice(from, from + limit) });
    }
    if ((mm = m(/^\/api\/runs\/([\w-]+)\/timeline$/))) {
      const r = runs.get(mm[1]); if (!r) return send(res, 404, { error: 'no such run' });
      const ev = r.trace.events.filter((e) => e.kind === 'ignition' && !e.suppressed).map((e) => [e.t, e.clock, e.rule, e.seq]);
      return send(res, 200, { clocks: r.trace.final.clocks, ignitions: ev.length > 20000 ? ev.filter((_, i) => i % Math.ceil(ev.length / 20000) === 0) : ev, observations: r.trace.observations, horizon: r.trace.meta.horizon });
    }
    if ((mm = m(/^\/api\/runs\/([\w-]+)\/event\/(\d+)$/))) { const r = runs.get(mm[1]); if (!r) return send(res, 404, { error: 'no such run' }); return send(res, 200, neighborhood(r, Number(mm[2]))); }
    if ((mm = m(/^\/api\/runs\/([\w-]+)\/penetration\/(\d+)$/))) { const r = runs.get(mm[1]); if (!r) return send(res, 404, { error: 'no such run' }); r.fwd ??= forwardIndex(r.trace.events); const p = penetration(r.trace, Number(mm[2]), { fwd: r.fwd }); return send(res, 200, { ...p, hops: p.hops.slice(0, 400) }); }
    if ((mm = m(/^\/api\/runs\/([\w-]+)\/analysis$/))) { const r = runs.get(mm[1]); if (!r) return send(res, 404, { error: 'no such run' }); return send(res, 200, analysis(r)); }
    if ((mm = m(/^\/api\/runs\/([\w-]+)\/replay$/))) {
      const r = runs.get(mm[1]); if (!r) return send(res, 404, { error: 'no such run' });
      const upto = Number(url.searchParams.get('upto') ?? Infinity); const st = replayState(r.trace, upto);
      const prev = upto > 0 ? replayState(r.trace, upto - 1) : r.trace.initial.state;
      return send(res, 200, { upto, t: r.trace.events[Math.min(upto, r.trace.events.length - 1)]?.t ?? 0, state: st, changed: Object.keys(st).filter((k) => st[k] !== prev[k]) });
    }
    if ((mm = m(/^\/api\/runs\/([\w-]+)\/rerun$/)) && req.method === 'POST') {
      const r = runs.get(mm[1]); if (!r) return send(res, 404, { error: 'no such run' });
      const again = runSpec(buildExperiment(r.experiment));
      return send(res, 200, { equal: again.meta.runHash === r.trace.meta.runHash, original: r.trace.meta.runHash, rerun: again.meta.runHash });
    }
    if (req.method === 'POST' && P === '/api/compare') {
      const b = await body(req); const A = runs.get(b.a), B = runs.get(b.b); if (!A || !B) return send(res, 404, { error: 'select two runs' });
      const regions: Region[] | undefined = b.regions?.length ? b.regions : undefined;
      return send(res, 200, { diff: diffTraces(A.trace, B.trace), levels: compareRuns(A.trace, B.trace, b.map), fragility: regions ? fragilityTransfer(A.trace, B.trace, regions, b.target ?? regions[0].id) : null });
    }
    if (req.method === 'GET' && P === '/api/bench/layers') return send(res, 200, listLayers());
    if (req.method === 'POST' && P === '/api/bench') { benchCache = { at: new Date().toISOString(), layers: runBenchmark(), theory: runTheoryBenchmarks(), meta: runMetaBenchmarks(), evidenceStatus: EVIDENCE_STATUS }; return send(res, 200, benchCache); }
    if (req.method === 'GET' && P === '/api/meta') return send(res, 200, { entries: globalMeta().snapshot(), traceSchemas: TRACE_SCHEMAS.map((s) => ({ ...s, detail: schemaDetail(s) })), features: FEATURE_CONSTRUCTORS.map((f) => ({ id: f.id, kind: f.kind, origin: f.origin, description: f.description, default: DEFAULT_FEATURES.includes(f.id) })), benchmarks: listTheory(), metaBenchmarks: listMeta(), evidenceStatus: EVIDENCE_STATUS });
    if ((mm = m(/^\/api\/runs\/([\w-]+)\/schema-sensitivity$/))) { const r = runs.get(mm[1]); if (!r) return send(res, 404, { error: 'no such run' }); const s = traceSchemaSensitivity(r.trace, { label: (id) => id.split('.')[0], responsibility: false }); const me = multiEmergence(TRACE_SCHEMAS.map((sc) => ({ schema: sc.id, tr: projectTrace(r.trace, sc) })), [DEFAULT_FEATURES, ['coupling'], ['coupling', 'ignition-co-occurrence'], ['ignition-rate', 'timing', 'temporal-scale', 'observation-dependence']]); return send(res, 200, { sensitivity: s, multiEmergence: { ...me, runs: me.runs.map((x) => ({ schema: x.schema, features: x.features, bundles: x.bundles.length })) } }); }
    if (req.method === 'GET' && P === '/api/theory/list') return send(res, 200, listTheory());
    if ((mm = m(/^\/api\/runs\/([\w-]+)\/emergence$/))) { const r = runs.get(mm[1]); if (!r) return send(res, 404, { error: 'no such run' }); const e = discoverBundles(r.trace); const labelBy = url.searchParams.get('label') ?? 'prefix'; const cmp = compareLabels(e, r.trace, (id) => (labelBy === 'prefix' ? id.split('.')[0] : null)); return send(res, 200, { ...e, key: undefined, members: e.bundles.map((b) => b.members.length), laterLabels: { labelling: 'rule-id prefix (applied only after discovery)', comparison: cmp }, keyHash: hashOf(e.key).slice(0, 12) }); }
    if (req.method === 'GET' && P === '/api/bench') return send(res, 200, benchCache);
    // static
    const f = join(PUBLIC, P === '/' ? 'index.html' : P.replace(/^\/+/, ''));
    if (f.startsWith(PUBLIC) && existsSync(f)) return send(res, 200, readFileSync(f, 'utf8'), MIME[extname(f)] ?? 'text/plain');
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 400, { error: String((e as Error).message ?? e) });
  }
});

// Binds to the loopback interface by default; set HOST=0.0.0.0 to expose it (there is no authentication).
const HOST = process.env.HOST ?? '127.0.0.1';
server.listen(PORT, HOST, () => console.log(`Ziran / Xeno Operational World Simulator → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
