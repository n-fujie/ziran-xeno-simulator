// Synthetic instrument protocol built on the existing Engine, apparatus and intervention APIs.
// No hardware adapter, privileged production sensor or physical transaction is implied.
import { Engine } from '../core/engine.ts';
import type { WorldSpec, ApparatusSpec, AliasingRecord, EpistemicStatus } from '../core/types.ts';
import { seedStream, next } from '../core/rng.ts';
import { candidatesFor, type Candidate } from '../ziran/reviser.ts';
import { hashOf } from '../core/hash.ts';

export const CONDITIONS = ['coupled', 'stable', 'disconnected', 'threshold-shift', 'period-shift', 'sensor-fault', 'intervention-mismatch'] as const;
export type Condition = typeof CONDITIONS[number];
export type Partition = 'generation' | 'decision' | 'evaluation' | 'control';
export type MeasurementStatus = EpistemicStatus | 'sensor-fault' | 'unmeasurable';
export interface Measurement {
  id: string; partition: Partition; source: 'synthetic-engine'; target: string; apparatus: string; channel: string;
  boundary: string[] | null; scale: string; window: number; acquiredAt: string; simulationTime: number;
  historyRefs: string[]; status: MeasurementStatus; value: unknown;
  acquisitionKey: string; route: 'Engine.ctx.obs' | 'Engine.readChannel'; deviceSpecHash: string;
}
export interface Pair { id: string; partition: Partition; engines: [Engine, Engine]; reference: [number, number]; referenceEvidence: Measurement[] }
export interface Proposal { id: string; kinds: Candidate['kind'][]; cost: number; description: string; apply: Candidate['apply']; parent?: string; revision?: string }
const origins = new WeakMap<Engine, { target: string; partition: Partition }>();
function origin(engine: Engine, pair: Pair, index: number) {
  const value = origins.get(engine), expected = origins.get(pair.engines[index]);
  if (!value || !expected || value !== expected || value.partition !== pair.partition || value.target !== `${pair.id}:target-${index}`) throw Error('measurement provenance mismatch: relabelled or reused target');
  return value;
}

export function instrument(): ApparatusSpec {
  return { id: 'science', frameClock: 'sample', channels: [{ id: 'x', clock: 'sample', reads: ['target/x'], resolution: 0, modality: 'scalar' }], memory: 0 };
}

function world(seed: number, h: number, condition: Condition, partition: Partition, pair: number): WorldSpec {
  // Disjoint seed streams, target instances and probe acquisitions. Same streams across methods.
  const sealed = partition === 'evaluation' || partition === 'control';
  const threshold = condition === 'threshold-shift' && sealed ? 3 : 0.5;
  const period = condition === 'period-shift' && sealed ? 3 : 1;
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

export function acquire(seed: number, partition: Partition, condition: Condition, count = 3, slot = 0): Pair[] {
  const stream = seedStream(seed, { generation: 101, decision: 202, evaluation: 303, control: 404 }[partition] + slot * 10007);
  return Array.from({ length: count }, (_, i) => {
    const amplitude = 1 + next(stream);
    const h = condition === 'stable' ? 0 : amplitude;
    const engines = [-h, h].map((value) => new Engine(world(seed, value, condition, partition, i), { reachability: false }));
    const pairId = `${partition}:${seed}:${i}${slot ? `:slot-${slot}` : ''}`;
    engines.forEach((engine, index) => origins.set(engine, { target: `${pairId}:target-${index}`, partition }));
    // An independent reference probe: measured response after the same intervention in each target.
    // The reference probe is never used as a production sensor or passed to proposal generation.
    const referenceEvidence: Measurement[] = [];
    const reference = engines.map((engine, targetIndex) => {
      const probe = engine.fork();
      probe.intervene({ id: 'reference-probe', kind: 'set', t: 0, address: 'target/u', value: 1 });
      probe.run(1);
      const value = probe.readChannel({ id: 'reference', clock: 'sample', reads: ['target/x'] }).value as number;
      referenceEvidence.push({ id: `${pairId}:reference:${targetIndex}`, acquisitionKey: `${pairId}:reference:${targetIndex}`, route: 'Engine.readChannel', deviceSpecHash: hashOf({ reads: ['target/x'], t: 1 }), partition, source: 'synthetic-engine', target: `${pairId}:target-${targetIndex}`, apparatus: 'independent-reference-probe', channel: 'target/x', boundary: ['target/x'], scale: 'scalar-target-units', window: 0, acquiredAt: new Date().toISOString(), simulationTime: 1, historyRefs: [], status: 'detected', value });
      return value;
    }) as [number, number];
    return { id: pairId, partition, engines: engines as [Engine, Engine], reference, referenceEvidence };
  });
}

export function generate(pair: Pair, revision?: { residual: number; rejected: string[] }): Proposal[] {
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
  // Residual-driven bounded structural revision, not merely a reordering of a fixed list.
  // Regenerate against the current graph; an old proposal can expire when its parent disappears.
  if (revision && revision.residual > 0 && revision.rejected.length) for (const parent of out.filter((p) => p.kinds.length === 1 && p.kinds[0] === 'placement')) {
    if (!revision.rejected.includes(parent.id)) continue;
    const channel = `grow:${parent.id.match(/grow sensor to (\S+)/)?.[1]}`;
    out.push({ id: `${parent.id} + measured-absolute`, kinds: [...parent.kinds, 'construct-diff'], cost: parent.cost + 1.5,
      description: 'residual-conditioned composition of placement and absolute-value construction', parent: parent.id, revision: 'unexplained residual + rejected parent',
      apply: (emit) => { parent.apply(emit); emit.apparatus.addChannel('science', { id: `${channel}:abs`, clock: 'sample', reads: [], construct: { op: 'abs', of: [channel] } }); } });
  }
  return out;
}

export function configured(engine: Engine, proposal?: Proposal): Engine {
  // Fresh target acquisitions are owned by the caller. Fork only to evaluate counterfactual apparatus.
  const candidate = engine.fork({ trace: true, recordObservations: true });
  const source = origins.get(engine); if (source) origins.set(candidate, source);
  if (proposal) candidate.intervene({ id: 'science.configure', kind: 'emit', t: candidate.t, apply: (_ctx, emit) => proposal.apply(emit) });
  candidate.run(0);
  return candidate;
}

export function measure(engine: Engine, pair: Pair, targetIndex: number, historyRefs: string[], acquiredAt: string, condition: Condition): Measurement[] {
  const source = origin(engine, pair, targetIndex);
  return engine.apparatus.science.channels.map((channel) => {
    const observation = engine.ctx(null).obs('science', channel.id);
    let status: MeasurementStatus = observation.status;
    if (observation.t !== engine.t) status = 'not-measured';
    if (!channel.construct && channel.reads.length && !channel.reads.some((address) => address.endsWith('*') ? Object.keys(engine.state).some((key) => key.startsWith(address.slice(0, -1))) : address in engine.state)) status = 'unmeasurable';
    if (condition === 'sensor-fault' && channel.reads.includes('target/h')) status = 'sensor-fault';
    return { id: `${pair.id}:${targetIndex}:${observation.t}:${channel.id}`, acquisitionKey: `${source.target}:${observation.t}:${hashOf(channel)}`, route: 'Engine.ctx.obs', deviceSpecHash: hashOf(channel), partition: pair.partition,
      source: 'synthetic-engine', target: `${pair.id}:target-${targetIndex}`, apparatus: 'science', channel: channel.id,
      boundary: channel.boundary ?? null, scale: 'scalar-target-units', window: channel.window ?? 0,
      acquiredAt, simulationTime: observation.t, historyRefs: [...historyRefs], status,
      value: status === 'detected' ? (observation.open ?? observation.value) : null };
  });
}

export function independentMeasurement(engine: Engine, pair: Pair, index: number, address: string, historyRefs: string[]): Measurement {
  const source = origin(engine, pair, index);
  const device = { id: 'independent-control-reference', clock: 'sample', reads: [address] };
  const reading = engine.readChannel(device);
  const status: MeasurementStatus = address in engine.state ? reading.status : 'unmeasurable';
  return { id: `${source.target}:reference:${address}:${engine.t}`, acquisitionKey: `${source.target}:reference:${address}:${engine.t}`, route: 'Engine.readChannel', deviceSpecHash: hashOf(device), partition: pair.partition, source: 'synthetic-engine', target: source.target,
    apparatus: device.id, channel: address, boundary: [address], scale: 'scalar-target-units', window: 0, acquiredAt: new Date().toISOString(), simulationTime: engine.t,
    historyRefs: [...historyRefs], status, value: status === 'detected' ? reading.value : null };
}

export function relation(a: Measurement[], b: Measurement[]): 'difference' | 'no-difference-in-measured-channels' | 'undetermined' {
  const valid = (v: unknown) => v !== null && v !== undefined && (typeof v !== 'number' || Number.isFinite(v));
  const complete = a.length > 0 && a.length === b.length && a.every((x, i) => x.status === 'detected' && b[i].status === 'detected' && valid(x.value) && valid(b[i].value) && x.channel === b[i].channel && x.deviceSpecHash === b[i].deviceSpecHash && x.scale === b[i].scale && x.window === b[i].window && JSON.stringify(x.boundary) === JSON.stringify(b[i].boundary));
  if (!complete) return 'undetermined';
  return a.some((x, i) => JSON.stringify(x.value) !== JSON.stringify(b[i].value)) ? 'difference' : 'no-difference-in-measured-channels';
}
