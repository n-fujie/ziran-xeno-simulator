# Architecture

## Source layout

```
src/core/          small generic core (no thick categories — checked by conformance Layer 0)
  types.ts           storage keys, operational addresses, configuration dimensions, clocks, rules, couplings, apparatus, probes
  values.ts          open operational values + value-semantics registry (scalar adapter is one kind)
  description.ts     description facets, the description space S, S_t → S_{t+1} diffs, change signatures
  meta.ts            MetaConfiguration: registries with origins, M_t → M_{t+1} lineage
  engine.ts          transition engine: scheduling, ignition, operations, real effects, penetration, feedback,
                     reorganization (Levels B/C/D), epistemic bookkeeping, aliasing, lookahead,
                     probe-relative + emergent reachability forks
  trace.ts           trace store, export, replay, validation (no absence claims; replay = final state)
  penetration.ts     downstream penetration: media/scale/domain/clock crossings, transformation, loss, branching
  counterfactual.ts  runner, trace diff, generic non-redundancy test
  perturbations.ts   the 20 experiment (perturbation) types
  experiment.ts      preset/experiment registry, exact rerun
  tii.ts             deterministic Transition-Ignition Identifiers (test status), TII-ledger JSONL
  rng.ts, hash.ts, heap.ts
src/meta/          trace schemas, trace-schema sensitivity, claim status, global meta registry
src/external/      external observation adapter (replay, CSV)
src/ziran/         observation reviser (sensor morphogenesis, Pareto axes, selection policies), conditional processes
src/analysis/      timing & too-late correction, fragility transfer, comparison levels, local rates, vocabulary
                   non-redundancy, grammar-bounded discovery, grammar / meta-grammar morphogenesis, responsibility,
                   provisional operational bundle recovery, goals, interplay, optimizer, meta-time, meta-fragility
src/domains/       domain extensions (never redefine the core)
src/presets/       preset registration
src/bench/         layers.ts (Implementation Conformance) · theory.ts (Theory-Discriminating A–N) · meta.ts (MB1–MB7)
src/server.ts      zero-dependency HTTP API + static interface
bin/zx.ts          CLI: list, run, bench, check-presets
scripts/           check-api.ts (endpoint smoke check), benchmark-results.ts (regenerates docs/benchmark-results.md)
public/            interface (vanilla JS, inline SVG)
test/              node:test suites (73 tests)
```

## Interface

- **Experiment** — nine representative demos first, then all presets by area → parameters → perturbations (static or
  at time `at`, as traced reorganizations) → run, run seeds, or run with/without perturbations. Pipeline strip
  (configuration → detected difference → ignition → operation → real effect → penetration → feedback →
  reorganization), clock lanes, probe-relative and emergent reachability, epistemic status per apparatus,
  observation readings, Level A/B/C/D timeline with level filter and gained / lost / unresolved distinctions.
- **Analyses** — observation revisions (full Pareto set before selection, axes, policy origin), timing / corrections,
  local rates, interactions, operational bundles (recovered provisional bundles, trace-schema sensitivity, vocabulary
  profiles), addresses, run meta-configuration, notes & goals, TII, domain analyses, configuration.
- Event inspector (upstream causes, downstream penetration), replay slider, exact-rerun verification, trace and TII
  export.
- **Compare** — eight comparison levels, divergence point, fragility transfer across regions.
- **Benchmark** — three suites, each theory and meta benchmark with its predicate and "What would make this benchmark
  fail?".
- **Meta-Configuration** — every registry entry with its origin badge; trace schemas; benchmark predicates.

## HTTP API

| Method | Path | |
|---|---|---|
| GET | `/api/presets` | presets, defaults, option hints, suggested perturbations |
| GET | `/api/perturbation-types` | the 20 perturbation types |
| POST | `/api/run` | `{preset, params?, seed?, horizon?, perturbations?}` → run summary |
| POST | `/api/batch` | `{experiments:[…]}` |
| GET | `/api/runs` · `/api/runs/:id` | run list · run summary |
| GET | `/api/runs/:id/trace` · `/tii` | full trace JSON · TII JSONL |
| GET | `/api/runs/:id/events?kinds=&q=&from=&limit=` | trace query |
| GET | `/api/runs/:id/event/:seq` · `/penetration/:seq` | causal neighbourhood · penetration report |
| GET | `/api/runs/:id/analysis` · `/timeline` · `/replay?upto=` | analyses (incl. claim status, level events, meta) · clocks · replay |
| POST | `/api/runs/:id/rerun` | exact rerun check (run hash) |
| POST | `/api/compare` | `{a, b, regions?, target?}` |
| GET | `/api/runs/:id/emergence` | recovered provisional bundles + later-label comparison |
| GET | `/api/runs/:id/schema-sensitivity` | trace-schema and feature-set sensitivity |
| GET | `/api/meta` | global meta-configuration, trace schemas, feature constructors, benchmark definitions |
| GET | `/api/theory/list` | theory benchmark definitions |
| GET | `/api/bench/layers` · POST `/api/bench` · GET `/api/bench` | layer list · run all suites · last result |

The server binds to `127.0.0.1:3010` by default (`HOST`, `PORT`). It has no authentication and keeps runs in memory.
