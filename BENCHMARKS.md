# Benchmarks

Three separate suites. **None of them is empirical validation.** Every result carries a claim status. The full,
generated per-benchmark record — hypothesis, setup, compared models, measured outputs, predicate, expected
distinction, failure criterion, actual result and claim status — is in
[docs/benchmark-results.md](docs/benchmark-results.md). Regenerate it with:

```bash
npm run docs:benchmarks
```

## 1. Implementation Conformance Benchmarks (`src/bench/layers.ts`)

**Purpose:** does the implementation behave according to its specification?

- Layer 0 (anti-regression: thin core, open values, runtime value kinds, inspectable meta-configuration, exposed
  benchmark predicates) and Layers 1–13 plus 3.5; **57 checks**.
- A check above a failing layer is reported as *untrusted*.
- Claim status: **implementation property**.
- v0.3.0: 57 pass, 0 fail.

```bash
npm run bench:conformance
node bin/zx.ts bench --suite conformance --layers 0,1,2 --verbose
```

## 2. Theory-Discriminating Benchmarks (`src/bench/theory.ts`)

**Purpose:** do different model classes produce different operational consequences in specified synthetic worlds?

Each benchmark publishes: hypothesis (or "none predefined"), setup (initial configuration and perturbation),
compared model classes, measured outputs, success predicate, what would count as failure, uncertainty, actual result
and claim status. Outcomes are **positive** (expected distinction appeared), **negative** (the favoured Ziran / Xeno
mechanism did not win or gave no benefit) or **null** (no distinction either way). Negative and null outcomes are
reported like positive ones; they are not errors.

| id | kind | question | outcome (v0.3.0) |
|---|---|---|---|
| A | discriminating | fixed vs self-revising observation | positive |
| B | discriminating | fixed variables vs grammar-bounded vs grammar morphogenesis | positive |
| C | discriminating | single synchronous vs asynchronous clocks | positive |
| D | discriminating | aggregate flow vs operational flow bundles (no winner predefined) | null — trader necessity unresolved |
| E | discriminating | fixed vs revisable analysis boundary | positive |
| F | discriminating | scalar-state vs open-value engine | positive |
| G | adversarial | observation revision with no downstream benefit | negative |
| H | adversarial | fixed grammar wins in a stable linear world | negative |
| I | adversarial | single clock sufficient in a synchronized world | null |
| J | adversarial | thick unit category useful | positive |
| K | adversarial | thick unit category useless | negative |
| L | adversarial | harmful self-reorganization | negative |
| M | discriminating | storage identity vs operational address | positive |
| N | discriminating | fixed grammar vs grammar morphogenesis vs meta-grammar morphogenesis (held out, online) | negative |

Claim status: **model-class discrimination**, except D (**unresolved**). "Discriminates" means the model classes
produced different outputs in that world; it does not mean one class is generally better.

```bash
npm run bench:theory
```

## 3. Meta-Boundedness Benchmarks (`src/bench/meta.ts`)

**Purpose:** how sensitive are results to supplied facets, mutation operators, trace schemas, feature constructors,
Pareto axes and benchmark predicates?

Each result is stated as *"under this perturbation, result R was / was not stable to changes in meta-configuration
M"*, never as escape from priors. Each benchmark publishes setup, compared meta-configurations, measured outputs,
stability predicate, expected distinction (mostly none predefined), what would count as failure, the per-perturbation
record, and claim status **synthetic-world result**.

| id | question | v0.3.0 |
|---|---|---|
| MB1 | which results depend on the supplied description facets? | meta-dependent: stable to retiring any single facet; not to retiring configuration-dimension + state-dimension + transition-class together |
| MB2 | which results depend on the grammar-mutation operators? | stable to removing any single operator |
| MB3 | which results depend on the trace schema? | meta-dependent: ai / arist label correspondence lost under `A0-no-read-sets`; market bundle agreement < 1 |
| MB4 | which results depend on the selected Pareto axes? | meta-dependent: selected revision changes with the axis set |
| MB5 | which results depend on benchmark predicates? | meta-dependent: B flips under the margin-0.25 predicate |
| MB6 | which provisional-bundle recovery results depend on features and schema? | meta-dependent: every multi-token market bundle is feature-sensitive or unstable |
| MB7 | does a gain at one level create a cost at another? | stable: a cross-level trade-off appears in both comparisons |

```bash
npm run bench:meta
```

## Reading the suites together

- A passing conformance check says the code does what the specification says, nothing about the world.
- A positive theory benchmark says two model classes differ in one synthetic world under one predicate; MB5 shows
  that predicate choice can flip such a result.
- A meta-dependent MB result is information, not a failure: it tells a reader which conditions to vary before
  trusting a result.
