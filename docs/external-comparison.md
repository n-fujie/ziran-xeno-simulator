# External Model Comparison — protocol and first findings

Branch `research/external-comparison`. The published release **v0.3.0 is frozen**: its tag is not moved, and
`src/`, `public/` and `bin/` are unchanged on this branch (checked by a test against the tag). No Level E and no
fourth-generation simulator are introduced. All new code lives in `comparison/`.

## Question

> Under matched data, matched interventions, matched temporal windows and matched resource constraints, which
> operational differences remain non-redundant across modelling frameworks?

The purpose is no longer to show that the Ziran / Xeno simulator can represent its own distinctions. It is to test
whether those distinctions preserve, detect, or make interventionally relevant operational differences that other
frameworks lose, merge, delay or make inaccessible — and to publish the cases where they do not.

## Design principles

- **Neutral worlds.** Each comparison world (`comparison/worlds/`) is a framework-neutral environment with an
  explicit apparatus. Action sets, sensor options and their costs, seeds, horizons and evaluation windows are the
  same for every framework. The Ziran / Xeno adapter runs *in* these worlds; the worlds are not v0.3.0 presets.
- **Matched conditions** (§2). Each world records input data, initial conditions, intervention history, horizon,
  computational budget, observation availability, measurement resolution, resource constraints and evaluation
  window, and states sameness per level (raw source, preprocessing, observation, state representation,
  intervention, operational effect) instead of inferring it from labels. Computational budget is *recorded, not
  equalized*.
- **Representative baselines.** Each framework family uses a standard formulation (see
  [baseline-definitions.md](baseline-definitions.md)). Where a first formulation omits a known capability, a
  **fairness configuration** tests the standard extension (§25).
- **No global winner** (§3). There is no score, rank or winner field anywhere; a test enforces this. Results are
  per-distinction statements: *"under configuration C and implementation B, distinction D was (not) retained"*.
- **Detection is read from outputs.** A framework "registers" a difference only if its own outputs contain it; ground
  truth comes from the true environment.
- **Ablations of Ziran / Xeno** (§26) are run in the worlds where each mechanism acts; unchanged measurements are
  reported as "no difference in this world".
- **Privileged access removed.** v0.3.0's observation reviser evaluates candidates by lookahead on retained physical
  snapshots. No baseline has that access, so the adapter evaluates candidates only on its own observation history.

## Frameworks

| family | formulations used |
|---|---|
| Agent-based modelling | agents with rules, shared environment, interaction network, synchronous schedule; scenario comparison; intervention sweep; structure selected by fit |
| Control / MPC | nominal and adaptive (RLS) MPC; synchronous P; Smith-predictor-style delay compensation; asynchronous MPC with a learned environment clock; local and centralized MPC |
| Reinforcement learning | tabular Q (fixed state, history-augmented, sensor action), goal-conditioned Q, hierarchical Q with options, clock feature; Monte Carlo policy evaluation (local / team reward) |
| Active inference | discrete generative models with expected free energy (pragmatic + epistemic); semi-Markov duration model; system preferences with observation modalities; Bayesian model comparison over structures |
| Digital twin | Kalman-synchronized twin with event-triggered recalibration; interacting-multiple-model twin; system twin with sync-gap monitoring; stream-level twin with / without an account variable |
| Dynamical systems | fixed-state and parameter-adaptive linear models; aggregate flow model |
| Viability / reachability | viability kernels (known mode, robust over modes; two control sets); information-state extension |
| Feature learning | MLP on lag windows (8 and 3 lags; 1000-epoch variant) |
| Ziran / Xeno adapter | v0.3.0 `paretoFront` / `selectFrom`, grammar morphogenesis (bounded, morphogenesis, full + meta-grammar), `replaySpec` + `fragilityTransfer` + description-space diff, J/K category predicate, multi-clock premise classification |

## Worlds (first deliverable: synthetic)

| world | what is tested |
|---|---|
| W1 observation aliasing | a hidden mode flips the actuator sign; two states identical under the initial apparatus diverge under the same intervention |
| W2 too-late correction | corrections land after a delay while the target switches on its own clock; correctness, timing, reconfiguration and realized effect are measured separately |
| W3 fragility transfer | one matched local optimization (A draws more and a meter is moved) against six downstream consequences, with ground truth |
| W4 description-space change | a regime needs a window-threshold distinction absent from the initial vocabulary; online cut-offs without regime boundaries |
| W5 thick category | paired worlds where an account category is relevant (A) or redundant (B) |

Full tables: [external-results.md](external-results.md) (generated). Machine-readable:
`results/external-comparison/*.json`.

## First findings (synthetic-world results)

- **W1.** Active inference with a mode factor (success 0.983), the IMM twin (0.981), the viability controller with an
  information state (0.980) and the Ziran adapter (0.981) perform alike, at similar energy (1.54–1.96; the IMM twin
  lowest). The adapter constructed a response-sign channel instead of installing a sensor; forcing the sensor
  raised energy to 12.6 for 0.985. A passive policy (u ≡ 0) already reaches 0.891 — above fixed-state RL (0.833) —
  and formulations that act on a wrong fixed mode (nominal MPC, fixed-mode viability, AIF without the factor, the
  Ziran ablation) fall to ≈ 0.54, i.e. acting on a wrong model is worse than not acting.
- **W2.** Delay compensation plus a learned environment clock reduces correct-but-too-late corrections from 265
  (synchronous control) to 14. The Ziran adapter's decisions are identical to asynchronous MPC; its additional
  output is a self-classification of its own corrections. All RL variants keep many too-late corrections (119–192).
- **W3.** ABM, centralized MPC, system-preference AIF and the system twin register most downstream consequences once
  they represent all units; viability registers closure precisely under two recovery definitions; the Ziran adapter
  registers transferred dependency, delayed failure and observation loss but not closure (without a declared probe)
  and B's displacement only in some seeds. Local formulations (local MPC, local-reward RL, local AIF) register only
  the local improvement — by design of their boundary, and the centralized variants close the gap.
- **W4.** No model class captured the window-threshold dependence within six rounds (oracle NMSE 0.031 vs fixed-state
  0.222); the 3-lag MLP came closest (0.189). All three v0.3.0 grammar variants gave identical results; removing the
  meta-grammar or representation-change operators changed nothing measured.
- **W5.** The Ziran adapter, active inference with Bayesian model comparison and an ABM whose structure is selected by
  fit give identical predictions in both worlds; the fixed-agent ABM fails in World B and the aggregate model in
  World A.

## Stop-condition analysis (§32)

Before any theoretical change is considered, each notable difference is attributed to a cause. Attributions are the
analyst's reading of the evidence, stated with that evidence.

| difference | attributed cause | evidence |
|---|---|---|
| W1 formulations without the mode fail after flips | representation mismatch | standard extensions (adaptive MPC, IMM, information state, AIF mode factor) close the gap |
| W1 fixed-state RL stays passive | representation (state) and reward | history-augmented and sensor-action RL improve; 10× data does not |
| W2 RL keeps too-late corrections | representation (no in-flight / clock state) and data | clock feature helps slightly (192 → 170) |
| W2 Ziran adapter = asynchronous MPC | no difference | identical decisions by construction |
| W3 local formulations miss downstream consequences | boundary (representation) | centralized MPC / system AIF register them |
| W3 Ziran adapter misses closure | configuration | adding a probe-relative reachability sweep registers it |
| W3 Ziran adapter registers B's displacement only in some seeds | implementation (v0.3.0) | `fragilityTransfer` uses duration-insensitive variance and has no share-reduction kind |
| W3 replayed missing samples do not lower observability | implementation (v0.3.0) | observation loss detected only through the description-space diff |
| W4 v0.3.0 grammar variants fail | implementation / grammar coverage and parameterization | diagnostic: window 1 → `step@v1(x)` retained; window 5 → nothing; selection criterion predicts all series including the driver |
| W4 nobody approaches the oracle | data / protocol / budget | mixed-regime training history; 1000-epoch MLP overfits |
| W5 Ziran = AIF-BMC = calibrated ABM | no difference | identical predictions |

**Conclusion of this phase.** No repeated, non-redundant *theoretical* limitation of the Ziran / Xeno framework is
demonstrated, and no mechanism is shown to be necessary beyond what standard, well-configured baselines provide in
these worlds. Two **implementation** issues in v0.3.0 `fragilityTransfer` (replay missingness; duration-insensitive
variance / no share-reduction kind) and one grammar-coverage limit are documented. They are not patched in the frozen
release; no theory change is made.

## Novelty wording

This work does not claim that any existing framework "cannot" do something. Statements are of the form "under
configuration C and implementation B, distinction D was not retained", and every such statement about a baseline
has a fairness configuration or an explicit note that the extension was not run.

## Running

```bash
npm run compare
```

```bash
npm run test:comparison
```

`npm run compare` regenerates `results/external-comparison/*.json` (byte-identical across runs; wall-time fields are
omitted) and `docs/external-results.md`. The v0.3.0 commands (`npm test`, `npm run bench`, …) are unchanged.

## Next step

Empirical evaluation on one public dataset with a documented provenance record — see
[empirical-evaluation.md](empirical-evaluation.md). The candidate is selected but not downloaded.
