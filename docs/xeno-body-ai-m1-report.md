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

**Lateral perturbation** is not included and not approximated: Walker2d is planar. It is a simulator limitation,
deferred to a future 3D embodiment.

## Latency (ms; pooled over all calls; this machine, Python 3.12, one thread per process)

| component | median | p95 | max |
|---|---|---|---|
| observation adaptation | 0.009 | 0.018 | 5.5 |
| latent-state inference | 0.053 | 0.080 | 8.4 |
| VFE computation | 0.017 | 0.025 | 4.4 |
| EFE preference term (9 policies) | 0.042 | 0.078 | 4.8 |
| EFE epistemic term (9 policies) | 1.39 | 2.46 | 21.3 |
| total EFE (9 policies) | 1.72 | 3.07 | 47.0 |
| policy selection | 0.024 | 0.038 | 4.0 |
| **total Active Inference decision** | **1.86** | **3.31** | **47.2** |
| existing fast controller (Layer 0), Mode B | 0.50 | 1.09 | 390 |
| complete controller step, Mode B (all steps) | 0.51 | 2.06 | 390 |
| complete controller step, Mode B (steps with a decision) | 2.50 | 4.47 | 54 |
| complete controller step, Mode A | 0.49 | 0.99 | 389 |

T_total_AIF_decision < 200 ms, < 100 ms and < 50 ms at median, p95 and maximum; < 10 ms at median and p95 but not at
the maximum (47 ms). The epistemic term dominates (Python loop over state entropies; vectorizable). The 390 ms maxima
occur in Layer 0 in both modes (process scheduling / first-call effects) and exceed the 8 ms control period; no
real-time capability is claimed for either mode.

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
