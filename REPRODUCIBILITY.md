# Reproducibility

## Environment

| requirement | value |
|---|---|
| Node.js | ≥ 23.6 (TypeScript type stripping). Release checked with **Node 24.14.1** |
| package manager | npm (checked with 11.11.0); only needed for the dev dependencies |
| runtime dependencies | none |
| dev dependencies | `typescript` 5.9, `@types/node` 24 (for `npm run typecheck` only) |
| OS | macOS, Linux or Windows; no native modules, no shell-specific scripts except the npm `test` glob |
| network | not needed at runtime; `npm ci` needs the npm registry |

## Commands

Run from the repository root.

```bash
npm ci
```

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run bench:conformance
```

```bash
npm run bench:theory
```

```bash
npm run bench:meta
```

```bash
npm run bench
```

```bash
npm run check:presets
```

```bash
npm run check:api
```

```bash
npm start
```

```bash
node bin/zx.ts run observation.hidden-phase --seed 7 --out trace.json --tii tii.jsonl --verify-rerun
```

```bash
npm run docs:benchmarks
```

| command | what it does | v0.3.0 result |
|---|---|---|
| `npm run typecheck` | strict `tsc --noEmit` over `src`, `bin`, `test`, `scripts` | 0 errors |
| `npm test` | `node --test` over `test/*.test.ts` (7 files) | 73 tests, 73 pass |
| `npm run bench:conformance` | Implementation Conformance suite | 57 checks, 0 failed |
| `npm run bench:theory` | Theory-Discriminating A–N | 14: 7 positive, 5 negative, 2 null, 0 errors |
| `npm run bench:meta` | Meta-Boundedness MB1–MB7 | 7: 2 stable, 5 meta-dependent, 0 errors |
| `npm run check:presets` | runs every preset with defaults, validates the trace, verifies an exact rerun | 38 presets, 0 failed |
| `npm run check:api` | starts a server on a free loopback port and exercises every endpoint | 0 failed |
| `npm start` | interface + API on `127.0.0.1:3010` (`PORT`, `HOST` to override) | — |
| `zx run … --verify-rerun` | one experiment, trace and TII export, exact rerun check | `equal: true` |
| `npm run docs:benchmarks` | regenerates `docs/benchmark-results.md` | — |

The bench, check and test commands exit non-zero on failure. Negative and null theory outcomes and meta-dependent
MB results are results, not failures; only errors and failing conformance checks set a non-zero exit code.

## Determinism

- All randomness comes from `core/rng.ts` (splitmix32 seeding + mulberry32 streams), seeded per experiment and per
  stream. There is no `Math.random` in the engine, analyses, domains or reviser.
- A trace records initial configuration, observation configuration, rule ids and code hashes, parameters, seed,
  interventions (with code), meta-configuration snapshots (initial and final), evidence label and claim status.
- `specHash` covers the world specification including rule source text; `runHash` covers the full event log. An
  exact rerun (`--verify-rerun`, `POST /api/runs/:id/rerun`, `rerun()` in `core/experiment.ts`) rebuilds the
  experiment and compares run hashes.
- TIIs (Transition-Ignition Identifiers, test status) are content-addressed and identical across exact reruns.
- `replayState` reproduces the final state from the event log (tolerance 1e-9); `validateTrace` checks this.

## Known nondeterministic output

These do not affect traces, hashes or benchmark outcomes:

- `ms` timing fields in benchmark and check output, and the `at` timestamp of `POST /api/bench`;
- `createdAt` and sequential `run-N` ids in the HTTP server (per server process);
- the Node version line in `docs/benchmark-results.md`;
- floating-point results could in principle differ across CPU architectures or JavaScript engines for the chaotic
  lattice preset; the release was checked on one machine (Apple silicon, macOS).

## Clean-install check

The release archive was extracted into an empty directory and checked with `npm ci`, `npm run typecheck`,
`npm test`, `npm run bench`, `npm run check:presets` and `npm run check:api`.
