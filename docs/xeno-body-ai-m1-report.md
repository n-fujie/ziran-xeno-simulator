# Xeno-Body + Active Inference — Milestone 1 report

Architecture and mathematics: [xeno-body-ai-m1-architecture.md](xeno-body-ai-m1-architecture.md). Generated tables:
[xeno-body-ai-m1-results.md](xeno-body-ai-m1-results.md). Data: `results/xeno-body-ai/m1/`. Claim status:
**synthetic-world result**.

## Verdict: Milestone 1 does not pass — do not start Milestone 2

The layer is implemented, tested and fast enough, but (1) the Active Inference layer produced no stability benefit and
consistently higher motor effort, and (2) the premise of the balance-recovery comparison — an existing controller
that stabilizes the body — holds in only 2 of 5 seeds.

## Files

- **Modified:** none of the existing code. (`embodied/xeno14/*`, `src/`, `public/`, `bin/` unchanged on this branch.)
- **Added:** `embodied/configs/milestone1.json`; `embodied/active_inference/{observations,generative_model,state_inference,expected_free_energy,policy_selection}.py`;
  `embodied/benchmarks/fixed_controller.py`; `embodied/experiments/{balance_recovery,analyze_m1}.py`;
  `embodied/metrics/{latency,recovery}.py`; `embodied/tests/test_active_inference.py`; this report, the architecture
  document and the generated results; `results/xeno-body-ai/m1/` (raw, summary, controller checkpoints, two
  post-run context files).

## Tests

`pytest embodied/tests`: 15 passed (9 existing Xeno-14 tests, 6 new: matrix normalization, posterior and VFE (VFE equals
surprise at the exact posterior), EFE decomposition, policy selection, bit-identical reproduction of the existing
controller in the neutral configuration, required log fields). v0.3.0 `npm test`: 73/73.

## Benchmark results (Experiment 1, 5 seeds × 10 episodes per condition and mode)

Mode B − Mode A, paired by seed, 95% bootstrap interval (full table in the generated results):

- **Falls:** no condition shows a clear reduction; several show increases whose intervals start at 0
  (e.g. forward 80 N with noise +0.10 [0.00, 0.26]).
- **Maximum axis deviation:** no consistent change.
- **Recovery (fraction of episodes returning to |pitch| < 0.1 for 10 steps):** no consistent change.
- **Motor effort:** higher in every condition (+6 to +11 per episode; interval excludes 0 in 8 of 12 conditions).
- **Lateral impulse:** not instantiable (planar embodiment).

## Latency (ms, this machine)

| layer | mean | p95 | max |
|---|---|---|---|
| Layer 0 fast control (both modes) | 0.65 | 1.1 | 166 (single outlier, process scheduling) |
| Layer 1 state estimation | 0.035 | 0.06 | 13 |
| Layer 2 Active Inference (Mode B, every 200 ms) | 2.06 | 2.36 | 35 |

Layer 2 is well inside its 100–300 ms budget and never blocks Layer 0.

## Context found after the run (reported, not used to change the comparison)

- `context-no-push.json`: with no push and no noise, the existing controller falls within ~180–200 steps in seeds 1, 3
  and 4 and stands the full episode in seeds 2 and 5. The existing controllers (48 ES iterations, as in the existing
  code) are not reliable stabilizers.
- `exploratory-standing-seeds.json` (seeds 2 and 5 only, n = 2): Mode B fell more after forward pushes
  (80 N: 0.35–0.40 → 0.50–0.60) and less after backward pushes (80 N: 1.0 → 0.7), with better recovery after 200 N
  backward pushes (0.2 → 0.5). Direction-dependent and far too small a sample to conclude anything.

## Known limitations

Latent states copy the observation partition; A is assumed, B is learned from ~500 calibration transitions for
9 policies × 22 states (sparse); one-interval horizon; configurations are applied around a controller that was never
trained for non-neutral configurations; Mode B receives calibration data that Mode A does not; the existing
controller is unreliable in 3 of 5 seeds; planar embodiment.

## Next implementation step (requires a decision)

Before Milestone 2, establish a reliable existing stabilizer — for example train the existing controller with the
existing code for more iterations and accept a seed only if it stands through an unperturbed episode (criterion fixed
in advance) — then re-run Experiment 1 under a pre-registered protocol. Only if Mode B then shows a measurable
difference should Milestone 2 (model-failure detection, parameter learning, friction change) begin.
