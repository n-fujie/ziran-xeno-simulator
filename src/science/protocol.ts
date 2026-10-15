// Synthetic instrument protocol built on the existing Engine, apparatus and intervention APIs.
// No hardware adapter, privileged production sensor or physical transaction is implied.
import { Engine } from '../core/engine.ts';
import type { WorldSpec, ApparatusSpec, AliasingRecord, EpistemicStatus } from '../core/types.ts';
import { seedStream, next } from '../core/rng.ts';
import { candidatesFor, type Candidate } from '../ziran/reviser.ts';

export const CONDITIONS = ['coupled', 'stable', 'disconnected', 'threshold-shift', 'period-shift', 'sensor-fault', 'intervention-mismatch'] as const;
export type Condition = typeof CONDITIONS[number];
export type Partition = 'generation' | 'decision' | 'evaluation';
export type MeasurementStatus = EpistemicStatus | 'sensor-fault' | 'unmeasurable';
export interface Measurement {
  id: string; partition: Partition; source: 'synthetic-engine'; target: string; apparatus: string; channel: string;
  boundary: string[] | null; scale: string; window: number; acquiredAt: string; simulationTime: number;
  historyRefs: string[]; status: MeasurementStatus; value: unknown;
}
export interface Pair { id: string; partition: Partition; engines: [Engine, Engine]; reference: [number, number]; referenceEvidence: Measurement[] }
export interface Proposal { id: string; kinds: Candidate['kind'][]; cost: number; description: string; apply: Candidate['apply']; parent?: string }

export function instrument(): ApparatusSpec {
  return { id: 'science', frameClock: 'sample', channels: [{ id: 'x', clock: 'sample', reads: ['target/x'], resolution: 0, modality: 'scalar' }], memory: 0 };
}

function world(seed: number, h: number, condition: Condition, partition: Partition, pair: number): WorldSpec {
  // Disjoint seed streams, target instances and probe acquisitions. Same streams across methods.
  const threshold = condition === 'threshold-shift' && partition === 'evaluation' ? 3 : 0.5;
  const period = condition === 'period-shift' && partition === 'evaluation' ? 3 : 1;
  return {
    id: `science:${condition}:${partition}:${pair}`, seed, horizon: 3,
    state: { 'target/x': 0, 'target/h': h, 'target/u': 0 },
    clocks: [{ id: 'sample', period: 1 }], apparatus: [instrument()],
    couplings: condition === 'disconnected' ? [] : [{ id: 'adjacency', from: 'target/x', to: 'target/h', gain: 0 }],
    rules: [{ id: 'target.transition', clock: 'sample', when: (c) => c.t > 0,
      then: (c, e) => {
        const gain = condition === 'intervention-mismatch' ? -1 : 1;
        const hidden = c.get('target/h');
        const signal = condition === 'threshold-shift' ? (Math.abs(hidden) >= threshold ? hidden : 0)
          : condition === 'period-shift' ? (Math.floor(c.t / period) % 2 === 1 ? hidden : 0) : hidden;
        e.add('target/x', gain * signal * c.get('target/u'));
      } }],
    interventions: [],
  };
}

export function acquire(seed: number, partition: Partition, condition: Condition, count = 3): Pair[] {
  const stream = seedStream(seed, { generation: 101, decision: 202, evaluation: 303 }[partition]);
  return Array.from({ length: count }, (_, i) => {
    const amplitude = 1 + next(stream);
    const h = condition === 'stable' ? 0 : amplitude;
    const engines = [-h, h].map((value) => new Engine(world(seed, value, condition, partition, i), { reachability: false }));
    // An independent reference probe: measured response after the same intervention in each target.
    // The reference probe is never used as a production sensor or passed to proposal generation.
    const referenceEvidence: Measurement[] = [];
    const reference = engines.map((engine, targetIndex) => {
      const probe = engine.fork();
      probe.intervene({ id: 'reference-probe', kind: 'set', t: 0, address: 'target/u', value: 1 });
      probe.run(1);
      const value = probe.readChannel({ id: 'reference', clock: 'sample', reads: ['target/x'] }).value as number;
      referenceEvidence.push({ id: `${partition}:${seed}:${i}:reference:${targetIndex}`, partition, source: 'synthetic-engine', target: `${partition}:${seed}:${i}:target-${targetIndex}`, apparatus: 'independent-reference-probe', channel: 'target/x', boundary: ['target/x'], scale: 'scalar-target-units', window: 0, acquiredAt: new Date().toISOString(), simulationTime: 1, historyRefs: [], status: 'detected', value });
      return value;
    }) as [number, number];
    return { id: `${partition}:${seed}:${i}`, partition, engines: engines as [Engine, Engine], reference, referenceEvidence };
  });
}

export function generate(pair: Pair): Proposal[] {
  const [a, b] = pair.engines;
  const record: AliasingRecord = { apparatus: 'science', key: 'same-x', sig: 'reference-probe', next: pair.reference.map(String) as [string, string], t: [0, 0], snapshots: [a.state, b.state], previous: [null, null], seq: 0 };
  const basic = candidatesFor(a.apparatus.science, record, a.ctx(null));
  const out: Proposal[] = basic.map((candidate) => ({ id: candidate.description, description: candidate.description, kinds: [candidate.kind], cost: candidate.cost, apply: candidate.apply }));
  // Conditional composition of existing generation operations, with explicit lineage.
  // This expands a supplied grammar, not an invention of arbitrary sensing physics.
  for (const parent of basic.filter((c) => c.kind === 'placement')) {
    const refine = basic.find((c) => c.kind === 'sampling');
    if (refine) out.push({ id: `${parent.description} + ${refine.description}`, description: 'composed placement and sampling', kinds: [parent.kind, refine.kind], cost: parent.cost + refine.cost, parent: parent.description,
      apply: (emit) => { parent.apply(emit); refine.apply(emit); } });
  }
  return out;
}

export function configured(engine: Engine, proposal?: Proposal): Engine {
  // Fresh target acquisitions are owned by the caller. Fork only to evaluate counterfactual apparatus.
  const candidate = engine.fork({ trace: true, recordObservations: true });
  if (proposal) candidate.intervene({ id: 'science.configure', kind: 'emit', t: candidate.t, apply: (_ctx, emit) => proposal.apply(emit) });
  candidate.run(0);
  return candidate;
}

export function measure(engine: Engine, pair: Pair, targetIndex: number, historyRefs: string[], acquiredAt: string, condition: Condition): Measurement[] {
  return engine.apparatus.science.channels.map((channel) => {
    const observation = engine.ctx(null).obs('science', channel.id);
    let status: MeasurementStatus = observation.status;
    if (!channel.construct && channel.reads.length && !channel.reads.some((address) => address.endsWith('*') ? Object.keys(engine.state).some((key) => key.startsWith(address.slice(0, -1))) : address in engine.state)) status = 'unmeasurable';
    if (condition === 'sensor-fault' && channel.reads.includes('target/h')) status = 'sensor-fault';
    return { id: `${pair.id}:${targetIndex}:${engine.t}:${channel.id}`, partition: pair.partition,
      source: 'synthetic-engine', target: `${pair.id}:target-${targetIndex}`, apparatus: 'science', channel: channel.id,
      boundary: channel.boundary ?? null, scale: 'scalar-target-units', window: channel.window ?? 0,
      acquiredAt, simulationTime: engine.t, historyRefs: [...historyRefs], status,
      value: status === 'detected' ? (observation.open ?? observation.value) : null };
  });
}

export function relation(a: Measurement[], b: Measurement[]): 'difference' | 'no-difference-in-measured-channels' | 'undetermined' {
  const complete = a.length === b.length && a.every((x, i) => x.status === 'detected' && b[i].status === 'detected');
  if (!complete) return 'undetermined';
  return a.some((x, i) => JSON.stringify(x.value) !== JSON.stringify(b[i].value)) ? 'difference' : 'no-difference-in-measured-channels';
}
