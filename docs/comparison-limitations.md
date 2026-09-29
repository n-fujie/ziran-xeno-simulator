# Limitations of the external comparison

These limitations apply to the first deliverable (five synthetic worlds). They bound every statement in
[external-results.md](external-results.md).

## Evidence

- **Synthetic worlds only.** Every result has claim status *synthetic-world result*. No external data have been
  used yet; see [empirical-evaluation.md](empirical-evaluation.md).
- **One implementation per formulation, written by the same author as the simulator.** Baselines are standard
  formulations implemented minimally; a specialist in each framework could configure them better. Fairness
  configurations address the most obvious omissions, not all of them.
- **Few seeds** (3–5 per world). Differences smaller than the per-seed spread in the JSON files should not be read.
- **Computational budget is recorded, not equalized.** Wall time and model evaluations differ by orders of
  magnitude between configurations.

## World design

- **The worlds were designed by the same author** and each targets a distinction the Ziran / Xeno framework names
  (aliasing, too-late correction, fragility transfer, description-space change, thick categories). Worlds chosen by
  proponents of other frameworks could look different.
- **Supplied knowledge** is identical across frameworks but not neutral: W2 supplies the plant delays to the
  delay-aware controllers and the adapter; W3 supplies a published demand schedule; W5 supplies account labels.
- **Evaluation definitions are choices.** W2's "correct at issue" penalizes anticipatory corrections that are effective
  at landing (reported separately as realized effect). W3's "new closure" depends on the recovery policy set; both
  definitions are reported. W1's latency has an estimate-based and a behaviour-based definition.
- **Passive reference.** In W1 a passive policy (u ≡ 0) already reaches 0.891; gains are small relative to that
  reference.

## Changes made after first runs (disclosed)

- **W4 calibration.** The first draft used persistence 0.5, where y's own autoregression explained ≈ 89% of
  regime-2 variance for every model; it was lowered to 0.2 before conclusions were drawn. The change affects all
  model classes identically.
- **W3 Ziran adapter regions.** The first draft mixed observed and model-predicted channels in the adapter's regions,
  which let the lost C meter hide C's transferred risk. Regions were redefined on predicted channels only, with
  observation loss analyzed separately through the description-space diff. This change applies only to the Ziran
  adapter and improved its detections; it is reported as a design correction, and the mixed-region behaviour is kept
  as a documented v0.3.0 property ("observation loss can hide transferred risk").
- **W1 labelling.** An aliasing record was first counted as a model revision; it is now a detection only.
- **W1 active inference.** The planning code was rewritten before any results were read (open-loop policies could not
  value sensing).

## Mapping into the common schema

- The common schema is filled after execution. Mapping, for example, `fragilityTransfer`'s transfer kinds or a twin's
  sync-gap log into the six W3 items is an interpretive step; the mappings are in the code and the evidence strings
  are kept in each record.
- "Registers" means the framework's outputs contain the difference, not that a practitioner using the framework would
  necessarily look at it.

## What these results do not show

- They do not show that any framework is generally better or worse than another.
- They do not show that any existing framework "cannot" represent a distinction; where a first configuration did not
  retain one, the fairness configuration or an explicit note says what was tested.
- They do not validate the Ziran / Xeno framework; they locate, in five synthetic worlds, where its mechanisms made a
  measured difference (W1 observation revision, W2 clocks, W3 fragility analysis and open values, W5 open values) and
  where they did not (W4 meta-grammar and description-space revision; W2 beyond asynchronous MPC; W5 beyond model
  comparison).
