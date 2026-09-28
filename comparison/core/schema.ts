// Framework-neutral comparison record (External Framework Comparison, research branch).
//
// Frameworks run in their own terms; this schema is filled *after* execution, for comparison only. Nothing here
// is used inside a framework's computation. There is deliberately no score, rank or winner field.

export type ClaimStatus =
  | 'implementation property' | 'synthetic-world result' | 'model-class discrimination'
  | 'replayed empirical result' | 'empirical observation' | 'empirically supported generalization' | 'unresolved';

export type FrameworkFamily =
  | 'agent-based-modeling' | 'control-mpc' | 'reinforcement-learning' | 'active-inference'
  | 'digital-twin' | 'dynamical-systems' | 'viability-reachability' | 'feature-learning' | 'ziran-xeno';

/** One conversion between representations, with what it keeps and loses (§22). */
export interface Conversion {
  from: string; to: string;
  retained: string[]; lost: string[]; newlyAvailable: string[]; unresolved: string[];
}

/** What had to be supplied before the run (§20). `wrongWhen` states what happened when it was wrong, if tested. */
export interface Burden {
  item: 'state-variables' | 'agents' | 'goals' | 'reward' | 'dynamics' | 'graph-topology' | 'observation-model' | 'preferences' | 'boundary' | 'action-set' | 'hidden-factors' | 'feature-window' | 'grammar' | 'schedule' | 'other';
  supplied: string;
  enabled: string;
  prevented: string;
  wrongWhen?: string;
}

/** Revision costs (§21). Units are stated; null = not applicable. */
export interface AdaptationCost {
  computeMs: number; modelEvaluations: number | null; dataSteps: number; observationsUsed: number;
  interventionCount: number; memoryItems: number | null; representationComplexity: number | null;
  note?: string;
}

/** The per-framework profile required instead of a global score (§3). */
export interface FrameworkProfile {
  preserves: string[]; merges: string[]; cannotExpress: string[];
  detectsEarlier: string[]; detectsLater: string[]; requiresPredefined: string[];
  canRevise: string[]; inaccessible: string[]; interventionDifferences: string[];
}

/** Fairness check (§25): could the baseline represent the distinction if configured differently? */
export interface FairnessCheck {
  distinction: string;
  firstConfiguration: string;
  alternativeConfiguration: string;
  alternativeTested: boolean;
  retainedUnderAlternative: boolean | null;
  note: string;
}

export interface ComparisonRecord {
  world: string;
  framework: FrameworkFamily;
  configuration: string;
  /** true when this configuration exists to test a fairness question or is an ablation of Ziran / Xeno. */
  role: 'primary' | 'fairness' | 'ablation' | 'budget-sensitivity';
  representationSupplied: string[];
  representationGenerated: string[];
  observationsSupplied: string[];
  observationsRevised: string[];
  interventions: string[];
  detectedDifferences: string[];
  inaccessibleDifferences: string[];
  branchChanges: string[];
  timing: Record<string, number | string | null>;
  failures: string[];
  resourceUse: Record<string, number>;
  reorganization: string[];
  modelRevisions: string[];
  descriptionRevisions: string[];
  /** World-specific measurements, named in the world's own measurement list. */
  measurements: Record<string, number | string | boolean | null | (number | string)[]>;
  burden: Burden[];
  cost: AdaptationCost;
  conversions: Conversion[];
  profile: FrameworkProfile;
  claimStatus: ClaimStatus;
  notes: string[];
}

/** Matched conditions for one world (§2). Sameness is stated per level, never inferred from labels. */
export interface MatchedConditions {
  world: string;
  inputData: string; initialConditions: string; interventionHistory: string; temporalHorizon: string;
  computationalBudget: string; observationAvailability: string; measurementResolution: string;
  resourceConstraints: string; evaluationWindow: string;
  sameness: { framework: string; sameRawSource: boolean; samePreprocessing: boolean; sameObservation: boolean; sameStateRepresentation: boolean; sameIntervention: boolean; sameOperationalEffect: boolean | null; transformation: string }[];
}

export interface WorldResult {
  world: string;
  question: string;
  design: string;
  matched: MatchedConditions;
  records: ComparisonRecord[];
  fairness: FairnessCheck[];
  /** Statements of the form "under configuration C and implementation B, distinction D was (not) retained". */
  statements: string[];
  /** Per distinction, which configurations retained it (no aggregation across distinctions). */
  distinctionTable: { distinction: string; retainedBy: string[]; notRetainedBy: string[]; notApplicable: string[] }[];
  notApplicable: { framework: FrameworkFamily; reason: string }[];
  /** Non-framework reference points (e.g. a passive policy) that put measurements in context. */
  references: Record<string, number | string>;
  claimStatus: ClaimStatus;
}

export const emptyProfile = (): FrameworkProfile => ({ preserves: [], merges: [], cannotExpress: [], detectsEarlier: [], detectsLater: [], requiresPredefined: [], canRevise: [], inaccessible: [], interventionDifferences: [] });

export function baseRecord(world: string, framework: FrameworkFamily, configuration: string, role: ComparisonRecord['role'] = 'primary'): ComparisonRecord {
  return {
    world, framework, configuration, role,
    representationSupplied: [], representationGenerated: [], observationsSupplied: [], observationsRevised: [], interventions: [],
    detectedDifferences: [], inaccessibleDifferences: [], branchChanges: [], timing: {}, failures: [], resourceUse: {},
    reorganization: [], modelRevisions: [], descriptionRevisions: [], measurements: {}, burden: [],
    cost: { computeMs: 0, modelEvaluations: null, dataSteps: 0, observationsUsed: 0, interventionCount: 0, memoryItems: null, representationComplexity: null },
    conversions: [], profile: emptyProfile(), claimStatus: 'synthetic-world result', notes: [],
  };
}

/** "Under configuration C and implementation B, distinction D was (not) retained." (§28 default wording.) */
export function statement(c: string, b: string, d: string, retained: boolean | null, detail = ''): string {
  const v = retained === null ? 'was not evaluable' : retained ? 'was retained' : 'was not retained';
  return `under configuration ${c} and implementation ${b}, distinction "${d}" ${v}${detail ? ` (${detail})` : ''}`;
}

/** Builds the per-distinction table from records; `has(record)` returns null for not applicable. */
export function distinctionRow(distinction: string, records: ComparisonRecord[], has: (r: ComparisonRecord) => boolean | null) {
  const retainedBy: string[] = [], notRetainedBy: string[] = [], notApplicable: string[] = [];
  for (const r of records) { const v = has(r); (v === null ? notApplicable : v ? retainedBy : notRetainedBy).push(`${r.framework}:${r.configuration}`); }
  return { distinction, retainedBy, notRetainedBy, notApplicable };
}
