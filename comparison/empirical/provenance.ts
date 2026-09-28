// Provenance record for external datasets (§16). Every imported dataset must carry all fields; unknown values are
// written as the string 'unknown — <reason>', never left out. Imported data are configuration-bound observations,
// not transparent access to reality.

export interface DatasetProvenance {
  id: string;
  source: string;                 // repository and DOI / URL
  version: string;
  acquisitionDate: string;        // when this project obtained the files (ISO date)
  measurementApparatus: string;
  samplingFrequency: string;
  units: Record<string, string>;
  preprocessing: string;          // by the data publisher and by this project, separately
  missingness: string;
  knownBiases: string;
  temporalBasis: string;
  uncertainty: string;
  interventionRecord: string;     // excitation / perturbation history
  license: string;
  /** Why this dataset was selected, written before any comparison was run (§17). */
  selectionRationale: string[];
  /** Risks that the choice favours one framework, and how they are handled. */
  selectionRisks: string[];
  claimStatusIfUsed: 'replayed empirical result';
}

export const REQUIRED: (keyof DatasetProvenance)[] = ['source', 'version', 'acquisitionDate', 'measurementApparatus', 'samplingFrequency', 'units', 'preprocessing', 'missingness', 'knownBiases', 'temporalBasis', 'uncertainty', 'interventionRecord', 'license'];

/** Returns missing or empty required fields; an empty list means the record is complete (values may still be 'unknown — …'). */
export function validateProvenance(p: Partial<DatasetProvenance>): string[] {
  return REQUIRED.filter((k) => { const v = p[k]; return v === undefined || v === '' || (typeof v === 'object' && !Object.keys(v as object).length); });
}

/** A single dataset supports at most a replayed empirical result; promotion needs replication (§18). */
export function claimFor(datasetsReplicated: number): 'replayed empirical result' | 'unresolved' { return datasetsReplicated >= 1 ? 'replayed empirical result' : 'unresolved'; }

/**
 * First candidate (selected, not yet downloaded). Fields not verifiable from the repository landing pages are marked
 * 'to verify' and must be filled from the dataset's own documentation (TanksBenchmark.pdf) before any run.
 */
export const CASCADED_TANKS: DatasetProvenance = {
  id: 'cascaded-tanks-4tu-12960104',
  source: '4TU.ResearchData, DOI 10.4121/12960104 (landing page: nonlinearbenchmark.org/benchmarks/cascaded-tanks)',
  version: '1 (published 2020-09-21)',
  acquisitionDate: 'not acquired — download requires the maintainer\'s approval',
  measurementApparatus: 'two cascaded tanks with free outlets fed by a pump; water levels measured (sensor type to verify from TanksBenchmark.pdf)',
  samplingFrequency: 'to verify from TanksBenchmark.pdf',
  units: { input: 'pump input signal (unit to verify)', output: 'water level (unit to verify)' },
  preprocessing: 'publisher: estimation / test split supplied; this project: none yet',
  missingness: 'to verify',
  knownBiases: 'hard nonlinearity from tank overflow and soft nonlinearity from outflow dynamics (stated by the publisher); short records',
  temporalBasis: 'uniform sampling (period to verify)',
  uncertainty: 'measurement noise level to verify',
  interventionRecord: 'the pump input signal is the recorded excitation (estimation and test records)',
  license: 'CC BY-SA 4.0',
  selectionRationale: [
    'public, with a DOI, a version and a license',
    'known measurement process and a documented physical setup (photos, video, report)',
    'a recorded input (excitation) history, i.e. interventions are part of the data',
    'temporal structure with separate estimation and test records',
    'small (≈7.5 MB archive) and widely used, so established system-identification baselines exist for comparison',
  ],
  selectionRisks: [
    'The overflow nonlinearity is a regime not captured by a simple linear-tank model; that could appear to favour description-space mechanisms. Mitigation: predicates are fixed before running, and established nonlinear system-identification baselines (e.g. NARX / nonlinear state-space) are included, so the comparison is against strong formulations, not a linear strawman.',
    'Only one physical system; any result is a replayed empirical result for this dataset, not a generalization.',
  ],
  claimStatusIfUsed: 'replayed empirical result',
};
