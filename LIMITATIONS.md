# Limitations

**The system does not remove presuppositions; it exposes and partially revises some of them.**

This release is an open research prototype. The limitations below are part of what it reports, not a to-do list to
be hidden.

## Evidence

- **Synthetic-world dependence.** Every bundled world, trace and benchmark result is synthetic. Results describe what
  happens in these worlds under these configurations.
- **Lack of empirical validation.** No result has claim status *empirical observation* or *empirically supported
  generalization*. `promote()` refuses such promotions for synthetic evidence.
- **Benchmarks are written by the same authors as the mechanisms.** The conformance suite checks the specification;
  the theory and meta suites test model classes in worlds designed to make distinctions visible. None is empirical
  validation.
- **Single seeds.** Most theory benchmarks run one seed of one world; the uncertainty field of each benchmark says so.

## Models

- **Domain models are illustrative.** Physical, biological, institutional, market, AI and civilizational presets are
  small models; parameters and orders of magnitude are not calibrated measurements.
- **Reconstruction sources require scholarly verification.** Historical reconstruction records cite sources
  compactly; operationalizations (e.g. chreia as a price average) are contestable and recorded as such. Output is
  simulation-internal, `historicalFactualClaim: false`.
- **No hardware sensor morphogenesis.** Sensor redesign is simulated as placement growth along the coupling graph and
  as channel changes; there is no hardware interface.
- **No live trading or autonomous real-world execution by default.** Market presets are synthetic; nothing connects to
  exchanges, devices or external services.

## Meta-boundedness

- **Meta-boundedness.** Level C is open only within registered facets; Level D can register and retire registry
  entries but not change the registry interfaces.
- **Fixed engine event vocabulary.** Event kinds (ignition, operation, effect, no-effect, blocked, loss, detection,
  undetermined, aliasing, feedback, interaction, suppression, intervention, reorganization, state-space,
  meta-configuration, note, correction, reachability.probe-relative, reachability.emergent, probe) are fixed; trace schemas can only project them.
- **Fixed registry interfaces.** `MetaConfiguration`, `DescriptionFacet`, value-kind hooks, `TraceSchema`,
  `ParetoAxis`, feature constructors and benchmark definitions have fixed shapes.
- **Fixed Pareto dominance relation.** Axes are revisable meta-objects; dominance itself is not.
- **Fixed benchmark definitions.** Predicates are exposed and MB5 tests alternatives, but the benchmark set and its
  code are fixed.
- **Meta-operation templates remain supplied.** Grammar mutation step templates and the meta-operations register /
  retire / compose / abstract are code. Meta-grammar morphogenesis composes supplied steps; it does not invent new
  kinds of step.
- **No unrestricted state-space generation.** New descriptors appear only through registered facets and value kinds.
- **Emergent reachability is facet-relative.** A change no facet can render is invisible to it.

## Analyses

- **Provisional operational bundle recovery depends on traces, features, windows and grouping.** Recovered bundles depend on trace schema, feature
  constructors, window and grouping heuristic (MB3, MB6). Bundles are provisional; none is canonical. Hub storage
  merges sources.
- **Trader-category necessity is unresolved** (benchmark D): the lower-level bundle description is one choice of
  operational vocabulary.
- **Probe-relative reachability** is bounded by probes, option menu, fork horizon and observation configuration;
  closure is horizon-relative, not demonstrated irreversibility.
- **Observation revision** tests candidates on retained snapshots; some candidates are untestable that way.
- **Grammar search** is greedy and shallow; morphogenesis selection in benchmark B uses the whole series (evaluation
  is out of sample, selection is not online; the online `adaptationRun` is used in N).
- **Responsibility** depends on the supplied counterfactual variants and analysis boundary.
- **Fragility transfer** is reported only for supplied regions.
- **The nonequilibrium module** approximates dynamics inside the engine; there is no bridge to external solvers.
- **The `branch-mechanism` descriptor** is added when a rule is first observed to ignite stochastically, so the first
  stochastic ignition appears as a Level-C change.

## Research modules (v0.4.0)

- **External comparison:** synthetic worlds constructed and baselines implemented by the same author; small seed
  counts (3–5); no third-party reproduction; one replayed empirical dataset (Cascaded Tanks). Results do not establish
  field-wide superiority. See `docs/comparison-limitations.md` and `docs/cascaded-tanks-limitations.md`.
- **Xeno-14:** three of fourteen principles; planar simulated embodiments only; ignition inconsistent across seeds;
  no non-redundant control advantage; not a validation of Xeno-14.
- **Active Inference:** planar Xeno-Body prototype (MuJoCo Walker2d), not the full Xeno-Body; no lateral perturbation;
  latent states share the observation partition; likelihood A assumed; B learned from sparse calibration data; one
  decision interval of planning; the base controller stands without perturbation in only 2 of 5 seeds, which weakens
  the benchmark's ability to distinguish recovery improvements; timing measured in Python, where worst-case latency
  is dominated by process scheduling; no real-time guarantee is claimed for the current full control loop; runtime
  self-revision not implemented.

## Interface

- The server has no authentication and binds to `127.0.0.1` by default. Runs are held in memory only.
- Some perturbations (reconstruction transfer, hybridization, arbitrary reorganization triggers) need code or preset
  parameters; they are not all exposed as UI controls.
