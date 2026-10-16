// Offline audit of the evidence chain across stored cycles:
//   measurement -> adoption decision -> adoption -> final evaluation -> intervention -> re-measurement
//   -> durable history -> later candidate generation.
// It verifies that every link in the RECORDS is present, ordered and resolvable. It does not (and cannot, from the
// records alone) establish that history improved any later outcome: that needs a matched control, which a single
// ledger does not contain. It reports where history demonstrably changed the candidate set, and nothing more.
import type { LedgerEntry } from './store.ts';
import type { CycleResult } from './runtime.ts';

export interface ChainFinding { code: string; operation: string }
export interface EvidenceChainReport {
  cycles: number; findings: ChainFinding[];
  links: { measuredDecisions: number; adoptions: number; evaluatedAdoptions: number; interventions: number; remeasuredInterventions: number; writeAheadEffects: number };
  history: {
    cyclesWithHistory: number; unresolvedReferences: number;
    /** History demonstrably altered the candidate set (expired or regenerated candidates). */
    cyclesWhereHistoryChangedCandidates: number;
    /** The adopted candidate was one that history-conditioned revision regenerated. */
    cyclesAdoptingHistoryRegeneratedCandidate: number;
    performanceAdvantage: 'not-established-by-the-record-alone';
  };
}

const isCycle = (e: LedgerEntry): e is LedgerEntry & { data: CycleResult } => (e.kind === 'completed' || e.kind === 'quarantined') && (e.data as CycleResult | null)?.version === 2;

export function auditEvidenceChain(entries: LedgerEntry[]): EvidenceChainReport {
  const findings: ChainFinding[] = [];
  const links = { measuredDecisions: 0, adoptions: 0, evaluatedAdoptions: 0, interventions: 0, remeasuredInterventions: 0, writeAheadEffects: 0 };
  const history = { cyclesWithHistory: 0, unresolvedReferences: 0, cyclesWhereHistoryChangedCandidates: 0, cyclesAdoptingHistoryRegeneratedCandidate: 0, performanceAdvantage: 'not-established-by-the-record-alone' as const };
  const earlier = new Set<string>();
  let cycles = 0;
  for (const entry of entries) {
    if (!isCycle(entry)) continue;
    cycles++;
    const r = entry.data, flag = (code: string) => findings.push({ code, operation: entry.operation });
    const byId = new Map(r.measurements.map((m) => [m.id, m]));
    const assessed = (partition: string, candidate: string) => r.assessments.find((a) => a.partition === partition && a.candidate === candidate);

    // measurement -> decision
    for (const d of r.decisions) {
      const a = assessed('decision', d.candidate);
      if (!a || a.measurementIds.length === 0 || a.measurementIds.some((id) => !byId.has(id))) flag('decision-without-measured-assessment'); else links.measuredDecisions++;
    }
    // decision -> adoption
    const accepted = r.decisions.filter((d) => d.accepted);
    if (accepted.length > 1) flag('multiple-accepted-candidates');
    if (r.selected !== null && !accepted.some((d) => d.candidate === r.selected)) flag('selected-without-accepted-decision');
    if (r.selected === null && accepted.length) flag('accepted-without-selection');
    if (r.selected !== null) links.adoptions++;
    // adoption -> final evaluation
    const evaluation = assessed('evaluation', r.selected ?? 'fixed');
    if (!evaluation) flag('missing-final-evaluation');
    else {
      if (r.selected !== null) links.evaluatedAdoptions++;
      const verified = r.selected !== null && evaluation.determinate && evaluation.score === 1;
      if (r.adoptionVerified && !verified) flag('adoption-verified-without-perfect-evaluation');
      if ((evaluation.determinate ? evaluation.score : null) !== r.finalScore) flag('final-score-not-from-evaluation');
    }
    // adoption -> intervention -> re-measurement
    const phases = entries.filter((e) => e.operation === entry.operation && e.kind === 'event').map((e) => (e.data as { phase: string }).phase);
    const before = (a: string, b: string) => phases.includes(a) && phases.includes(b) && phases.indexOf(a) < phases.indexOf(b);
    if (r.intervention) {
      links.interventions++;
      if (!r.adoptionVerified || r.selected === null) flag('intervention-without-verified-adoption');
      if (r.intervention.measurementIds.some((id) => !byId.has(id))) flag('intervention-measurement-missing');
      const refs = r.intervention.measurementIds.map((id) => byId.get(id)).filter((m) => m && m.route === 'Engine.readChannel' && m.channel === 'target/x');
      if (refs.length >= 2 && refs[0]!.simulationTime < refs[refs.length - 1]!.simulationTime && refs.every((m) => m!.status === 'detected')) links.remeasuredInterventions++; else flag('intervention-not-remeasured-independently');
      if (r.intervention.consistent && (r.intervention.actualChange === null || Math.abs(r.intervention.actualChange - r.intervention.expectedChange) >= 1e-8)) flag('consistent-intervention-contradicts-measurement');
      if (!before('intervention-issued', 'intervention-remeasured')) flag('intervention-not-written-ahead'); else links.writeAheadEffects++;
    }
    if (r.connection.connected && !before('connect-issued', 'connect-confirmed')) flag('connect-not-written-ahead');
    if (r.connection.disconnected && !before('disconnect-issued', 'disconnect-confirmed')) flag('disconnect-not-written-ahead');
    // durable history -> later generation
    if (r.provenance.historyRefs.length) {
      history.cyclesWithHistory++;
      for (const ref of r.provenance.historyRefs) {
        // Only entries already seen (earlier in the chain) can be resolved, so a reference to a later or unknown entry fails here.
        if (!earlier.has(ref)) { history.unresolvedReferences++; flag('history-reference-unresolved'); }
      }
      const changed = r.generationRevision.expired.length > 0 || r.generationRevision.regenerated.length > 0;
      if (changed) history.cyclesWhereHistoryChangedCandidates++;
      if (r.selected !== null && r.generationRevision.regenerated.includes(r.selected)) history.cyclesAdoptingHistoryRegeneratedCandidate++;
      if (!/history/.test(r.reorganization.origin)) flag('history-used-but-origin-not-recorded');
    } else if (/history/.test(r.reorganization.origin)) flag('history-origin-recorded-without-references');
    earlier.add(entry.hash);
  }
  return { cycles, findings, links, history };
}
