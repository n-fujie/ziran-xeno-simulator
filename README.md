# Ziran / Xeno Operational World Simulator

**Operational-Shape Dynamics, Observability Generation, and Description-Space Reorganization** · v0.4.0 · open research prototype with experimental research modules

Repository: https://github.com/n-fujie/ziran-xeno-simulator · Author: Naoto Fujie · License: MIT

Ziran / Xeno Operational World Simulator is an experimental framework for studying how operational differences
ignite under configuration-dependent conditions, alter downstream reachability, penetrate across coupled
configurations, and reorganize observation and description systems.

The current release supports explicit analysis of configuration reorganization, description-space transformation,
and partially revisable meta-configuration. Its benchmark results are synthetic and are not empirical validation of
the underlying theoretical framework. v0.4.0 adds three research modules (external framework comparison, a Xeno-14
pilot integration, and an Active Inference module for a planar Xeno-Body prototype); their results are negative or
conditional and are reported as such. The core simulator is unchanged from v0.3.0 (core engine version 0.3.0).

Contents: [1 Core simulator](#1-core-simulator) · [2 External comparison research tool](#2-external-comparison-research-tool) ·
[3 Xeno-14 experimental integration](#3-xeno-14-experimental-integration) · [4 Active Inference research module](#4-active-inference-research-module) ·
[5 Released results](#5-released-results) · [6 Known limitations](#6-known-limitations) · [7 Future / unreleased work](#7-future--unreleased-work) ·
[Reproducibility](#reproducibility) · [Citation](#citation)

---

## 1. Core simulator

### What it is

An executable environment for tracking configured operational differences, observability revision, downstream
reachability, penetration, feedback, reorganization, description-space change, and explicit meta-boundedness.

It can compare how results change when observation systems, variable systems, grammars, trace schemas, category
features, evaluation axes, or benchmark predicates change.

Everything it reports carries a claim status (see [docs/claims.md](docs/claims.md)): *implementation property*,
*synthetic-world result*, *model-class discrimination*, *reconstruction inference*, *replayed empirical result*,
*empirical observation*, *empirically supported generalization* or *unresolved*. No result in this release is an
empirically supported generalization.

### What it is not

- not a completed implementation of the Ziran / Xeno framework, and not a proof of it;
- not an empirically validated theory — the core's bundled worlds are synthetic;
- not an unrestricted autonomous-science system — variables come from a supplied grammar or from a grammar that
  changes through supplied meta-operations;
- not an ontology-free or presupposition-free simulator — it exposes and partially revises some presuppositions, it
  does not remove them;
- not a historical-person simulator — historical material enters only as *historically constrained operational
  reconstruction* with sources, assumptions, uncertainty and `historicalFactualClaim: false`;
- not a claim of general superiority over existing modeling approaches (see §2 for the matched comparison and its
  non-superiority result).

Categories (human, agent, trader, body, …) are not universal primitive units. They are kept out of the core and
introduced where they produce non-redundant operational differences; the benchmarks show cases where a thick
category is useful (J) and where it is redundant (K). Withholding or reintroducing a category is a methodological
safeguard, not a result.

### Core analytical sequence

```
C_t → Δ_t → ignition → operation → real effect → penetration → feedback → reorganization → C_{t+1}
```

A configuration `C_t` makes some differences `Δ_t` operational; configured ignition conditions select operations;
only actual differences are recorded as real effects; effects penetrate other configurations along couplings
(retained, transformed, delayed or interrupted); downstream consequences return as the conditions later operations
read; reorganization reconfigures the next condition. A correction process slower than environmental
reconfiguration can become operationally ineffective (too-late correction) — an operational criterion tied to timing
and downstream consequences, not a criterion of truth.

Observation is a separate apparatus: "not detected" is never read as "absent". The core distinguishes, per
apparatus, a difference that was detected, not measured, hidden by a boundary, below resolution, at an incompatible
scale, outside the temporal window, incompatible with the apparatus, or inaccessible; description facets record what
the current representation cannot express. None of these is collapsed into "no difference" or "prediction error".

### A / B / C / D

**A/B/C/D are not ontological strata. They are revisable analytical distinctions used to localize different forms
of operational change.** A higher letter does not mean deeper reality, a superior explanation, or a more advanced
intelligence.

| | name | recorded as |
|---|---|---|
| **A** | operation within a configuration | real effects inside `C` |
| **B** | configuration reorganization | `C_t → C_{t+1}` within the same description space |
| **C** | description-space transformation | `S_t → S_{t+1}`: descriptors appear/disappear within the registered description facets |
| **D** | meta-configuration transformation | `M_t → M_{t+1}`: registry entries (facets, value kinds, …) are registered or retired |

Level C is *open but meta-bounded description-space morphogenesis*; Level D acts on an *explicitly represented and
partially revisable meta-configuration*. The registry interfaces and the code that consults them are fixed.

**Stopping principle.** A fixed condition is not automatically a theoretical defect. A fixed condition becomes a new
experimental object only when changing it produces a non-redundant difference in observation, intervention,
reachability, real effect, penetration, feedback, reorganization, or the interpretation of the result. This release
does not pursue infinite meta-regression and has no Level E.

The core implements, in synthetic worlds, observation revision (apparatus changes chosen from a Pareto set) and
grammar-based variable generation (grammar-bounded discovery and operator-grammar morphogenesis). Beyond model
revision, the framework's broader targets include changing sensors, observability, variable systems, scale, temporal
window, boundary, medium, resource conditions, external memory and experimental intervention; only the parts listed
here are implemented.

![Level A/B/C/D timeline](docs/screenshots/level-timeline.png)

### Installation and quick start

Requirements: **Node.js ≥ 23.6** (tested with Node 24.14.1 / npm 11.11.0; TypeScript is executed through Node's
built-in type stripping). macOS, Linux or Windows. The core has **no runtime dependencies**.

```bash
git clone https://github.com/n-fujie/ziran-xeno-simulator.git
```

```bash
cd ziran-xeno-simulator
```

```bash
npm ci
```

`npm ci` installs only the dev dependencies `typescript` and `@types/node`, used by `npm run typecheck`. Tests, the
server, the CLI and all core benchmarks run without it.

```bash
npm start
```

This serves the interface and API at `http://127.0.0.1:3010` (override with `PORT`; `HOST` defaults to the loopback
interface — the server has no authentication). The *Experiment* tab lists nine representative demos first.

```bash
node bin/zx.ts run observation.hidden-phase --verify-rerun
```

### Representative experiment

`observation.hidden-phase`: an apparatus reads only `x`; a hidden phase `h` is coupled to `x`. Two states that look
identical under the observation map diverge under the same intervention — an aliasing record. The observation
reviser generates candidate apparatus changes, evaluates each by counterfactual lookahead (resolved aliases, lost and
new observability, resource cost, fragility, delay, reachability), forms a Pareto set, and only then applies a
selection policy whose origin is recorded (`pareto-min-loss` by default — not theoretically privileged).

![Observation revision trade-off](docs/screenshots/observation-revision-tradeoff.png)

| # | demo | preset |
|---|---|---|
| 1 | observation aliasing and revision | `observation.hidden-phase` |
| 2 | too-late correction | `timing.too-late-correction` |
| 3 | fragility transfer | `fragility.shared-load` |
| 4 | relation-valued vs scalar-valued representation | `open.relation-spread` |
| 5 | grammar-bounded vs grammar morphogenesis | `science.delayed-law` |
| 6 | Pareto-axis sensitivity | `observation.sensor-budget` |
| 7 | trace-schema sensitivity | `market.synthetic` (Operational bundles → trace-schema sensitivity) |
| 8 | historically constrained operational reconstruction | `thought.reignition` |
| 9 | trader-category necessity: unresolved case | `market.synthetic` (Domain) |

All 38 presets remain available (`node bin/zx.ts list`). More screenshots: [docs/screenshots/](docs/screenshots/).

### Core benchmark suites

Three separate suites; **none of them is empirical validation.** Details and failure criteria:
[BENCHMARKS.md](BENCHMARKS.md); generated results: [docs/benchmark-results.md](docs/benchmark-results.md).

| suite | question | size | result |
|---|---|---|---|
| Implementation Conformance | does the implementation behave according to its specification? | 57 checks, 15 layers | 57 pass, 0 fail |
| Theory-Discriminating (A–N) | do model classes produce different operational consequences in specified synthetic worlds? | 14 | 7 positive · 5 negative · 2 null |
| Meta-Boundedness (MB1–MB7) | how sensitive are results to supplied facets, mutation operators, trace schemas, features, Pareto axes, predicates? | 7 | 2 stable · 5 meta-dependent |

```bash
npm run bench
```

---

## 2. External comparison research tool

**STATUS** — research tool (formal release in v0.4.0); results are a technical-report-level, non-superiority finding.

**SCOPE** — External Framework Comparison is a reproducible research tool for matched-condition comparison across
modelling frameworks. Current results do not establish field-wide superiority. Under the current Cascaded Tanks
protocol, no non-redundant Ziran / Xeno distinction was observed.

**WHAT IS IMPLEMENTED** — a framework-neutral comparison schema without any score, rank or winner field; five
synthetic worlds (observation aliasing, too-late correction, fragility transfer, description-space change, paired
thick-category worlds) with agent-based, control / MPC, reinforcement-learning, active-inference, digital-twin,
dynamical-systems, viability / reachability and feature-learning baselines, fairness configurations and Ziran / Xeno
ablations; a replayed empirical evaluation on the Cascaded Tanks benchmark (4TU.ResearchData, DOI
10.4121/12960104.v1, CC BY-SA 4.0) under a protocol frozen before any model was fitted.

**WHAT IS NOT IMPLEMENTED** — third-party baseline configurations; more than one empirical dataset; large seed
counts.

**CURRENT RESULT** — the synthetic worlds were constructed, and the baselines implemented, by the same author; seed
counts are limited (3–5); there is no third-party reproduction; Cascaded Tanks is one replayed empirical dataset.
In the synthetic worlds, no Ziran / Xeno mechanism was shown to be necessary beyond what standard, well-configured
baselines provide; under the Cascaded Tanks protocol, switching ARX gave the best one-step prediction and a grey-box model with the
documented overflow the best simulation, and no non-redundant Ziran / Xeno distinction was observed.

Docs: [docs/external-comparison.md](docs/external-comparison.md) · [docs/external-results.md](docs/external-results.md) ·
[docs/comparison-limitations.md](docs/comparison-limitations.md) · [docs/cascaded-tanks-results.md](docs/cascaded-tanks-results.md) ·
[docs/cascaded-tanks-limitations.md](docs/cascaded-tanks-limitations.md)

```bash
npm run compare
```

```bash
npm run test:comparison
```

---

## 3. Xeno-14 experimental integration

**STATUS** — experimental integration and pilot study; negative / conditional result.

**SCOPE** — Xeno-14 experimental integration and pilot study. X14-1 resulted in STOP. X14-1b reached CONDITIONAL GO
under its predefined rule, but no non-redundant control advantage was demonstrated. This release does not validate
Xeno-14 as a superior control architecture.

**WHAT IS IMPLEMENTED** — three of the fourteen Xeno-14 principles (axis maintenance, lower-abdominal continuity,
low-noise movement) as removable PyTorch modules with ignition gates on a simulated planar embodiment (MuJoCo
Walker2d-v5 and Hopper-v5); matched baselines; Fragility Transfer measured by intervention against matched controls;
ablations; a pre-registered redesign (X14-1b). The fourteen principles are starting hypotheses, named as in
`src/domains/body.ts`; they are not universal commands and have not been verified as independent control principles.

**WHAT IS NOT IMPLEMENTED** — the remaining eleven principles; any embodiment beyond the two planar bodies; X14-2.

**CURRENT RESULT** — X14-1: STOP (no sign-consistent Fragility Transfer; scalarized training of the same architecture
and gates-off controllers performed as well or better). X14-1b: CONDITIONAL GO under its predefined rule; hypothesis H1
was reversed; the only robust declared transfer was reproduced in direction, with a larger absolute effect, by an
ordinary scalarized controller; no non-redundant control advantage was established.

Docs: [docs/xeno14-x14-1-report.md](docs/xeno14-x14-1-report.md) · [docs/xeno14-x14-1b-protocol.md](docs/xeno14-x14-1b-protocol.md) ·
[docs/xeno14-x14-1b-report.md](docs/xeno14-x14-1b-report.md) · [embodied/README.md](embodied/README.md)

---

## 4. Active Inference research module

**STATUS** — experimental research module (formal research-tool release in v0.4.0); Milestone 1 negative
engineering result.

**SCOPE** — Experimental Active Inference research module for the planar Xeno-Body prototype (MuJoCo Walker2d).
Milestone 1 established computational feasibility but did not demonstrate a control-performance advantage over the
fixed baseline. Stability was unchanged, while corrective movement and motor effort increased. The baseline
controller remains standing without perturbation in only 2 of 5 seeds. No real-time guarantee is claimed for the
current full control loop.

**WHAT IS IMPLEMENTED** — an observation adapter; a minimal discrete generative model (A likelihood, B
policy-conditioned transitions, C preferences, D initial prior, E policy prior); latent-state inference with
variational free energy; expected free energy with the preference term and the epistemic term computed and reported
separately; policy selection over high-level body configurations applied around the existing controller, which is
unchanged and reproduced bit-for-bit when the layer is disabled or neutral; a balance-recovery experiment with paired
seeds, a run-time controller-identity check and per-component latency measurement.

**WHAT IS NOT IMPLEMENTED** — runtime self-revision in the Active Inference / embodied module: model-failure
detection, runtime parameter revision, structure learning, sensor reconfiguration, temporal-window revision, and any
executable self-modification. (The core simulator's synthetic observation revision and grammar-based variable
generation, §1, are separate and implemented.) Lateral perturbation is not possible in the planar embodiment.

**CURRENT RESULT** — engineering verdict C, the layer currently degrades performance: fall rate, recovery and recovery
latency showed no difference in any of 12 conditions, while corrective action magnitude (8 of 12) and motor effort
(9 of 12) increased. Active Inference decision computation is fast (median 1.63 ms, p95 2.46 ms, maximum 20.8 ms on an
Apple M1); the full control loop's worst-case latency exceeds the nominal 8 ms control period, so no real-time
guarantee is claimed for the current full control loop. The weak baseline (2 of 5 seeds stand without perturbation)
weakens the benchmark's ability to distinguish recovery improvements. Active Inference is one implemented research
formalism here, not the foundation of the framework; Bayesian belief is not propositional belief, the generative
model is not the generative process, and VFE and EFE are separate quantities.

Docs: [docs/xeno-body-ai-m1-architecture.md](docs/xeno-body-ai-m1-architecture.md) ·
[docs/xeno-body-ai-m1-report.md](docs/xeno-body-ai-m1-report.md) · [docs/xeno-body-ai-m1-results.md](docs/xeno-body-ai-m1-results.md)

---

## 5. Released results

| result | claim status | outcome |
|---|---|---|
| core benchmark suites | implementation property / synthetic-world result / model-class discrimination | see §1 |
| external comparison, synthetic worlds W1–W5 | synthetic-world result | no global ranking; no Ziran / Xeno mechanism shown to be necessary beyond well-configured baselines |
| Cascaded Tanks (CT-P1) | replayed empirical result (one dataset) | no non-redundant Ziran / Xeno distinction observed |
| Xeno-14 X14-1 / X14-1b | synthetic-world result (simulated embodiment) | STOP / CONDITIONAL GO; no non-redundant control advantage |
| Active Inference Milestone 1 | synthetic-world result (simulated embodiment) | verdict C: computationally viable, degrades performance |

Negative and null results of the core: fixed grammar performs as well as grammar morphogenesis in a stable linear
world (H); observation revision resolves an alias but adds cost without downstream benefit (G); asynchronous clocks
add no distinction in a synchronized world (I, null); self-reorganization damages a previously stable configuration
(L); a thick unit category is useful in one world (J) and redundant in another (K); meta-grammar morphogenesis does not
reach adequacy faster (N); trader-category necessity remains unresolved (D, null). See
[docs/negative-results.md](docs/negative-results.md).

---

## 6. Known limitations

- Core: all bundled worlds are synthetic; domain models are illustrative; the engine event vocabulary, registry
  interfaces, Pareto dominance relation, meta-operation templates and benchmark definitions are fixed; category
  emergence depends on traces and features; reconstruction sources require scholarly verification; there is no
  hardware sensor morphogenesis and no unrestricted state-space generation; no live trading or autonomous real-world
  execution. Full list: [LIMITATIONS.md](LIMITATIONS.md).
- External comparison: internally constructed worlds and baselines, small seed counts, no third-party reproduction,
  one empirical dataset.
- Xeno-14: three principles, two planar bodies, a module-wise ES training scheme; ignition inconsistent across seeds.
- Active Inference: planar Xeno-Body prototype only (not the full Xeno-Body); no lateral perturbation; latent states
  share the observation partition; the likelihood A is assumed; B is learned from sparse calibration data; one-interval
  planning horizon; weak base controller; timing measured in Python, where worst-case latency is dominated by process
  scheduling.

---

## 7. Future / unreleased work

Not part of this release and not implemented: Active Inference Milestone 2 and later (model-failure detection,
parameter revision, structure learning, sensor and temporal-window revision); Xeno-14 X14-2 (further principles);
a reliable base stabilizer for the planar prototype; 3D embodiments with lateral perturbation; further empirical
datasets and third-party baseline configurations. None of these is claimed. Bayesian structure learning, if later
implemented, would be one revision mechanism inside the Active Inference module; it would not by itself constitute
Xenoscience.

---

## Reproducibility

Core runs are deterministic given preset, parameters and seed; every trace carries a `specHash` and a `runHash`, and
`--verify-rerun` checks exact reruns. The research modules record seeds, configurations, protocol-freeze commits and
controller checkpoint hashes. Exact commands, environments (including the pinned Python environment in
`embodied/requirements.txt`) and known nondeterminism: [REPRODUCIBILITY.md](REPRODUCIBILITY.md).

## Citation

Naoto Fujie. *Ziran / Xeno Operational World Simulator: Operational-Shape Dynamics, Observability Generation, and
Description-Space Reorganization* (v0.4.0). Software, 2026. https://github.com/n-fujie/ziran-xeno-simulator

Machine-readable metadata: [CITATION.cff](CITATION.cff). No DOI has been assigned. License: MIT ([LICENSE](LICENSE)).
Security reports: GitHub private vulnerability reporting ([SECURITY.md](SECURITY.md)).

---

Further reading: [DESIGN.md](DESIGN.md) · [docs/architecture.md](docs/architecture.md) · [docs/claims.md](docs/claims.md) ·
[CHANGELOG.md](CHANGELOG.md) · [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md).
