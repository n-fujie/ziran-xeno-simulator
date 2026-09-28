# Empirical evaluation — plan and first dataset selection

Status: **dataset acquired and verified (2026-09-28); protocol CT-P1 frozen before any model was implemented or
fitted.** The protocol-freeze commit is the commit that adds this section and
`results/external-comparison/cascaded-tanks/protocol.json`; its hash is recorded in
[cascaded-tanks-results.md](cascaded-tanks-results.md). Results so far in this repository other than Cascaded Tanks
are synthetic-world results.

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

## First dataset: Cascaded Tanks benchmark

Acquired from the primary archive (4TU.ResearchData, DOI 10.4121/12960104.v1, CC BY-SA 4.0) by
`comparison/empirical/fetch-cascaded-tanks.ts`; publisher MD5 verified; SHA-256 recorded. Full record:
[cascaded-tanks-provenance.md](cascaded-tanks-provenance.md) and
`results/external-comparison/cascaded-tanks/provenance.json`. Raw and derived files stay outside git
(`data/external/**/raw|derived`).

Verified from `TanksBenchmark.pdf`: Ts = 4 s; 1024 samples per record; one estimation and one test record; input =
pump voltage (V), output = lower-tank water level from an uncalibrated capacitive sensor (V); SNR ≈ 40 dB; unknown
initial state, the same for both records; test data must not be used during estimation; report e_RMSt for simulation
and/or prediction.

**Why it fits the criteria.** Public with a DOI, version and license; documented physical setup; the excitation is part
of the data; separate estimation and test records; small; widely used, so strong system-identification baselines are
established.

**Selection risk, stated before acquisition.** The overflow regime could look favourable to description-space
mechanisms. Mitigations: predicates fixed in advance; strong conventional baselines (ARX, output-error, NARX, grey-box
with the documented physics and overflow, switching ARX, twin with EKF, MLP); the publisher's split only.

**Replay vs intervention.** The recorded input is a designed multisine excitation, not a randomized intervention, and
there are no recorded outcomes for altered inputs. Replay fidelity is a *replayed empirical result*; counterfactual
simulations are reported as unvalidated model outputs only.

## Protocol CT-P1 (frozen)

The machine-readable protocol is `results/external-comparison/cascaded-tanks/protocol.json`. In summary:

- **Trajectories.** Estimation record (uEst, yEst) for fitting and selection; test record (uVal, yVal) evaluated once.
- **Split.** Fit on estimation samples 1–768, select hyperparameters on 769–1024, refit on all 1024, then test.
- **Preprocessing / normalization.** None beyond parsing; MLP standardized with estimation statistics.
- **Initialization.** Input–output models seed simulation with their first L measured outputs (counted in e_RMSt,
  excluded in the secondary RMSE); state-space and grey-box models estimate initial states on the estimation record
  and reuse them (licensed by the documentation).
- **Modes.** Simulation and one-step prediction, both where the model allows.
- **Metrics.** Primary e_RMSt on all test samples per mode; secondary RMSE without the initialization window, MAE,
  fit %; regime RMSE in the bands y ≥ 9.0 V and y < 9.0 V (band chosen from the documentation's Figure 2 before
  fitting; evaluation only).
- **Models.** M1 ARX · M2 second-order output-error (linear state-space, MPC-compatible) · M3 polynomial NARX ·
  M4a grey-box from the documented equations · M4b grey-box with overflow saturation · M5 digital twin (M4b + EKF,
  state updates only) · M6 NARX-MLP (seeds 1–5) · M7 switching / piecewise ARX (fairness extension) · Z Ziran / Xeno
  adapter (v0.3.0 external adapter + grammar morphogenesis, one-step prediction only) with five ablations.
- **Selection / stopping.** Validation simulation RMSE; Nelder–Mead 5 multi-starts ≤ 4000 evaluations; MLP 500
  epochs; morphogenesis 3 rounds.
- **Fairness rule.** Any Ziran improvement is checked against conventional extensions on the same metric.
- **Questions.** Q1 replay fidelity · Q2 regime bands · Q3 near-identical observations with divergent successors
  (empirical observation) and per-model insufficiency signals · Q4 whether generated variables change held-out error ·
  Q5 input–output lag (descriptive; no too-late analysis, as no corrections are recorded).
- **Counterfactual.** One demonstration (test input × 1.2) reported as unvalidated model output.
- **Exclusions / changes.** None planned; anything after the freeze is an exploratory follow-up that does not overwrite
  the pre-registered results.
- **RL and active inference** are not applied: the dataset records a designed excitation with no task, reward or
  preference structure; forcing either onto replay would be an artificial formulation.
