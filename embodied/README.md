# embodied/ — experimental embodied research modules (Python)

Part of v0.4.0 as **experimental research modules**. This layer is **removable**: nothing in `src/`, `public/`,
`bin/` or `comparison/` imports it (a test checks this); deleting `embodied/` leaves the core simulator and the
comparison work unchanged. It is not a new foundation: the hierarchy remains Operational-Shape Dynamics → Ziran →
Xeno embodied research → Xeno-14 hypotheses → this PyTorch implementation surface. The embodiments are simulated
**planar** bodies (MuJoCo Walker2d-v5, Hopper-v5) — a planar Xeno-Body prototype, not the full Xeno-Body.

## Modules

| module | status | result |
|---|---|---|
| `xeno14/` — Xeno-14 experimental integration (X14-1, X14-1b) | pilot study | X14-1 STOP; X14-1b CONDITIONAL GO under its predefined rule; no non-redundant control advantage demonstrated ([report](../docs/xeno14-x14-1b-report.md)) |
| `active_inference/`, `benchmarks/`, `experiments/`, `metrics/`, `configs/` — Active Inference Milestone 1 | experimental research module | computationally viable; no control-performance advantage; corrective movement and motor effort increased; no real-time guarantee is claimed for the current full control loop ([report](../docs/xeno-body-ai-m1-report.md)) |

**Xeno-14** tests whether one simulated embodiment supports several operational bodily organizations such that an
intervention improving organization *i* changes the robustness, adaptability or recoverability of organization *j* —
Fragility Transfer, measured by intervention against a matched control and compared with the same matrix for an
ordinary scalarized multi-objective controller. The hypothesis is *not* that the fourteen principles improve AI.

**Active Inference** adds, around the existing Xeno-14 controller (unchanged), an observation adapter, a minimal
discrete generative model, latent-state inference with variational free energy, expected free energy with separate
preference and epistemic terms, and policy selection over body configurations. Runtime self-revision (model-failure
detection, parameter revision, structure learning, sensor or temporal-window revision) is **not implemented**.

## Reuse

- Principle names and operational definitions: `src/domains/body.ts` (`XENO14`); aliases are recorded, nothing is
  renamed (`xeno14/principles.py`, checked by a test).
- Revision machinery: core `paretoFront` / `selectFrom` via `comparison/xeno14-bridge.ts` (domain-registered Pareto
  axes; core code unchanged).
- Records: the `ComparisonRecord` schema of `comparison/core/schema.ts` (family `xeno14-embodied`), plus operation
  records carrying embodiment, sensing, boundary, scale, temporal window, substrate, controller-state hash, history,
  resources, intervention and realized effect.

## Requirements

Python 3.12 (validated with 3.12.13) and the pinned packages in [`requirements.txt`](requirements.txt); the full
resolved set that was installed and tested in a clean virtual environment is in
[`requirements-lock.txt`](requirements-lock.txt).

```bash
python3.12 -m venv .venv-embodied
```

```bash
.venv-embodied/bin/pip install -r embodied/requirements.txt
```

## Run (from the repository root unless noted)

```bash
.venv-embodied/bin/python -m pytest embodied/tests
```

```bash
cd embodied && ../.venv-embodied/bin/python -m experiments.balance_recovery
```

```bash
cd embodied && ../.venv-embodied/bin/python -m experiments.analyze_m1
```

```bash
cd embodied && ../.venv-embodied/bin/python -m xeno14.experiment_b
```

```bash
cd embodied && ../.venv-embodied/bin/python -m xeno14.analyze_b
```

Outputs: `results/xeno14/` and `results/xeno-body-ai/m1/`; reports in `docs/`. All experiments are seeded; the
Active Inference run loads the committed controller checkpoints (`results/xeno-body-ai/m1/controllers/`, SHA-256 in
the run metadata) so both modes use the same base controller.
