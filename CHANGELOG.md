# Changelog

## v0.4.0 — 2026-09-29 · research modules (release candidate; not yet tagged)

Formal integration of reproducible external-comparison, Xeno-14 pilot, and planar Xeno-Body Active Inference research
modules. The release preserves negative and conditional findings and does not claim superiority, production
readiness, or full self-revision. The core simulator (`src/`, `public/`, `bin/`) is unchanged from v0.3.0; core engine
version 0.3.0.

### Added

- **External Framework Comparison** (`comparison/`): framework-neutral comparison schema, five synthetic worlds,
  conventional baselines with fairness configurations, Ziran / Xeno ablations, and the Cascaded Tanks replayed
  empirical evaluation (protocol CT-P1 frozen before fitting). Result: no field-wide superiority; under CT-P1 no
  non-redundant Ziran / Xeno distinction was observed.
- **Xeno-14 experimental integration** (`embodied/xeno14/`): three principles as removable modules on planar MuJoCo
  embodiments. X14-1: STOP. X14-1b: CONDITIONAL GO under its predefined rule; no non-redundant control advantage
  demonstrated.
- **Active Inference research module** (`embodied/active_inference/` and experiment harness): Milestone 1 for the
  planar Xeno-Body prototype. Computationally viable; stability unchanged; corrective movement and motor effort
  increased; the baseline controller stands without perturbation in only 2 of 5 seeds. No real-time guarantee is
  claimed for the current full control loop. Runtime self-revision is not implemented.
- Static read-only project page builder (`site/build.ts`).
- Pinned, clean-environment-validated Python dependencies for `embodied/` (`embodied/requirements.txt`,
  `embodied/requirements-lock.txt`).

### Changed

- README restructured into core simulator, research modules, released results, known limitations and future work.
- Package version 0.4.0; `CITATION.cff` version 0.4.0. The release test now expects package version 0.4.0 and still
  asserts core engine version 0.3.0.

### Not included

Active Inference Milestone 2 and later, Xeno-14 X14-2, 3D embodiments, further empirical datasets.

### Git history note

Older commits on the public research branches (`3ad2419`…`2f1e2e7`, `eec7a29`) contain Python bytecode caches with
ordinary local filesystem paths (a local user directory); no secrets or credentials. They were untracked in
`8c1a5e9` and `9bde9e2`. History is not rewritten; release tags are created only from clean commits.

## v0.3.0 — 2026-09-28 · first public release (open research prototype)

Release tag `v0.3.0` · repository https://github.com/n-fujie/ziran-xeno-simulator · author Naoto Fujie · license MIT · no DOI.

The third-generation architecture is frozen as the release baseline. This release does not add theoretical layers;
it tightens claims, exposes limitations, and packages the project for inspection, rerun and challenge.

### Included (cumulative)

- **Open operational values** — scalar, vector, relation, event, opaque, unknown and runtime-registered kinds with
  per-kind semantics; scalar adapter refuses non-scalars.
- **Operational-address separation** — operational addresses distinct from storage identity: split, merge,
  uncertain, transient, unavailable, related, reassigned, re-ignition without identity preservation.
- **A / B / C / D** — operation within a configuration, configuration reorganization, description-space
  transformation, meta-configuration transformation. Analytical distinctions, not ontological strata.
- **Probe-relative and emergent reachability** — forks over option menus; emergent reachability records
  description-space expansion / contraction, novelty by level and relative to configuration, description space,
  meta-configuration and history.
- **Grammar-bounded variable discovery and operator-grammar morphogenesis** — `G_t → G_{t+1}` through a registered
  mutation registry, out-of-sample criteria and a harm guard; supplied vs generated operators and variables labelled.
- **Meta-grammar morphogenesis** — recurring successful mutation recipes composed into meta-operators, abstracted and
  retired, with Level-D lineage.
- **MetaConfiguration** — registries for value kinds, description facets, transition classes, observation-revision
  candidates, grammar mutations, comparison metrics, emergence features, Pareto axes, trace schemas and benchmark
  predicates, with origins.
- **Trace-schema sensitivity** — six explicit trace schemas and re-analysis under each projection.
- **Provisional operational bundle recovery** — provisional operational bundles recovered under specified trace schemas, feature constructions, temporal windows, and grouping procedures; feature-constructor registry, neutral ids and provenance,
  multi-feature / multi-schema stability classification.
- **Pareto sensitivity** — Pareto axes as meta-objects with assumptions; Pareto set separate from selection; policy
  origin recorded; axis-perturbation benchmark.
- **Negative results and adversarial benchmarks** — G–L, M, N; outcomes positive / negative / null.
- **Meta-boundedness benchmarks** — MB1–MB7.
- **External data adapter** — `replaySpec`, `fromCSV`, provenance and missingness handling.
- **Claim-status system** — implementation property, synthetic-world result, model-class discrimination,
  reconstruction inference, replayed empirical result, empirical observation, empirically supported generalization,
  unresolved; refused promotions.
- Structured responsibility profiles, multi-axis vocabulary non-redundancy, fragility transfer, too-late
  correction, historically constrained operational reconstruction, TII support, exact rerun verification.

### Release preparation changes in v0.3.0

- Documentation: README restructured; DESIGN rewritten per abstraction (why / not assumed / fixed / failure);
  new LIMITATIONS, BENCHMARKS, REPRODUCIBILITY, CITATION.cff, LICENSE (MIT), CONTRIBUTING, SECURITY,
  `docs/claims.md`, `docs/negative-results.md`, `docs/architecture.md`, generated `docs/benchmark-results.md`,
  screenshots.
- Stopping principle and "A/B/C/D are not ontological strata" stated in README, DESIGN and the interface.
- Claim-status labels added to conformance checks (*implementation property*), reconstruction claims
  (*reconstruction inference*), benchmark D (*unresolved*), replayed traces (*replayed empirical result*).
- Meta-boundedness benchmarks now publish setup, compared configurations, stability predicate and failure criterion.
- Wording: "Autonomous science" preset titles and conformance layer 8 renamed to *variable construction*; category
  emergence output speaks of *recovered provisional bundles*.
- Interface: nine representative demos listed first; restrained landing description; singleton groupings collapsed
  in the trace-schema sensitivity view; benchmark rendering race fixed; meta-benchmark failure criteria shown.
- CLI: `bench --suite conformance|theory|meta`, `check-presets`; scripts `check:api`, `docs:benchmarks`.
- Server binds to `127.0.0.1` by default (`HOST` to override).
- Package version 0.3.0.

### Next research phase

External model comparison and external empirical data (see README §10). No fourth-generation redesign is planned
before that.

### Unresolved

- Whether any positive synthetic result holds on external data (no external dataset is bundled).
- Trader-category necessity (benchmark D).
- Whether meta-grammar morphogenesis helps in any world (benchmark N is negative here).
- How results compare with agent-based modeling, control / MPC, reinforcement learning, active inference, digital
  twins, hybrid-system simulation and viability / reachability methods under matched conditions.
- Stability across seeds for most theory benchmarks (single-seed).

## v0.2.0 — 2026-09-28 (internal)

Second generation: open values, storage / operational address separation, probe-relative and emergent reachability,
grammar morphogenesis, structured responsibility, vocabulary non-redundancy, revised trader test, S_t → S_{t+1}
lineage, Theory-Discriminating Benchmarks A–F.

## v0.1.0 — 2026-09-27 (internal)

Initial build: minimal operational core, domain layers, 13-layer conformance benchmark, interface, TII.
