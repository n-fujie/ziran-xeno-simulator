// Offline provenance audit of one stored scientific cycle. It verifies INTERNAL consistency of the recorded
// measurement evidence (partition separation, duplicate or re-labelled acquisitions, status/value coherence,
// absence-versus-failure discipline). It never upgrades synthetic measurements into physical authenticity:
// device-side signatures, external time evidence and resolution are reported as absent/unknown because the
// stored records do not contain them. Reports carry codes and identifiers only, never measured values.
import type { CycleResult } from './runtime.ts';

export interface MeasurementFinding { code: string; measurement?: string; assessment?: string }
export type MeasurementStatusClass = 'detected' | 'not-yet-measured' | 'unmeasurable-or-faulty' | 'apparatus-incompatible' | 'scale-or-resolution-incompatible' | 'boundary-hidden' | 'unrecognized';
export interface MeasurementAuditReport {
  result: string; measurements: number;
  consistency: 'internally-consistent' | 'inconsistent';
  findings: MeasurementFinding[];
  statusClasses: Record<MeasurementStatusClass, number>;
  relations: Record<string, number>;
  /** What the stored records can and cannot establish. Never "authentic" for a synthetic source. */
  evidenceLevel: {
    sources: string[]; authenticity: 'synthetic-internal-consistency-only' | 'not-assessable';
    deviceSideEvidence: 'none'; externalTimeEvidence: 'none'; resolution: 'not-recorded-per-measurement'; physicalIndependence: 'unverified';
  };
}

const CLASS: Record<string, MeasurementStatusClass> = {
  detected: 'detected', pending: 'not-yet-measured', 'not-measured': 'not-yet-measured',
  unmeasurable: 'unmeasurable-or-faulty', 'sensor-fault': 'unmeasurable-or-faulty', inaccessible: 'unmeasurable-or-faulty',
  'apparatus-incompatible': 'apparatus-incompatible',
  'scale-incompatible': 'scale-or-resolution-incompatible', 'temporal-window-incompatible': 'scale-or-resolution-incompatible', 'below-resolution': 'scale-or-resolution-incompatible',
  'boundary-hidden': 'boundary-hidden',
};

export function auditCycleMeasurements(result: CycleResult): MeasurementAuditReport {
  const findings: MeasurementFinding[] = [];
  const flag = (code: string, extra: Omit<MeasurementFinding, 'code'> = {}) => { findings.push({ code, ...extra }); };
  const statusClasses: Record<MeasurementStatusClass, number> = { detected: 0, 'not-yet-measured': 0, 'unmeasurable-or-faulty': 0, 'apparatus-incompatible': 0, 'scale-or-resolution-incompatible': 0, 'boundary-hidden': 0, unrecognized: 0 };
  const ids = new Map<string, CycleResult['measurements'][number]>();
  const keys = new Set<string>(), observations = new Map<string, string>();
  const sources = new Set<string>();
  const seed = result.request.seed;
  for (const m of result.measurements) {
    if (ids.has(m.id)) flag('duplicate-measurement-id', { measurement: m.id }); else ids.set(m.id, m);
    if (keys.has(m.acquisitionKey)) flag('duplicate-acquisition-key', { measurement: m.id }); keys.add(m.acquisitionKey);
    sources.add(String(m.source));
    // A target belongs to exactly one partition, and to this cycle's seed: relabelled or reused targets fail here.
    if (!m.target.startsWith(`${m.partition}:${seed}:`)) flag('partition-target-mismatch', { measurement: m.id });
    // The same observation (target, channel, time, device) registered again under a different acquisition identity.
    const observation = `${m.target}|${m.channel}|${m.simulationTime}|${m.deviceSpecHash}`;
    const earlier = observations.get(observation);
    if (earlier !== undefined && earlier !== m.acquisitionKey) flag('same-observation-reregistered', { measurement: m.id });
    observations.set(observation, m.acquisitionKey);
    const cls = CLASS[m.status] ?? 'unrecognized';
    statusClasses[cls]++;
    if (cls === 'unrecognized') flag('unrecognized-status', { measurement: m.id });
    const hasValue = m.value !== null && m.value !== undefined && (typeof m.value !== 'number' || Number.isFinite(m.value));
    if (m.status === 'detected' && !hasValue) flag('detected-without-valid-value', { measurement: m.id });
    if (m.status !== 'detected' && m.value !== null) flag('value-recorded-without-detection', { measurement: m.id });
    if ((m.route === 'Engine.readChannel') !== m.apparatus.startsWith('independent-')) flag('route-apparatus-incoherent', { measurement: m.id });
    if (m.route === 'Engine.ctx.obs' && m.apparatus !== 'science') flag('route-apparatus-incoherent', { measurement: m.id });
    if (m.historyRefs.some((ref) => !result.provenance.historyRefs.includes(ref))) flag('history-reference-outside-provenance', { measurement: m.id });
  }
  const relations: Record<string, number> = {};
  const decisionTargets = new Map<string, string>();
  for (const a of result.assessments) {
    for (const rel of a.relations) relations[rel] = (relations[rel] ?? 0) + 1;
    let allDetected = true;
    for (const id of a.measurementIds) {
      const m = ids.get(id);
      if (!m) { flag('assessment-measurement-missing', { assessment: a.candidate, measurement: id }); continue; }
      if (m.partition !== a.partition) flag('assessment-partition-mismatch', { assessment: a.candidate, measurement: id });
      if (m.status !== 'detected') allDetected = false;
      if (a.partition === 'decision') {
        const owner = decisionTargets.get(m.target);
        if (owner !== undefined && owner !== a.candidate) flag('decision-cohort-shared-between-candidates', { assessment: a.candidate, measurement: id });
        decisionTargets.set(m.target, a.candidate);
      }
    }
    // Failure to measure is never evidence of absence: a determinate comparison needs every reading detected.
    if (a.determinate && !allDetected) flag('determinate-assessment-with-undetected-reading', { assessment: a.candidate });
    if (a.relations.includes('undetermined') && a.determinate) flag('undetermined-relation-marked-determinate', { assessment: a.candidate });
  }
  for (const id of result.intervention?.measurementIds ?? []) if (!ids.has(id)) flag('intervention-measurement-missing', { measurement: id });
  const synthetic = sources.size > 0 && [...sources].every((s) => s === 'synthetic-engine');
  if (sources.size > 0 && !synthetic) flag('unrecognized-measurement-source');
  return {
    result: result.id, measurements: result.measurements.length,
    consistency: findings.length ? 'inconsistent' : 'internally-consistent', findings, statusClasses, relations,
    evidenceLevel: { sources: [...sources].sort(), authenticity: synthetic ? 'synthetic-internal-consistency-only' : 'not-assessable', deviceSideEvidence: 'none', externalTimeEvidence: 'none', resolution: 'not-recorded-per-measurement', physicalIndependence: 'unverified' },
  };
}
