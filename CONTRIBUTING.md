# Contributing

Contributions that make results easier to **run, inspect, challenge or compare** are the most useful: new
adversarial benchmarks, alternative predicates, trace schemas, feature constructors, external datasets through the
adapter, and matched comparisons with other modeling frameworks.

## Ground rules

- **Keep the core thin.** No thick categories (human, agent, market, belief, goal, capability, trader, …) as types or
  fields in `src/core/`. Layer 0 of the conformance suite checks this; do not weaken it.
- **Report negative and null results.** A benchmark that can only pass is not a benchmark. Every new theory or meta
  benchmark must publish its predicate and what would count as failure.
- **Label claims.** Every new output carries a claim status (see [docs/claims.md](docs/claims.md)). Synthetic results
  are never promoted to empirical ones.
- **Historical material** enters only as historically constrained operational reconstruction, with sources,
  assumptions, uncertainty and `historicalFactualClaim: false`.
- **Stopping principle.** Do not make a fixed condition revisable unless changing it produces a non-redundant
  difference in observation, intervention, reachability, real effect, penetration, feedback, reorganization or
  interpretation.
- Zero runtime dependencies. TypeScript must run under Node type stripping: `import type`, `.ts` import extensions,
  no enums, no parameter properties.

## Before opening a change

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run bench
```

```bash
npm run check:presets
```

If a change alters benchmark outcomes, regenerate `docs/benchmark-results.md` (`npm run docs:benchmarks`) and say in
the change description which outcomes moved and why. Do not update a test's expected value without stating it.
