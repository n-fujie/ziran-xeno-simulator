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

/** First dataset: verified values; the full record is results/external-comparison/cascaded-tanks/provenance.json. */
export const CASCADED_TANKS: DatasetProvenance = {
  id: 'cascaded-tanks-4tu-12960104-v1',
  source: '4TU.ResearchData, DOI 10.4121/12960104.v1',
  version: '1 (published 2020-09-21)',
  acquisitionDate: '2026-09-28',
  measurementApparatus: 'two cascaded tanks fed by a pump; uncalibrated capacitive level sensors; Matlab A/D–D/A interface',
  samplingFrequency: 'Ts = 4 s (0.25 Hz), 1024 samples per record',
  units: { u: 'V (pump voltage)', y: 'V (uncalibrated level sensor)' },
  preprocessing: 'publisher: not documented in supplied source; this project: parsing only',
  missingness: 'none',
  knownBiases: 'short estimation record; uncalibrated sensors; unknown initial state; stochastic overflow; single setup',
  temporalBasis: 'uniform sampling at 4 s; absolute start times not documented in supplied source',
  uncertainty: 'output SNR close to 40 dB; overflow acts as input-dependent process noise',
  interventionRecord: 'designed multisine excitation (estimation and test records); no randomized interventions',
  license: 'CC BY-SA 4.0',
  selectionRationale: [
    'public, with a DOI, a version and a license',
    'known measurement process and a documented physical setup',
    'a recorded input (excitation) history',
    'separate estimation and test records',
    'small and widely used, so established system-identification baselines exist',
  ],
  selectionRisks: [
    'The overflow nonlinearity could appear to favour description-space mechanisms; mitigated by a pre-registered protocol and strong conventional baselines (ARX, output-error, NARX, grey-box with overflow, switching ARX, twin, MLP).',
    'One physical system: results are replayed empirical results for this dataset only.',
  ],
  claimStatusIfUsed: 'replayed empirical result',
};
