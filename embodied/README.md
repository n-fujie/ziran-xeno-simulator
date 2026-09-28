# embodied/ — Xeno-14 embodied-AI experiment layer (research branch)

Branch `research/xeno14-integration`. Milestone **X14-1** only. This layer is **removable**: nothing in `src/`,
`public/`, `bin/` or `comparison/` imports it (a test checks this); deleting `embodied/` leaves v0.3.0 and the
comparison work unchanged. It is not a new foundation: the hierarchy remains Operational-Shape Dynamics → Ziran →
Xeno embodied research → Xeno-14 hypotheses → this PyTorch implementation surface.

## What it tests

Whether one simulated embodiment (Walker2d-v5, a planar biped) supports several operational bodily organizations such
that an intervention improving organization *i* changes the robustness, adaptability or recoverability of
organization *j* — **Fragility Transfer**, measured by intervention against a matched control, with the same matrix
computed for an ordinary scalarized multi-objective controller so the two can be compared. The hypothesis is *not*
that the fourteen principles improve AI.

## Reuse

- Principle names and operational definitions: `src/domains/body.ts` (`XENO14`); X14-1 aliases are recorded, nothing
  is renamed (`xeno14/principles.py`, checked by a test).
- Revision machinery: v0.3.0 `paretoFront` / `selectFrom` via `comparison/xeno14-bridge.ts` (domain-registered
  Pareto axes; v0.3.0 code unchanged).
- Records: the `ComparisonRecord` schema of `comparison/core/schema.ts` (family `xeno14-embodied`), plus operation
  records carrying embodiment, sensing, boundary, scale, temporal window, substrate, controller-state hash, history,
  resources, intervention and realized effect.

## Requirements

Python 3.12 with `torch==2.13.0`, `numpy`, `gymnasium[mujoco]==1.3.0` (MuJoCo 3.14.0). In this workspace these are
in `../.venv` (the workspace-level environment).

## Run

```bash
../.venv/bin/python -m pytest embodied/tests
```

```bash
cd embodied && ../../.venv/bin/python -m xeno14.experiment
```

```bash
cd embodied && ../../.venv/bin/python -m xeno14.analyze
```

Outputs: `results/xeno14/x14-1/` and `docs/xeno14-x14-1-results.md`. The experiment is seeded (seeds 1–3) and runs one
process per seed.
