// Claim status: every output says what kind of claim it is. Synthetic-world results are never promoted
// automatically to empirical generalizations, and evidence labels are never mixed silently.
export type ClaimStatus = 'implementation property' | 'synthetic-world result' | 'model-class discrimination' | 'reconstruction inference' | 'replayed empirical result' | 'empirical observation' | 'empirically supported generalization' | 'unresolved';
export type EvidenceLabel = 'synthetic' | 'replayed-empirical' | 'live-observational' | 'intervention-derived';

export interface Claim { statement: string; status: ClaimStatus; evidence: EvidenceLabel[]; basis?: string }

export function claim(statement: string, status: ClaimStatus, evidence: EvidenceLabel[] = ['synthetic'], basis?: string): Claim {
  return { statement, status, evidence, basis };
}

/** Refuses promotions that the evidence does not license. */
export function promote(c: Claim, to: ClaimStatus): Claim {
  if (to === 'empirically supported generalization' && !c.evidence.some((e) => e !== 'synthetic')) throw new Error('refused: a synthetic-world result cannot be promoted to an empirically supported generalization');
  if (to === 'empirical observation' && c.evidence.every((e) => e === 'synthetic')) throw new Error('refused: no empirical evidence attached');
  return { ...c, status: to };
}

/** Aggregates results only within one evidence label unless mixing is explicitly requested and marked. */
export function summarize<T extends { evidence?: EvidenceLabel }>(results: T[], o: { allowMixed?: boolean } = {}): { byEvidence: Record<string, T[]>; mixed: boolean; note: string } {
  const by: Record<string, T[]> = {};
  for (const r of results) (by[r.evidence ?? 'synthetic'] ??= []).push(r);
  const mixed = Object.keys(by).length > 1;
  if (mixed && !o.allowMixed) throw new Error(`refused: results carry different evidence labels (${Object.keys(by).join(', ')}); summarize separately or pass allowMixed`);
  return { byEvidence: by, mixed, note: mixed ? 'MIXED EVIDENCE — labels shown per group' : `single evidence label: ${Object.keys(by)[0] ?? 'none'}` };
}

export const EVIDENCE_STATUS = 'Only synthetic data exist in this repository; the external adapter is ready for replayed empirical data but none is bundled.';
