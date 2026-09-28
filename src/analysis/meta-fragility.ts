// Meta-fragility transfer: a gain at one descriptive level can create fragility at another
// (better prediction → more expensive observation; richer grammar → slower adaptation; more detailed trace →
// resource overload; more flexible meta-grammar → unstable representation lineage). Metrics are kept per
// level and never reduced to one score.
import type { Trace } from '../core/trace.ts';

export type Level = 'A' | 'B' | 'C' | 'D' | 'trace';
export interface LevelMetric { value: number | null; prefer: 'min' | 'max'; level: Level; note?: string }
export type LevelMetrics = Record<string, LevelMetric>;

export interface CrossLevelTradeoff { gain: string; gainLevel: Level; cost: string; costLevel: Level; from: [number, number]; to: [number, number] }

/** Pairs (gain in one metric, loss in another at a different level) between a baseline and a variant. */
export function crossLevelTradeoffs(base: LevelMetrics, variant: LevelMetrics, tol = 1e-9): { gains: string[]; losses: string[]; tradeoffs: CrossLevelTradeoff[] } {
  const better = (k: string) => { const a = base[k]?.value, b = variant[k]?.value; if (a === null || b === null || a === undefined || b === undefined) return 0; const d = b - a; return Math.abs(d) <= tol ? 0 : (base[k].prefer === 'max' ? Math.sign(d) : -Math.sign(d)); };
  const keys = Object.keys(base).filter((k) => k in variant);
  const gains = keys.filter((k) => better(k) > 0), losses = keys.filter((k) => better(k) < 0);
  const tradeoffs: CrossLevelTradeoff[] = [];
  for (const g of gains) for (const l of losses) if (base[g].level !== base[l].level) tradeoffs.push({ gain: g, gainLevel: base[g].level, cost: l, costLevel: base[l].level, from: [base[g].value!, base[l].value!], to: [variant[g].value!, variant[l].value!] });
  return { gains, losses, tradeoffs };
}

/** Level-indexed metrics that can be read off any trace. */
export function traceLevelMetrics(tr: Trace): LevelMetrics {
  const detected = Object.values(tr.summary.epistemic as Record<string, Record<string, number>>).reduce((a, m) => a + (m.detected ?? 0), 0);
  const channels = (tr.final.apparatus as { channels: unknown[] }[]).reduce((a, x) => a + x.channels.length, 0);
  const sensing = tr.events.filter((e) => e.kind === 'effect' && String(e.via).startsWith('observation:')).length;
  const corr = tr.events.filter((e) => e.kind === 'correction');
  return {
    'failures (probe flips)': { value: Object.values(tr.probes).reduce((a, p) => a + p.flips, 0), prefer: 'min', level: 'A' },
    'detections': { value: detected, prefer: 'max', level: 'A' },
    'mean correction latency': { value: corr.length ? corr.reduce((a, e) => a + e.correctionLatency, 0) / corr.length : null, prefer: 'min', level: 'A' },
    'observation channels (cost)': { value: channels, prefer: 'min', level: 'B' },
    'sensing operations (resource use)': { value: sensing, prefer: 'min', level: 'B' },
    'description-space changes': { value: tr.stateSpaceLineage.length, prefer: 'min', level: 'C', note: 'fewer = more stable description lineage' },
    'meta-configuration changes': { value: tr.metaLineage.length, prefer: 'min', level: 'D', note: 'fewer = more stable meta lineage' },
    'trace volume (events)': { value: tr.events.length, prefer: 'min', level: 'trace', note: 'recording and storage burden' },
    'recordable distinctions (event kinds)': { value: new Set(tr.events.map((e) => e.kind)).size, prefer: 'max', level: 'D', note: 'what the trace schema lets count as an event' },
  };
}
