# Xeno-14 — Milestone X14-1 report

Branch `research/xeno14-integration` (from `research/external-comparison`). Tables: [xeno14-x14-1-results.md](xeno14-x14-1-results.md)
(generated). Data: `results/xeno14/x14-1/`. Claim status: **synthetic-world result** (simulated embodiment, 3 seeds).

## Recommendation: STOP (redesign required before any expansion)

Several pre-declared stop conditions are met (below). X14-2 is not started. The code runs; that is not a success
criterion, and no nonredundant operational difference was demonstrated.

## 1. Repository architecture discovered

- `ziran-xeno-simulator` (published v0.3.0, zero-dependency TypeScript): Operational-Shape core (`src/core`), Ziran
  reviser with Pareto axes and selection policies (`src/ziran/reviser.ts`), Xeno-14 as optional rule bundles on a
  5-segment command-free body (`src/domains/body.ts`), interplay and fragility-transfer analyses, the v0.3.0 benchmark
  suites, and on the research branch the External Framework Comparison (`comparison/`) with a framework-neutral
  `ComparisonRecord` schema. **No PyTorch code.**
- `dsnc-ai` (separate, not a git repository): PyTorch experts / router / non-scalar resistance. Not used (outside this
  repository).
- Environment: workspace `.venv` with torch 2.13, gymnasium 1.3; MuJoCo 3.14 installed with approval.

## 2–4. Files reused, added, modified

- **Reused (unchanged):** `src/domains/body.ts` (principle names and definitions), `src/ziran/reviser.ts`
  (`paretoFront`, `selectFrom`), `comparison/core/schema.ts` (`ComparisonRecord`).
- **Added:** `embodied/` (README, `xeno14/{principles,env,modules,es,experiment,analyze}.py`, `tests/test_xeno14.py`),
  `comparison/xeno14-bridge.ts`, `results/xeno14/x14-1/*`, `docs/xeno14-x14-1-*.md`.
- **Modified:** `comparison/core/schema.ts` — one added framework family value `xeno14-embodied`.
  `git diff v0.3.0 -- src public bin` is empty.

## 5. Theoretical mapping

Operational-Shape Dynamics → Ziran revision machinery (Pareto axes, selection with recorded origin) → Xeno embodied
research (configuration-dependent body analysis) → Xeno-14 (three organizations as falsifiable hypotheses) → PyTorch on
Walker2d as one implementation surface. The layer is removable (tested). Organizations are configuration-dependent
modules with their own ignition features; model outputs are kept separate from realized effects (measured in the
environment).

## 6–7. Principles selected and operational definitions

Chosen because `src/domains/body.ts` gives them the clearest operational definitions:

| canonical (alias) | existing definition | Walker2d operationalization | organization metric |
|---|---|---|---|
| axis-maintenance (axial maintenance) | ignites when \|axis\| > 0.02; lean correction | gate on \|pitch\|, \|pitch rate\|; torque proposal | mean pitch² |
| lower-abdominal-continuity (lower-center persistence) | tonic lower-center tension coupled to segment stiffness | gate on height and joint-angle magnitude; torque proposal | mean (z − z₀)² |
| low-noise-movement (low-noise movement) | ignites on a registered push; damps it | gate on angular-velocity magnitude (push proxy); torque proposal | mean ‖aₜ − aₜ₋₁‖² |

All three **change operationalization** in this embodiment (recorded per principle). Each module is optimized on its
own objective (survival − 0.5 × its normalized metric); organizations are never summed for Xeno-14.

## 8. Baselines

Standard MLP (17 → 32 → 6), proprioceptive MLP (joint angles and velocities only), recurrent GRU policy, scalarized
multi-objective MLP, and the Xeno-14 architecture trained on the scalarized objective. No modular / MoE controller
exists in this repository, so none was used.

## 9. Matched-condition verification

Same observation (17-dim; the proprioceptive baseline a subset), same action space, same optimizer (antithetic ES,
16 episodes per iteration, 48 iterations), same training push distribution (0 / ±80 N), same evaluation seeds and
pushes (0, ±80, ±140 N). No controller observes push timing or force (tested). Environment steps actually used differ
because early falls end episodes (Xeno-14 140 k vs 145–154 k); reported per configuration.

## 10. Tests

Full suites at the end of the milestone: v0.3.0 `npm test` 73/73, `npm run test:comparison` 11/11, typecheck clean,
`pytest embodied/tests` 9/9.

## 11. Results (mean ± sd over 3 seeds)

- **Survival at 140 N:** Xeno-14 0.819 ± 0.025; standard MLP 0.854 ± 0.080; proprioceptive MLP 0.925 ± 0.130 (while
  leaning: axis metric 0.132); GRU 0.789 ± 0.009; scalarized multi-objective MLP 0.778 ± 0.025; Xeno-14 architecture
  with scalarized training **0.899 ± 0.115**; Xeno-14 without gates 0.854 ± 0.127; without history 0.767 ± 0.127.
- **Low-noise metric:** Xeno-14 0.0013 vs 0.008–0.019 for the others. This metric is one of Xeno-14's objectives, so
  the difference is partly by construction.
- **Ignition (80 N):** low-noise-movement never ignited (fraction 0.0); axis-maintenance 0.39 ± 0.54 and
  lower-abdominal-continuity 0.33 ± 0.58, i.e. on in some seeds and off in others.

## 12. Fragility Transfer matrix

Pre-registered analysis (normalized metrics capped at 4): **no entry is sign-consistent across seeds**, including the
diagonal — the interventions did not reliably improve even the organization they targeted, so "improving *i*" was not
established. Off-diagonal agreement with the scalarized trade-off analysis was 6/6, trivially, because both matrices
are entirely inconsistent.

Exploratory (after the pre-registered analysis; `exploratory-ft-uncapped.json`): the cap zeroed differences when both
conditions exceeded it. Recomputed on uncapped relative changes, at 140 N the Xeno-14 intervention on
low-noise-movement worsened axis-maintenance (+42%) and lower-abdominal-continuity (+37%) in all three seeds, a
pattern not seen in the scalarized trade-off matrix; but the same intervention did not consistently improve
low-noise-movement itself (−12% mean; one seed +42%). This is a **candidate** for a pre-registered test, not a
demonstrated Fragility Transfer.

## 13. Ablations

- Module removal at evaluation reduces survival (e.g. without axis-maintenance 0.58 at 80 N; without axis +
  low-noise 0.32) — the trained modules are jointly relied upon, which is expected for any composed controller.
- Gates off (no morphology-dependent ignition): equal or better survival (0.854 vs 0.819 at 140 N).
- No body-state history: lower and more variable survival (0.767 ± 0.127).
- Scalarized replacement (same architecture, scalarized objective): higher survival (0.899) — module-wise, conflict-
  preserving training did not help.
- Conflict preservation: its ablation removes the per-organization record by construction; it has no behavioural
  effect in this implementation.

## 14. Architecture repartition

Candidates under the 140 N stress with equal budgets: retrain (R0), longer history (R1), shared gate for axis and
lower-center (R2, a repartition of ignition), acceleration features for gates (R3, encoding). The v0.3.0
lexicographic selection chose a non-retraining candidate in 3/3 seeds (R3, R3, R2); on held-out test seeds the
selected revision minus retraining was +0.086 ± 0.150 survival (+0.008, +0.260, −0.009) — driven by one seed;
**inconclusive**.

## 15. Failure cases

The low-noise module never ignited; ignition depended on the seed; one-seed-dominated repartition gain; capped metrics
reduced FT sensitivity (a flaw in this milestone's measurement design); survival rewards leaning postures (the
proprioceptive baseline survives while leaning ≈ 0.49 rad in some seeds).

## 16. Overlap with existing embodied-AI methods

The modules are gated additive sub-policies — a mixture-of-experts / residual-policy composition; per-module objectives
are reward shaping; the FT measurement is intervention-based trade-off analysis; history is frame stacking. Nothing in
X14-1 goes beyond these established techniques.

## 17. Stop-condition assessment

| stop condition | assessment |
|---|---|
| pilot principles reduce to reward shaping | **met**: per-module objectives are shaping terms; the same architecture trained on the scalarized objective performed as well or better |
| explained by standard multi-objective optimization | **met**: no Xeno-14 advantage over the scalarized controllers on survival |
| FT adds no information beyond trade-off analysis | **met for the pre-registered analysis** (no consistent FT); one exploratory candidate |
| module ignition arbitrary | **met**: seed-dependent ignition; one module never ignites; gates-off is not worse |
| morphology-dependent differences disappear | **not tested** (one embodiment) |
| architecture repartition adds no measurable effect | **inconclusive** (+0.086 ± 0.150, one-seed driven) |
| metrics encode the result by construction | **partly** (low-noise metric is an objective) |
| simpler components reproduce the result | **met** |
| privileged information | **not met**: none used |

**Whether Xeno-14 remains nonredundant:** not demonstrated in X14-1. A redesign would need, at minimum: interventions
verified to improve their own organization before FT is read; uncapped metrics pre-registered; ≥ 10 seeds; at least
two embodiments; and the exploratory low-noise → axis / lower-center candidate stated as a pre-registered hypothesis.
