# Xeno-Body + Active Inference — Milestone 1 report

**Scope.** This is a **planar Xeno-Body prototype** on MuJoCo Walker2d-v5 (sagittal plane only), not the full Xeno-Body
architecture. Only Milestone 1 is implemented: no structure learning, parameter revision, sensor revision or further
layers. Architecture and mathematics: [xeno-body-ai-m1-architecture.md](xeno-body-ai-m1-architecture.md). Generated
per-condition tables: [xeno-body-ai-m1-results.md](xeno-body-ai-m1-results.md). Data: `results/xeno-body-ai/m1/`.
Claim status: **synthetic-world result**.

## Engineering conclusion

**The Active Inference layer currently degrades performance.** It establishes no stability benefit (fall rate,
recovered fraction and recovery latency: no difference established in any of the 12 conditions; maximum posture
deviation higher in 2, lower in 1, no difference in 9), while it raises corrective action magnitude (8 of 12
conditions) and motor effort (9 of 12), and lowers the secondary episode return (5 of 12). It is computationally
viable at the measured latencies (below). Active Inference is not superior in this benchmark.

## Matched conditions

Both modes use the **same trained base controller per seed** (one checkpoint per seed, loaded for both), the same
episode seeds, the same push schedule and the same sensor-noise sequence (drawn per step from a per-episode seeded
generator). Remaining differences, all intended or recorded:

1. the Active Inference layer itself (Mode B sets a body configuration every 25 steps);
2. the configuration interface (target pitch offset and torque gain around the controller) is exercised only by
   Mode B; at the neutral configuration it reproduces the controller exactly (tested);
3. Mode B's transition model B is learned from 60 calibration episodes per seed (seeds 70000+, disjoint from
   evaluation); Mode A receives no such data;
4. Layer-2 computation time does not delay actuation in simulation: the simulator waits for the controller, so
   measured latency has no behavioural effect in this experiment.

Controller identity was verified at run time: in every seed the parameter hash of the single controller object was
the same before the first episode and after every condition of both modes (seed 1: `b9002e05c3bbe142…`); checkpoint
file hashes are in the run metadata. Training: existing `train_xeno` (round-robin module-wise ES, 48 iterations,
pushes 0 / ±80 N, rng `default_rng(seed)`, `torch.manual_seed(seed)`), seeds 1–5. Neutral configuration: bit-identical
output (tolerance 0, tested with exact array equality).

**Lateral perturbation** is not included and not approximated: Walker2d is planar. It is a simulator limitation,
deferred to a future 3D embodiment.

## Latency (ms; pooled over all calls; final run)

Environment: Apple M1 (8 cores, 8 GB), macOS 26.6.2 arm64, Python 3.12.13, MuJoCo 3.14.0, gymnasium 1.3.0,
torch 2.13.0, numpy 2.5.1; five processes in parallel, one torch thread each. The Active Inference components exclude
logging; the complete controller step includes building the per-decision log record in Mode B.

| component | samples | median | p95 | max |
|---|---|---|---|---|
| T_observation_adapter (Mode B) | 120 018 | 0.0076 | 0.0148 | 2.50 |
| T_state_inference | 5 068 | 0.049 | 0.066 | 2.11 |
| T_VFE | 5 068 | 0.017 | 0.021 | 1.26 |
| T_EFE_preference (9 policies) | 5 068 | 0.037 | 0.059 | 4.42 |
| T_EFE_epistemic (9 policies) | 5 068 | 1.27 | 1.82 | 9.71 |
| T_EFE_total (9 policies) | 5 068 | 1.52 | 2.29 | 20.6 |
| T_policy_selection | 5 068 | 0.021 | 0.032 | 1.18 |
| **T_AIF_total** | 5 068 | **1.63** | **2.46** | **20.8** |
| existing fast controller (Layer 0), Mode B | 120 018 | 0.42 | 0.76 | 104 |
| T_complete_controller_step, Mode B (all steps) | 120 018 | 0.43 | 1.51 | 104 |
| T_complete_controller_step, Mode B (steps with a decision) | 5 068 | 2.12 | 3.41 | 21.7 |
| T_complete_controller_step, Mode A | 121 597 | 0.43 | 0.77 | 44.3 |

T_AIF_total < 200 ms, < 100 ms and < 50 ms at median, p95 and maximum; < 10 ms at median and p95, not at the maximum
(20.8 ms). The epistemic term dominates (Python loop over state entropies). The Layer-0 maxima (44 ms in Mode A,
104 ms in Mode B) exceed the 8 ms control period in both modes; no real-time capability is claimed for either mode.
Latencies vary between runs (an earlier run: T_AIF_total max 47 ms); behavioural results were identical across runs.

## Mathematical separation of VFE and EFE

VFE F = E_q[ln q(s) − ln A[o, s] − ln prior(s)] is computed in `state_inference.py` from the current belief and the
current observation; EFE G(π) = −E_{Q(o|π)}[ln P̃(o)] − I(s; o | π) is computed in `expected_free_energy.py` from
predicted states and outcomes and the preferences C. Tests verify that VFE does not change when C changes, that EFE
does not depend on the current observation given the belief, that VFE equals the surprise −ln p(o) at the exact
posterior, that the EFE decomposition holds, and that neither module calls the other.

## Behaviour with Active Inference disabled

Mode A runs through the new runner without executing any Active Inference code and reproduces the existing
`run_episode` trajectory exactly (identical step count and pitch trace; tested). No existing module was modified.

## Reproducibility

A second full run after adding instrumentation reproduced the previous fall rates and motor efforts exactly.

## Context (reported, not used to change the comparison)

With no push, the base controller falls within ≈ 180–200 steps in seeds 1, 3 and 4 and stands through the episode
in seeds 2 and 5 (`context-no-push.json`). The comparison is paired on these controllers as they are; a reliable base
stabilizer would be needed before a recovery benchmark can discriminate well.
