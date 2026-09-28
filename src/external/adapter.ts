// External empirical interface (no empirical validation is claimed).
// External data enter as *configuration-bound observations*: each channel is replayed into storage at its
// recorded times, observed through an apparatus whose declared sampling regime, missingness and uncertainty
// are part of the configuration — never as unquestioned ground truth. Nothing here executes in the world:
// no live trading and no autonomous real-world actuation.
import type { WorldSpec, Intervention } from '../core/types.ts';
import type { EvidenceLabel } from '../meta/claims.ts';

export interface ExternalChannel { id: string; unit?: string; samples: [number, number | null][] }

export interface ExternalObservationSet {
  source: string;
  domain: 'physical-experiment' | 'market-data' | 'biological-measurement' | 'robotics-trace' | 'institutional-event-log' | string;
  samplingRegime: string;
  missingness: string;
  apparatus: string;
  timebase: string;
  uncertainty: string;
  provenance: string;
  /** Preprocessing applied before import (filtering, resampling, alignment, …); 'none recorded' if unknown. */
  preprocessing?: string;
  evidence: Exclude<EvidenceLabel, 'synthetic'> | 'synthetic';
  channels: ExternalChannel[];
}

/** Build a replay world: storage `ext/<id>` receives recorded values; missing samples stay missing (not zero). */
export function replaySpec(set: ExternalObservationSet, o: { horizon?: number; resolution?: number } = {}): WorldSpec {
  const ivs: Intervention[] = [];
  let tMax = 0;
  const state: Record<string, unknown> = {};
  for (const ch of set.channels) {
    state[`ext/${ch.id}`] = { kind: 'unknown', about: 'not yet sampled' };
    for (const [t, v] of ch.samples) {
      tMax = Math.max(tMax, t);
      ivs.push(v === null
        ? { id: `miss:${ch.id}@${t}`, t, kind: 'set', address: `ext/${ch.id}`, value: { kind: 'unknown', about: 'missing sample' } }
        : { id: `rec:${ch.id}@${t}`, t, kind: 'set', address: `ext/${ch.id}`, value: v });
    }
  }
  return {
    id: `external:${set.source}`, seed: 0, horizon: o.horizon ?? tMax,
    params: { evidence: set.evidence },
    config: [
      { key: 'source', value: set.source, status: 'specified' }, { key: 'domain', value: set.domain, status: 'specified' },
      { key: 'sampling-regime', value: set.samplingRegime, status: 'specified' }, { key: 'missingness', value: set.missingness, status: 'partial' },
      { key: 'measurement-apparatus', value: set.apparatus, status: 'partial' }, { key: 'timebase', value: set.timebase, status: 'specified' },
      { key: 'uncertainty', value: set.uncertainty, status: 'partial' }, { key: 'provenance', value: set.provenance, status: 'specified' },
      { key: 'preprocessing', value: set.preprocessing ?? 'none recorded', status: set.preprocessing ? 'specified' : 'unknown' },
    ],
    state, clocks: [{ id: 'replay', period: 1, label: `replay (${set.timebase})` }], rules: [], interventions: ivs,
    apparatus: [{ id: 'external', label: `recorded apparatus: ${set.apparatus}`, channels: set.channels.map((ch) => ({ id: ch.id, clock: 'replay', reads: [`ext/${ch.id}`], resolution: o.resolution ?? 0, modality: 'recorded' })) }],
  };
}

/** Parse a CSV with header `t,<channel>,...`; empty cells are missing. */
export function fromCSV(csv: string, meta: Omit<ExternalObservationSet, 'channels'>): ExternalObservationSet {
  const [head, ...rows] = csv.trim().split(/\r?\n/);
  const cols = head.split(',').map((x) => x.trim());
  const chans: ExternalChannel[] = cols.slice(1).map((id) => ({ id, samples: [] }));
  for (const r of rows) { const cells = r.split(','); const t = Number(cells[0]); cells.slice(1).forEach((c, i) => chans[i].samples.push([t, c.trim() === '' ? null : Number(c)])); }
  return { ...meta, channels: chans };
}
