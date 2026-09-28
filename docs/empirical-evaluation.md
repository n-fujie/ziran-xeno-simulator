# Empirical evaluation — plan and first dataset selection

Status: **planned; no external data downloaded or used.** Every result so far is a synthetic-world result.

## Order of work

1. Synthetic comparison worlds (done: W1–W5, see [external-comparison.md](external-comparison.md)).
2. One public dataset with time-resolved measurements, a known apparatus, an intervention / excitation record and
   sufficient provenance — selected below, before any comparison is run.
3. Further domains in the stated order of preference: robotics, controlled physical systems, biological time series
   with interventions, market microstructure, institutional event logs. Uncontrolled anecdotal data are excluded.

## Provenance record (§16)

Every imported dataset carries a `DatasetProvenance` record (`comparison/empirical/provenance.ts`) with: source,
version, acquisition date, measurement apparatus, sampling frequency, units, preprocessing (publisher and this
project, separately), missingness, known biases, temporal basis, uncertainty, intervention record and license, plus
the selection rationale and selection risks written before any run. `validateProvenance` rejects records with missing
fields; unknown values must be written as "unknown — reason". Imported data enter through the v0.3.0 external adapter
as configuration-bound observations, not as transparent access to reality.

## Claim boundaries (§18)

A single external dataset supports at most **replayed empirical result**. **Empirically supported generalization**
requires replication across datasets and stronger evidence; the v0.3.0 `promote()` guard refuses it for synthetic
evidence, and `claimFor()` in the comparison code returns *replayed empirical result* for one dataset.

## Selection criteria (§17)

Public availability · clear provenance · known measurement process · intervention history · temporal structure ·
reasonable size · reproducibility. The dataset must **not** be chosen because it is likely to favour Ziran / Xeno.

## First candidate: Cascaded Tanks benchmark

| field | value (verified from the repository landing pages) |
|---|---|
| source | 4TU.ResearchData, DOI 10.4121/12960104; described at nonlinearbenchmark.org |
| title | Cascaded Tanks Benchmark Combining Soft and Hard Nonlinearities |
| version | 1, published 2020-09-21 |
| authors | M. Schoukens, P. Mattsson, T. Wigren, J.-P. Noël |
| license | CC BY-SA 4.0 |
| files | `CascadedTanksFiles.zip` (≈ 7.5 MB; .mat and .csv), setup photo, report `TanksBenchmark.pdf` |
| system | fluid-level control system: two tanks with free outlets fed by a pump; the input drives the pump |
| intervention record | the recorded pump input (estimation and test records) |
| known effects | soft nonlinearity from outflow dynamics and hard nonlinearity from tank overflow (stated by the publisher) |
| to verify after download | sampling period, number of samples, units, sensor type, noise level, missingness — from `TanksBenchmark.pdf`, not from memory |

**Why it fits the criteria.** Public with a DOI, version and license; documented physical setup; the excitation is
part of the data; separate estimation and test records; small; widely used, so strong system-identification
baselines are established.

**Selection risk, stated in advance.** The overflow regime is not captured by a linear-tank model and could look
favourable to description-space mechanisms. Mitigations: (1) predicates and evaluation splits are fixed before the
run (below); (2) established nonlinear system-identification formulations (e.g. NARX and nonlinear state-space models)
are included as baselines, so the comparison is not against a linear strawman; (3) only the publisher's
estimation / test split is used.

## Protocol fixed before the run

- Estimation record for fitting, test record for evaluation, exactly as published; no tuning on the test record.
- Measured for every model class: simulation and one-step prediction error on the test record (the benchmark's
  published figure of merit plus normalized MSE), behaviour in overflow segments reported separately, representation
  cost, generated distinctions (named / unnamed), and information lost in each conversion (raw → state, continuous →
  discrete).
- Model classes: fixed linear model, parameter-adaptive linear model, NARX-style lagged polynomial model, MLP on lag
  windows, v0.3.0 grammar-bounded / grammar morphogenesis / description-space transformation, and a digital-twin
  formulation (state estimation with parameter update).
- Result wording: "on the Cascaded Tanks test record, under configuration C and implementation B, distinction D was
  (not) retained" with claim status *replayed empirical result*.

## Pending

Downloading `CascadedTanksFiles.zip` (≈ 7.5 MB) from 4TU.ResearchData requires the maintainer's approval. After
download, the provenance record is completed from `TanksBenchmark.pdf` and validated before any model is fitted.
