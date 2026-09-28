# Claims and claim status

## What the release claims

1. The simulator provides an executable environment for tracking configured operational differences, observability
   revision, downstream reachability, penetration, feedback, reorganization, description-space change, and explicit
   meta-boundedness.
2. The simulator can compare how results change when observation systems, variable systems, grammars, trace schemas,
   category features, evaluation axes, or benchmark predicates change.

Both are *implementation properties*, checked by the conformance suite and demonstrated in the representative demos.

## What the release does not claim

- unrestricted emergence;
- presupposition-free science;
- ontology-free simulation;
- full Xenoscience;
- proof of the Ziran / Xeno framework;
- general superiority over existing modeling approaches;
- autonomous reconstruction of physical reality;
- faithful historical-person simulation.

## Claim-status labels

Every reported result carries exactly one of these (`src/meta/claims.ts`):

| status | meaning | where it appears in v0.3.0 |
|---|---|---|
| **implementation property** | the code behaves as specified | all 57 conformance checks |
| **synthetic-world result** | a result inside a bundled synthetic world | every synthetic trace (`trace.meta.claimStatus`); MB1–MB7 |
| **model-class discrimination** | two or more model classes produced different consequences in a specified synthetic world | theory benchmarks A–C, E–N |
| **reconstruction inference** | behaviour generated from reconstruction assumptions | `reconstructionClaim()` records |
| **replayed empirical result** | a result on externally recorded data replayed through the adapter | traces built by `replaySpec` with a non-synthetic evidence label (none bundled) |
| **empirical observation** | a live or recorded observation of a real system | not used |
| **empirically supported generalization** | a generalization supported by external evidence | not used; `promote()` refuses it for synthetic evidence |
| **unresolved** | the result does not settle the question | theory benchmark D (trader necessity) |

Evidence labels (`synthetic`, `replayed-empirical`, `live-observational`, `intervention-derived`) are kept separate
from claim status; `summarize()` refuses to aggregate results with different evidence labels unless mixing is
explicitly requested and marked.

## Language conventions

| instead of | the release says |
|---|---|
| "the system discovered gravity" | "the system selected an inverse-square relational variable under the supplied construction grammar" |
| "the system found the true variable" | "variable v5 = wmean6(x) was retained for prediction and robustness; wmean6 is a generated operator (introduce-windowed-operator), x is a supplied channel" |
| "a natural category emerged" | "provisional operational bundles recovered under specified trace schemas, feature constructions, temporal windows, and grouping procedures" |
| "Aristotle would / predicts / chooses" | "under reconstruction R and configuration C, operational pattern P re-ignited and produced transition T (simulated behaviour generated from reconstruction assumptions)" |
| "irreversible" | "horizon-relative closure" |
| "reachability" (unqualified) | "probe-relative reachability" or "emergent reachability" |
| "higher level" | "Level A / B / C / D" — analytical distinctions, not a ranking |

Every generated structure states its origin: **supplied** vs **generated** operator, **supplied** vs **revised**
sensor, **supplied** vs **generated** variable, **supplied** vs **domain-registered** description facet. The
interface shows these as origin badges (e.g. `wmean6: generated (proposed)`, `sq: supplied`).
