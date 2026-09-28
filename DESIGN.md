# Design

This document describes the v0.3.0 architecture, which is frozen as a research prototype. For every major abstraction
it states **why it exists**, **what it does not assume**, **what remains fixed**, and **how it can fail**.

## 0. Orientation

The theoretical centre of the framework is unchanged: **operational shape, configured ignition conditions, real
effect, real penetration, feedback, reorganization.** Everything else in this repository serves the tracking of that
sequence:

```
C_t → Δ_t → ignition → operation → real effect → penetration → feedback → reorganization → C_{t+1}
```

**A/B/C/D are not ontological strata. They are revisable analytical distinctions used to localize different forms
of operational change.**

- **A — operation within a configuration** (real effects inside `C`);
- **B — configuration reorganization** (`C_t → C_{t+1}`);
- **C — description-space transformation** (`S_t → S_{t+1}`);
- **D — meta-configuration transformation** (`M_t → M_{t+1}`).

A higher letter is not a deeper reality, a superior explanation or a more advanced intelligence. A change can be
recorded at several levels at once (a facet registration is a Level-D reorganization, a meta-configuration event, and
a Level-D state-space entry).

**Meta-boundedness** is not a new theoretical centre. It is what results from applying the framework's commitments
reflexively to the simulator itself: the simulator is also a configuration whose conditions (facets, grammars,
schemas, axes, predicates) shape what can ignite as a result.

**Stopping principle.** A fixed condition is not automatically a theoretical defect. A fixed condition becomes a new
experimental object only when changing it produces a non-redundant difference in observation, intervention,
reachability, real effect, penetration, feedback, reorganization, or the interpretation of the result. The release
therefore does not add a Level E and does not recursively meta-model its remaining fixed rules merely to appear more
open.

**Categories.** Thick categories (human, agent, market, trader, organism, belief, goal, capability, …) are kept out of
`src/core` — Layer 0 of the conformance suite scans for them. They are not removed as an achievement: domain layers
introduce them where they produce non-redundant operational differences, and analysis modules test when that is so.

---

## 1. Minimal operational core (`src/core/`)

The core knows storage keys holding opaque values, operational addresses, configuration dimensions, clocks, ignition
rules, couplings, observation apparatuses, probes, the description space, the meta-configuration and the trace.

- **Why it exists.** Something must hold, schedule, propagate and record differences without deciding in advance what
  the world is made of.
- **Does not assume.** Persons, agents, goals, beliefs, capabilities, markets, organisms, a single observer, a single
  timescale, a single variable system, or that storage identity is the operational unit.
- **Remains fixed.** The object types themselves, the scheduler (a heap ordered by time; rules on one clock read the
  same pre-tick state), the event vocabulary of the trace, the hashing scheme.
- **How it can fail.** A world whose relevant structure cannot be expressed as rules, couplings and values over
  storage keys; or a category smuggled into the core under a neutral name (Layer 0 only scans identifiers).

## 2. Value semantics (`core/values.ts`)

Storage values are opaque operational values of registered kinds: scalar, vector, relation, event, opaque, unknown,
and kinds registered at runtime (e.g. `interval` in `meta.runtime-value-kind`). Each kind declares `equals`,
`difference`, `transmit`, `receive`, and optionally `magnitude`, `distance`, `serialize`, `render`, `distinctions`.

- **Why.** Numbers are not the universal ontology; a relation-valued spread carries distinctions a scalar encoding
  loses (theory benchmark F).
- **Does not assume.** That every difference has a magnitude or a distance. `ctx.get` (the scalar adapter) throws on
  non-scalar values instead of inventing placeholders.
- **Fixed.** The hook interface; the built-in kinds' semantics.
- **Can fail.** A kind whose `difference` misreports "no change" hides real effects; a domain may still collapse
  values into scalars by choice (the validator flags numeric collapse only where it can see it).

## 3. Operational addresses (`types.ts` `OperationalAddressSpec`, `emit.opAddress.*`)

An operational address `{storage[], domains[], status, lineage, relations}` is separate from storage identity. It can
span several storage nodes, share nodes with other addresses, split, merge, become uncertain (with candidates),
transient (ttl), unavailable, related to other addresses, reassigned, and re-ignite under a new address without
identity preservation.

- **Why.** Stable storage identity can mislead about what persists operationally (theory benchmark M,
  `adversarial.slot-reuse`).
- **Does not assume.** Persistent identity, one-to-one mapping between storage and operational units.
- **Fixed.** The set of address operations and statuses.
- **Can fail.** Addresses are declared by domain code; the engine does not discover them. A wrong declaration is
  traced faithfully, not corrected.

## 4. Observation (`apparatus`, `core/engine.ts` framing, `ziran/reviser.ts`)

Several apparatuses coexist; none is privileged. Channels have placement (reads), aggregation, resolution, range,
boundary, window, noise, cost and optional construction. Every world difference gets an epistemic status per
apparatus: detected, not-measured, boundary-hidden, below-resolution, scale-incompatible,
temporal-window-incompatible, apparatus-incompatible, inaccessible. There is no `absent`.

Aliasing: states identical under the observation map that diverge under the same intervention signature produce an
aliasing record. The observation reviser then generates candidate apparatus changes (resolution, boundary,
disaggregation, constructed variable, external memory, sampling regime, relocation, placement grown along the
coupling graph), evaluates them by counterfactual lookahead on explicit Pareto axes, forms the Pareto set, and applies
a selection policy whose origin is recorded.

- **Why.** Observability is generated and revised, not given; a revision can hide another difference, drain resources
  or add fragility.
- **Does not assume.** That the cheapest resolving revision is best; that any selection policy is theoretically
  privileged; that non-detection is absence.
- **Fixed.** Candidate generators; the lookahead horizon mechanism; the Pareto dominance relation; the axis
  definitions (axes are registry entries with assumptions, but their computations are code).
- **Can fail.** Revision tests candidates on retained physical snapshots; "untestable on snapshots" candidates cannot
  be compared. With few snapshots the trade-off is noisy. Benchmark G shows a revision that resolves an alias without
  downstream benefit.

## 5. Ignition (`rules`)

A rule is `when → then` on a clock, with delay and refractory period. Intents are computed at ignition and applied
after the delay.

- **Why.** Configured ignition conditions are the framework's central object; delay makes delayed activation and
  too-late correction representable.
- **Does not assume.** A global simulation clock or an agent that "decides".
- **Fixed.** Synchronous reading within a clock tick; the ignition record format.
- **Can fail.** Rule code is arbitrary TypeScript; `specHash` includes rule source text, but semantic equivalence of two
  differently written rules is not detected.

## 6. Effects

Only actual differences (per the value kind's semantics) become `effect` events; others are `no-effect` or `blocked`
(resource needs not met).

- **Why.** Real effect must be distinguishable from attempted operation.
- **Does not assume.** That output similarity implies operational similarity (eight comparison levels in
  `analysis/compare.ts`).
- **Fixed.** Effect equality tolerance (1e-12 for scalar effects; replay compares at 1e-9).
- **Can fail.** A kind with coarse `equals` suppresses effects.

## 7. Penetration (`couplings`, `core/penetration.ts`)

Couplings are directional channels along which a difference penetrates: gain, delay, transform (linear, threshold,
saturate, sign, invert, square, rectify), loss threshold, medium. The penetration report follows an effect downstream
across media, scales, address domains and clocks, with amplification, attenuation, transformation, loss, branching,
closure and reappearance.

- **Why.** Real penetration across coupled configurations cannot be read off local state.
- **Does not assume.** Reciprocity.
- **Fixed.** Transform set; penetration tracking depth and node limits.
- **Can fail.** Rules that read state directly (not via couplings) create influence the penetration report attributes
  only through cause edges.

## 8. Feedback

Feedback is detected structurally: a descendant of an ignition modifies something that ignition read (world,
configuration, observation, rule, coupling), including observation-mediated reads.

- **Why.** Feedback that modifies conditions is what distinguishes reorganization from mere change.
- **Fixed.** The definition via read sets and cause edges.
- **Can fail.** Under a trace schema without read sets (`A0-no-read-sets`) feedback and several analyses degrade —
  exposed by MB3.

## 9. Reorganization (Level B)

Rules and interventions can add, remove, split, merge or re-resolve dimensions, rules, couplings, apparatus and
addresses. All reorganizations are ordinary effects with a level tag.

- **Why.** Reorganization is normal operation, not an external edit.
- **Does not assume.** That reorganization is beneficial — benchmark L shows it damaging a stable configuration.
- **Fixed.** The set of reorganization targets.

## 10. Reachability (`engine.ts` forks)

**Probe-relative reachability**: declared probes are evaluated in forks of the world for each option in a menu, within
a horizon; it is relative to probes, option menu, horizon and observation configuration. Closure is *horizon-relative
closure*, not demonstrated irreversibility. **Emergent reachability**: in the same forks, description-space expansion
and contraction and branch grammar are recorded independently of probes, with novelty layered by level (A/C/D) and
recorded relative to configuration, description space, meta-configuration and history.

- **Why.** What becomes reachable or unreachable is a primary consequence of operations.
- **Does not assume.** That the probes enumerate the relevant possibilities (emergent reachability exists because
  they do not).
- **Fixed.** Fork mechanism, horizon, option menus (declared per preset).
- **Can fail.** Anything outside the horizon or the option menu; emergent reachability sees only what the registered
  facets can render.

## 11. Description-space lineage (Level C, `core/description.ts`)

The description space `S` is rendered through registered **description facets** (17 defaults: configuration
dimensions, resolutions, storage dimensions, value kinds, representations, relation types, topology, channels,
channel resolution/scale, boundaries, variable systems, transition classes, branch mechanisms, operational addresses,
address relations, re-ignition routes). `S_t → S_{t+1}` changes are traced with lineage, expansion and contraction,
and lost distinctions.

- **Why.** A run is not only motion inside a fixed state space; probe-identical runs can differ in description
  space (`open.novel-dimension`).
- **Does not assume.** That the current facets are complete.
- **Fixed.** The `DescriptionFacet` interface, `describeSpace`/`diffSpace`, and the Level C/D classification.
- **Can fail.** A change no facet can render is invisible (MB1: the result survives retiring any single facet, but not
  retiring three together).

## 12. MetaConfiguration (Level D, `core/meta.ts`)

`M_t` holds registries: value-kind, description-facet, transition-class, observation-revision-candidate,
grammar-mutation, comparison-metric, emergence-feature, pareto-axis, trace-schema, benchmark-predicate. Entries carry
origins (supplied, generated, composed, inherited, domain-registered, retired). Registration and retirement during a
run are Level-D reorganizations with `M_t → M_{t+1}` lineage and hashes.

- **Why.** To make supplied conditions inspectable and some of them revisable.
- **Does not assume.** That making a condition explicit removes it.
- **Fixed.** Registry interfaces, the code consulting them, and the meta-operations register / retire / compose /
  abstract.
- **Can fail.** A registry entry can be present but ignored by code that does not consult it; only the registries
  listed above are consulted.

## 13. Grammar morphogenesis (`analysis/grammar-bounded.ts`, `analysis/grammar-morphogenesis.ts`)

**Grammar-bounded variable discovery** (baseline): variables are constructed from a supplied, fixed operator grammar
(depth ≤ 2). In `science.hidden-attraction` the result is stated as "the system selected an inverse-square relational
variable from the supplied construction grammar". **Operator-grammar morphogenesis**: `G_t → G_{t+1}` through
registered mutation operators (delay, window, temporal-diff, discretize, sign, continuize, compose, arity-change,
param-mutation) with data-derived parameters; a change is retained only if it improves a named criterion
(prediction, discrimination, intervention, robustness, branch discovery, reachability differentiation) out of sample,
under a harm guard. **Meta-grammar morphogenesis**: recurring successful mutation recipes can be composed into
meta-operators, abstracted and retired, with Level-D lineage.

Every operator and variable is labelled **supplied** or **generated** (with the mutation that produced it); sensors
are labelled supplied or revised; facets supplied or domain-registered.

- **Why.** A hidden law outside the initial grammar cannot be found by selection from that grammar (benchmark B).
- **Does not assume.** That generated structure is correct because it predicts; that more grammar change is better.
- **Fixed.** Step templates, the mutation registry's entries, evaluation code (block cross-validation, harm guard),
  thresholds.
- **Can fail.** Benchmark H (fixed grammar wins in a stable world) and N (meta-grammar does not adapt faster) are
  negative results in this release.

## 14. Trace schemas (`meta/trace-schema.ts`, `meta/schema-sensitivity.ts`)

The trace is not neutral. A `TraceSchema` states which event kinds and fields are kept, which cause edges survive,
temporal aggregation, value discarding and relation flattening. Six schemas are supplied (`full`,
`A-ignition-effect`, `B-plus-observation-revision`, `C-plus-coupling-lineage`, `A0-no-read-sets`, `coarse-5`).
`traceSchemaSensitivity` re-runs analyses under each projection.

- **Why.** Analyses (bundles, labels, responsibility, reachability) depend on what the trace records.
- **Fixed.** The engine's own full event vocabulary; projection is lossy by construction and cannot add information.
- **Can fail.** MB3: label correspondence and bundle agreement are schema-dependent.

## 15. Provisional operational bundle recovery (`analysis/emergence.ts`)

Bundles are recovered from unlabeled traces (opaque tokens) using registered feature constructors (timing,
ignition-rate, onset-pattern, feedback-dependence, reachability-effects, penetration, reorganization,
observation-dependence, resource-dependence, temporal-scale, coupling, observation-sharing, resource-sharing,
ignition-co-occurrence). Labels are applied afterwards and compared.

The only form of claim is: *provisional operational bundles recovered under specified trace schemas, feature constructions, temporal windows, and grouping procedures* — e.g. "a provisional operational bundle was recovered under trace schema X,
feature construction Y, temporal window T and grouping procedure P". Each bundle carries neutral id, source schema, feature constructors, window, grouping procedure,
resampling and perturbation stability, and a downstream profile; `multiEmergence` classifies bundles as stable,
feature-sensitive, schema-sensitive or unstable, and no grouping is canonical.

- **Why.** To test when a thick label corresponds to an operational bundle rather than assuming it.
- **Does not assume.** Natural kinds.
- **Fixed.** Grouping heuristic (inverse-popularity coupling + feature similarity + label propagation).
- **Can fail.** Hub storage merges many sources into one bundle; MB6 shows every multi-token market bundle is
  feature-sensitive or unstable.

## 16. Vocabulary non-redundancy (`analysis/vocabulary.ts`)

A vocabulary (e.g. a space-of-reasons vocabulary) is profiled on seven axes — predictive, interventional,
reachability, observational, penetration, temporal, reorganization — each evaluable or not, with gain beyond an
optional base vocabulary. The single label is a derived view only.

- **Can fail.** Axes with few samples are marked non-evaluable rather than guessed; gains are for one run.

## 17. Responsibility (`analysis/responsibility.ts`)

Responsibility points are computed by counterfactual variants (absence, timing, resource, coupling, boundary,
observation) and reported as a **structured difference** (changed values by kind, probes, branches, timing,
observation conditions, resource dependencies, penetration, reorganization, fragility location). There is no
universal Euclidean distance; the analysis boundary is a parameter (benchmark E: localization is boundary-relative).

- **Does not assume.** Moral responsibility; a scalar blame score.
- **Can fail.** Variants are supplied; an untested variant cannot localize anything.

## 18. Capability

Capability is not a core type and not an analysis scalar. Capability-like vocabularies are tested only after
operational tracking, through vocabulary profiles and category tests.

## 19. Fragility transfer (`analysis/fragility.ts`) and too-late correction (`analysis/timing.ts`)

Fragility transfer compares a base and a variant run over regions: risk moved, margin reduced, new dependency,
resource burden moved, observability reduced, delayed instability, failure moved / concentrated / distributed.
Every accepted optimizer step carries a transfer report. Correction timing classifies corrections as correct in time,
correct but too late, correct but failed to modify, incorrect, undetermined, using the premise evaluated at ignition
and when the effect lands.

- **Can fail.** Regions are supplied; fragility outside them is not reported. Benchmark I: asynchronous clocks can add
  no distinction.

## 20. Historical reconstruction (`domains/thought.ts`)

Only *historically constrained operational reconstruction*. Each reconstruction record separates source evidence,
historical configuration, reconstruction model, inference assumptions, uncertainty and generated behaviour. Output is
only of the form "Under reconstruction R and configuration C, operational pattern P re-ignited and produced
transition T", marked `simulationInternal: true`, `historicalFactualClaim: false`, claim status *reconstruction
inference*. Certainty phrasing about persons ("… would definitely …", "… predicts …", "… chooses …") throws.

- **Does not assume.** That a reconstruction is the historical person or their views.
- **Can fail.** Source citations are compact and require scholarly verification; operationalizations are contestable
  (recorded in each record's uncertainty notes).

## 21. Domain modules (`src/domains/`)

Domain modules only build `WorldSpec`s, rule bundles, facets and value kinds; they never redefine the core. They are
small illustrative models, not calibrated measurements.

## 22. Benchmark architecture (`src/bench/`)

- `layers.ts` — **Implementation Conformance** (Layer 0 anti-regression, Layers 1–13 and 3.5; 57 checks); claim
  status *implementation property*; checks above a failing layer are *untrusted*.
- `theory.ts` — **Theory-Discriminating** A–N; each exposes model classes, initial configuration, perturbation,
  measured outcomes, success predicate, uncertainty, counter-evidence and alternative predicates; outcome positive /
  negative / null; claim status *model-class discrimination* or *unresolved*.
- `meta.ts` — **Meta-Boundedness** MB1–MB7; statements of the form "under this perturbation, result R was / was not
  stable to changes in meta-configuration M"; claim status *synthetic-world result*.

The benchmark definitions themselves are fixed code written by the same authors as the mechanisms they test. That is
the main reason none of the suites is empirical validation.

## 23. External data adapter and claim status (`external/adapter.ts`, `meta/claims.ts`)

`replaySpec` turns an `ExternalObservationSet` (provenance, apparatus, sampling, samples; missing samples become kind
`unknown`) into a replayable world; `fromCSV` reads simple tables. Traces carry evidence labels (`synthetic`,
`replayed-empirical`, …) and claim status. `promote` refuses to turn a synthetic result into an empirically supported
generalization; `summarize` refuses to mix evidence labels silently. No external dataset is bundled.

---

# Appendix — framework → implementation map

The table below maps the original framework sections to code. Section names reflect the specification's vocabulary;
the implementation claims are those stated in the body above.


| § | Requirement | Where |
|---|---|---|
| 2nd gen: open values | numbers are not the universal ontology | `core/values.ts`, `write()`/`propagate()`/`onArrive()` via semantics; `open.relation-spread`; theory F |
| 2nd gen: addressing | storage ≠ operational address | `OperationalAddressSpec`, `emit.opAddress.*`, `ctx.op()`, `open.operational-address` |
| levels | A: within C · B: C_t→C_{t+1} · C: S_t→S_{t+1} · D: M_t→M_{t+1} | reorganization `level`, `state-space` events, `trace.stateSpaceLineage`, `summary.levels` |
| I | transition cycle; coupling, splitting, merging, persistence, suppression, amplification, attenuation, delayed activation, recurrence, closure, reopening, irreversibility, history dependence, multistability, critical transition, localization, penetration, nonreciprocity, nonequilibrium, chaos, reorganization; downstream possibility changes per operation | `engine.ts` (rules, couplings, delay, refractory, `interaction`/`suppression` events), `reach()` (became-reachable/unreachable, conditionally-reachable, delayed, branches appeared/disappeared, `onEveryOperation` or on `analyze` ignitions), `trace.ts` irreversibility (horizon-bounded), presets `core.operational-sampler`, `physical.*` |
| II | configuration primary, extensible, partially unknown, dimensions revisable | `Dimension`, `emit.dim.*`, `configuration` perturbation, rates indexed by configuration state |
| III | not detected ≠ absent | `EpistemicStatus` has no `absent`; every world difference gets a status per apparatus: detected / not-measured / boundary-hidden / below-resolution / scale-incompatible / temporal-window-incompatible / apparatus-incompatible / inaccessible; observation values are `null` (not 0) when unavailable; `validateTrace` and Layer 0/2 enforce it |
| IV | observability generation; aliasing trigger; three questions | `frame()` aliasing records (same observation key + same intervention signature → divergent next key, with retained snapshots); `ziran/reviser.ts` answers *what was unavailable*, *which apparatus change*, and — by counterfactual lookahead — *does it alter reachability* |
| 2nd gen: revision trade-offs | a revision may hide another difference, drain resources, add fragility | reviser evaluates every candidate by `ctx.lookahead` (lost/new observability, resource cost and depletion, blocked operations, probe changes, delayed consequences, description-space change); Pareto front; policies `pareto-min-loss` (default, origin recorded, not privileged), `pareto-all`, `cheapest`, `lexicographic`, `none`; axes are `ParetoAxis` meta-objects; relocation candidates; sensing cost (`ChannelSpec.cost`); `observation.sensor-budget` |
| V | real effect, real penetration | only actual differences become `effect` events (others: `no-effect`, `blocked`); `penetration.ts` tracks media, scales, address domains, clocks, amplification/attenuation/transformation ratios, losses, branching, closure, reappearance |
| VI | feedback modifies conditions; reorganization is ordinary | structural feedback detection (a descendant of an ignition modifies something it read — world, configuration, observation, rule, coupling — including *observation-mediated* reads); all reorganizations are effects of rules or interventions |
| VII | minimal symbolic core | §1 above |
| VIII | local rates only | `analysis/rates.ts`: unavailable when too few events or constant across windows and configuration states; always indexed by window and configuration hash |
| IX | speed; correct / in time / too late / incorrect / undetermined | correction rules carry a `premise(ctx, basis)`; the engine evaluates it at ignition (epistemic) and when the effect lands (operational), and monitors environmental reconfiguration; `analysis/timing.ts` latencies |
| X | fragility transfer; every optimizer must detect it | `analysis/fragility.ts` (risk moved, margin reduced, new dependency, resource burden moved, observability reduced, delayed instability, failure moved/concentrated/distributed); `analysis/optimize.ts` attaches a transfer report to every accepted step |
| XI | body without commands; Xeno-14 as optional bundles; simultaneous organizations | `domains/body.ts` (14 bundles; command-centred default only for comparison), `analysis/interplay.ts` (competition, cooperation, suppression, lock-in, silencing, sensor redistribution, path and resource change) |
| XII | xeno-body media substitution | `domains/physical.ts` `MEDIA` table (electrical, liquid-metal, optical, ionic, ionogel, tensegrity, hydrogel, mechanical, chemical); `medium-substitution` perturbation; `xenobody.coordination` |
| XIII | sensor morphogenesis (simulated; no hardware) | reviser candidates: resolution, boundary, disaggregation, constructed variable, external memory, sampling regime, and **placement grown along the physical coupling graph** |
| XIV–XV | variable construction (supplied and revisable grammar) | `analysis/grammar-bounded.ts` — **grammar-bounded variable discovery** (baseline; supplied fixed grammar, depth ≤ 2). The gravity result is reported as "the system selected an inverse-square relational variable from the supplied construction grammar under this configuration". `analysis/grammar-morphogenesis.ts` — **operator-grammar morphogenesis**: G_t → G_{t+1} via compose, delayed/temporal/windowed operators with data-derived parameters, relational arity change, continuous↔discrete representation change, parameter mutation/split, variable and operator deletion; retention by prediction, discrimination, intervention, robustness to configuration change, branch discovery or reachability differentiation (recorded per change), with an out-of-sample harm guard; `science.delayed-law`; theory B |
| XVI–XVII | keep belief/implementation/inference/… distinct; capability only after operational tracking; compare vocabularies | `analysis/vocabulary.ts`: `vocabularyProfile` — seven axes (predictive, interventional, reachability, observational, penetration, temporal, reorganization), each evaluable or not, with gain beyond an optional base vocabulary; the shorthand label is a derived view only. `compareVocabularies` (predictive) is kept. `analysis/emergence.ts` discovers bundles from unlabeled traces (opaque tokens) and compares later thick labels |
| XVIII | responsibility points | `analysis/responsibility.ts`: counterfactual variants (absence, timing, resource, coupling, boundary, observation) → **structured difference** (changed values by kind, probes, probe-relative and emergent branches, timing, observation conditions, resource dependencies, penetration, reorganization, fragility location); no universal Euclidean distance; an optional domain metric only when supplied; analysis boundary is a parameter (theory E) |
| XIX | goals not primitive; declared / represented / pursued / maintained / achieved separable | `analysis/goals.ts`; goals appear as notes, addresses or rules; `goal-insertion`/`goal-removal` perturbations; the R-aristotle-oikonomia-v1 reconstruction transforms its goal (reconstruction-derived transition) |
| XX | belief-models by operational consequence | belief-like configurations are rule bundles and address states; their consequences are traced like any other (e.g. score ecology, reconstruction patterns) |
| XXI–XXII | xenothinking; historically constrained operational reconstruction ≠ persona (statements carry uncertainty; `reconstructionClaim` marks them simulation-internal, `historicalFactualClaim: false`) | `domains/thought.ts`: commitments in address domains, inscription into media, domain loss, re-ignition with transformation/splitting, machine reactivation; `Reconstruction` records separate source evidence, historical configuration, model, inference rules, uncertainty; output only as "Under reconstruction R and configuration C, operational pattern P re-ignited and produced transition T."; certainty claims throw |
| XXIII | "human" not always a unit | `domains/hybrid.ts` `humanNecessity`: interventionally necessary in some configurations, redundant in others |
| XXIV | AI/LLM operational separation | `domains/ai.ts`: world difference → encoding → label implementation → objective → credit assignment → parameter update → activation/output → institutional effect → training-data feedback, each a separate ignition on its own phase clock; loss falls while the concept is not tracked |
| XXV | Ziran System | `ziran/`: reviser, conditional processes (start/stop), historical difference reinsertion, multi-timescale comparison, conditional coupling. MO/DO/ZCA/MS/ΩⅨ/R-A/HDA would be further rule bundles; the core does not assume them |
| XXVI | multiple timescales | per-clock scheduling with labels (machine, sensor, body, social, institutional, economic, ecological, biological, geological, civilizational); presets combine up to five |
| XXVII–XXVIII | CICGI; remnants | `domains/civilization.ts` `civ.cicgi`, `cicgiIntervals`; remnant stores re-ignite after collapse; `thought.reignition` inaccessibility after medium destruction |
| XXIX | xeno-capital | `capital.xeno` + `capitalCategoryTest` (a single fungible scalar vs distinct resources) |
| XXX–XXXI | score ecologies; law penetration | `domains/institution.ts` |
| XXXII, XLIV | markets; first historical/market experiment | `domains/market.ts`: historically constrained operational reconstruction R-aristotle-oikonomia-v1, contemporary human trading configuration, rule-based system, adaptive AI, human–AI hybrid; `compareParticipants`; revised `traderCategoryTest`: (1) matched aggregate flow, (2) lower-level operational bundle descriptions (`role-bundles`: feedback-sensitive, observation-conditioned, latency-sensitive, resource-bounded, adaptive), (3) event-level trader-beyond-role test → verdicts `aggregate-flow model insufficient; trader-category necessity unresolved` / `trader vocabulary redundant given operational bundle description` / `trader non-redundant given the tested bundle descriptions` / aggregate sufficient; theory D |
| XXXIII | media and world re-ignition | `media.songline`, `thought.reignition` media |
| XXXIV | "thing-in-itself engineering" | physical-implementation / sensor / medium / boundary perturbations; reviser placement growth; `observation.hidden-phase` |
| XXXV | nonequilibrium & biophysical | `physical.*`: nonreciprocal excitable chain, bistable ramp (hysteresis, early warning), chaotic lattice (Lyapunov estimate), repair/regeneration/homeostasis |
| XXXVI | neural / non-neural | medium non-redundancy: fast coordination needs a fast medium (electrical or an optical substitute), slow holding does not |
| XXXVII | signal/code/…/meaning separable | these words are not in the core; vocabularies can be tested with `analysis/vocabulary.ts` |
| XXXVIII | ethical weight without one metric | irreversibility, dependency, fragility transfer, repairability, reachability loss, resource burden, asymmetry, speed mismatch are separate outputs; nothing aggregates them |
| XXXIX | machine-run variable and observation revision (under supplied grammars and candidate generators) | reviser + variable generation run without human-readable labels; traceability kept in the trace |
| XL | TII | `core/tii.ts`: deterministic content-addressed ids for rules marked `tii`, test status, JSONL for a TII ledger, shared across exact reruns |
| XLI | cross-configuration comparison | `analysis/compare.ts`: label, nominal input, measured difference, ignition condition (condition code hash + inputs), operational transition (operation code hash + deltas), output, downstream penetration, reachability change |
| XLII | 20 experiment types | `core/perturbations.ts` (`PERTURBATION_TYPES`); tested in `test/core.test.ts` |
| XLIII | layered benchmark | `bench/layers.ts` — **Implementation Conformance Benchmarks** (Layer 0 + 1–13 + 3.5, 57 checks; untrusted above a failing layer; conformance, not validation). `bench/theory.ts` — **Theory-Discriminating Benchmarks** A (fixed vs self-revising observation), B (fixed variables vs grammar-bounded vs morphogenesis), C (single vs asynchronous clocks), D (aggregate flow vs operational bundles; no winner predefined), E (fixed vs revisable boundary), F (scalar vs open values); adversarial G–L; M (storage identity vs operational address); N (meta-grammar). `bench/meta.ts` — **Meta-Boundedness** MB1–MB7 |
| XLV | small core, extensible domains | §1; domain code only builds `WorldSpec`s and bundles |
| XLVI–XLVII | interface, visualization | `public/` (see README) — nodes are events/differences, not persons/concepts |
| XLVIII | reproducibility | trace keeps initial configuration, observation configuration, rule ids + code hashes, parameters, seed, interventions (with code), timing, reorganizations, sensor/variable/boundary/resource changes, TIIs, complete event log; `specHash` includes rule source text; `runHash` over the event log; `rerun()` |
| XLIX | anti-regression | Layer 0 scans `src/core` for thick-category identifiers and checks the epistemic type; the rules below |

## Anti-regression rules as enforced

- The core has no human, agent, AI, belief, goal, capability, responsibility, reason, language, information,
  representation, market, organism, neuron, trader or person type or field (Layer 0).
- No single observer, variable system, ontology, timescale, boundary or fixed apparatus: several apparatuses,
  per-clock scheduling, revisable dimensions and apparatus, address reassignment.
- Undetected ≠ absent (type, validator, Layer 2).
- Identical output ≠ identical operation (eight comparison levels).
- Goal achievement ≠ success; correction ≠ timely correction; local optimization ≠ global improvement.
- Belief classification ≠ physical implementation; loss ≠ concept; reconstruction ≠ person.
- Category removal is not treated as achievement: every category claim is a non-redundancy test with seeds.

## Stop conditions checked

| stop condition | status |
|---|---|
| all values collapse back into numbers | no: open kinds stored and traced; scalar adapter throws on non-scalars; validator flags numeric collapse |
| all reachability depends on predefined probes | no: emergent reachability runs without probes |
| all generated variables depend on a fixed grammar | no: morphogenesis changes G; grammar-bounded is labelled baseline |
| historical reconstruction becomes persona simulation | no: statements only in reconstruction form, with uncertainty; guard rejects person claims |
| capability / responsibility become scalar traits | no: responsibility is a structured profile; capability is not a core or analysis scalar |
| category non-redundancy becomes prediction-only | no: seven axes |
| cheapest observation revision treated as best | no: Pareto front; default policy is not cheapest |
| aggregate-flow failure proves "trader" | no: bundle descriptions and trader-beyond-role test first |
| conformance presented as theory validation | no: separate suites and labels |
| state-space change represented only as movement in a fixed space | no: S_t → S_{t+1} lineage |
| description facets fixed code | no: facets are registry entries; domains register facets at runtime (Level D) |
| value kinds fixed in core source | no: `ValueRegistry.add` at runtime; `meta.runtime-value-kind` |
| grammar mutations fixed and invisible | no: `MUTATION_REGISTRY`; meta-operators composed / retired with lineage |
| trace schema invisible | no: explicit `TraceSchema`, six schemas, sensitivity analysis |
| discovered bundles treated as canonical | no: provisional metadata, neutral ids, multi-feature/multi-schema stability |
| Pareto axes / selection policy privileged | no: axes are meta-objects with assumptions; front and selection separate; policy origin recorded |
| benchmark predicates hidden | no: every theory benchmark exposes predicate and counter-evidence |
| only positive results reported | no: G, H, K, L, N are negative in this implementation; D, I null |
| stable storage identity assumed to be the operational unit | no: benchmark M, uncertain / transient / reassigned addresses, re-ignition without identity |
| synthetic results promoted to empirical support | no: `promote` refuses; evidence labels on every trace |

