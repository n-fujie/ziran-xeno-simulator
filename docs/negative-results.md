# Negative and Null Results

The simulator is not designed to force Ziran / Xeno mechanisms to win. Adversarial benchmarks are built so that the
favoured mechanism *should* lose or tie, and several discriminating benchmarks also come out negative or null. All
results are synthetic (claim status in parentheses). Regenerate with `npm run docs:benchmarks`; full records in
[benchmark-results.md](benchmark-results.md).

| # | result | benchmark | outcome |
|---|---|---|---|
| 1 | **Fixed grammar can outperform (here: equal) grammar morphogenesis.** In a stable AR(1) world, out-of-sample error is 0.559 for both; morphogenesis retains 0 grammar changes. | H (model-class discrimination) | negative |
| 2 | **Observation revision can add cost without downstream benefit.** The revision resolves an alias but produces no downstream advantage; it only costs energy. | G (model-class discrimination) | negative |
| 3 | **Asynchronous clocks can add no useful distinction** in a synchronized world: the same correction-class set under both clock models. | I (model-class discrimination) | null |
| 4 | **Reorganization can damage a previously stable configuration.** Direct proportional control is stable without reorganization (damage 0) and damaged with it (damage 15). | L (model-class discrimination) | negative |
| 5 | **Thick categories can be useful.** A unit category is interventionally non-redundant: unit response ratios u1 = 0, u2 = 0.835. | J (model-class discrimination) | positive for the thick category |
| 6 | **Thick categories can be redundant.** The same test in a world with one shared budget: ratios u1 = 0.508, u2 = 0.327; redundant. | K (model-class discrimination) | negative |
| 7 | **Meta-grammar morphogenesis can fail.** In the three-regime delay-threshold world none of fixed grammar, grammar morphogenesis or meta-grammar morphogenesis reached adequacy τ = 0.78 in regime 2; the only meta-operator produced online was `meta:delay→window`. Offline, delay→discretize meta-operators were composed, abstracted and later retired. | N (model-class discrimination) | negative |
| 8 | **Trader-category necessity can remain unresolved.** The aggregate-flow model is insufficient, but lower-level operational bundle descriptions do not settle whether "trader" is necessary. | D (unresolved) | null |

## Meta-dependence (not failures, but limits on how far a result travels)

- MB1: the novel-dimension result survives retiring any single description facet but not three together.
- MB3: later-label correspondence for `ai` and `arist` is lost under the `A0-no-read-sets` trace schema.
- MB4: the selected observation revision changes with the Pareto axis set.
- MB5: benchmark B's hypothesis status flips under the stricter margin-0.25 predicate.
- MB6: every multi-token market bundle is feature-sensitive or unstable.

## Why this matters

A reader should be able to see where Ziran / Xeno mechanisms add nothing, cost something, or depend on supplied
conditions. Positive results in this release are only as strong as the worlds, predicates and meta-configuration
that produced them.
