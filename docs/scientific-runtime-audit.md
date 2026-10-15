# PR #1 audit and scientific protocol v2

Baseline: `ff45ab0d0b509f9e8a7e31f7c325650e3c2ac8d5`. This revises the same runtime and PR.
Claim status: **synthetic-world result**. No physical instrument, new measurement principle or strong Xenoscience establishment is claimed.
The v1 implementation, documentation and results remain in Git history; `v1-comparison.json` is unchanged.

## Evidence inspected

Main remained `5781641d825bd2c25a61de3ebbd6ded94d77822f`. PR #1 was open at the baseline; it was the only
advertised PR. All advertised branches and tags were fetched. The original 99 tests (73 existing + 26 added)
and 11 comparison tests were independently rerun with no failures or skips. All 504 original scientific
fingerprints matched a fresh-store reproduction.

The original push run `38745063532` and PR run `38745167937` were successful. Their actual logs confirm 99 tests,
11 comparison tests, 38 identical preset reruns, zero API failures and execution of all 504 comparison cycles.
Both original CI artifacts were downloaded: each one's 504 result fingerprints and all 252 ledger chains were verified against
the report and the exact fingerprint function from the fixed baseline commit. Every receipt had a unique expected
fingerprint. Source hashes were verified against Git, not current modified code.
See `results/scientific-cycle/v1-audit-validation.json`, `v1-push-audit-validation.json` and `scripts/verify-scientific-legacy.ts`.
The ZIP-level artifact digest is GitHub metadata, not a claim that an independently downloaded ZIP was hashed.
The verifier also executes two counterexamples against the exact baseline modules: valid-prefix deletion was
accepted and empty readings were classified as no difference. Both are now covered by rejecting regression tests.

## Defects and repairs

| Finding at v1 | Repair / regression evidence |
|---|---|
| A valid prefix or entire ledger deletion passes internal hash-chain validation | Separate retained checkpoint stores count, tail and full serialized digest; read/run/recover reject truncation, deletion and rollback. `verifyCheckpoint` compares a separately trusted head, including rollback of both local files |
| Retrying a POST can repeat an intervention | Validated `operationId` / `Idempotency-Key`, immutable request binding, exact durable-result replay, conflict rejection and no replay of quarantined/uncertain operations; actual lost-response HTTP test |
| Connect/disconnect stages are not durably described | Atomic `event` records for issued/confirmed connection, issued/re-measured intervention and issued/confirmed disconnection; actual SIGKILL at lost-ack boundaries preserves uncertainty |
| Same decision targets are forked for every candidate | New target acquisitions per budget slot, with independent random streams and origin keys; sealed final cohort follows all selection; new control cohort follows final evaluation |
| Same Engine snapshot can be relabelled as another cohort | Process-local source/engine binding rejects wrong target, index, cohort or ID; acquisition keys detect duplicated receipts; equal numeric values alone do not imply duplicated acquisition |
| Repeated same-seed episodes can feed known final packets back into nominal new-data generation | Exclude current target seed from history; deduplicate historical packets by condition + seed. Reproductions remain storable but are not extra independent evidence |
| Empty or null successful readings imply measured equality | Empty, null, undefined, nonfinite and incompatible device/scale/window/boundary comparisons are undetermined |
| Cached observation can be stamped with a later simulation time | Use the actual observation timestamp and reject stale samples as not measured |
| Post-intervention check reads the same apparatus cache | Independently read the actual control target through `Engine.readChannel`; retain that apparatus/route separately from `Engine.ctx.obs`, compare both paths and the expected effect |
| Apparatus verification precedes a second unverified operational clone | Fresh control target connected once after final verification; verify installed h against a separate reference; retain connection receipts; failed final evaluation never connects or actuates |
| “Mismatched history” is a constant adverse ranking, not real stored history | E now queries actual foreign-condition records with the same bounded query rule; the old synthetic adverse prior is explicitly `historyPolicy: synthetic-stress` and remains tested |
| “Grammar revision” is only a permutation plus an unconditional supplied composition | Keep supplied composition; add residual + failed-parent conditioned placement/absolute construction, current-graph regeneration and explicit expiry of unavailable prior structures; no new physics claim |
| Generation/decision/history costs and reused reference datasets are obscured | Separate CPU/wall stages, actual sorting comparisons, every recorded reference acquisition, complete transaction timing and common-slot packet checks |
| Local browser can submit cross-site scientific writes | Reject cross-origin/cross-site scientific requests; same-origin and CLI remain compatible. No fictional authentication system added |

## Connected call paths

`src/server.ts` → `scientificRoute` → `ScientificRuntime.run` → ledger exclusive operation → `execute`.
All requests stay within the original HTTP runtime; there is no independent Python project.

| Stage | Actual inputs, function and outputs / state changes | Evidence |
|---|---|---|
| 1 measurement | `acquire(generation)` creates registered target engines; `configured` samples, `measure` produces provenance receipts | origin/stale/missing/status tests |
| 2 unexplained distinction | `assess` compares apparatus relation with independent reference response; outputs `unexplained` and residual | coupled/stable/undetermined tests |
| 3 candidate generation | `generate` calls existing `candidatesFor` on generation-only snapshots and the coupling graph | disconnected grammar failure |
| 4 composition | Existing emitted operations compose placement/sampling; residual-conditioned placement/abs has parent lineage | composition and conditional-structure tests |
| 5 independent verification | Each budget slot calls `acquire(decision, slot)`; candidate measurements and reference probes share only that slot's targets | different-draw/origin tests and comparison access audit |
| 6 adoption/rejection | Determinate decision score, challenge, x retention and adoption cap determine selected candidate | independent validation/rejection/cap tests |
| 7 post-adoption capability | Sealed `acquire(evaluation)`/assessment; no replacement candidate can use final data | final-shift invariance test |
| 8 observation layout | After final success, connect to a new control target using `Engine.intervene` emitted apparatus operations; independently verify live h | connection receipt and reference-path tests |
| 9 intervention | h observation determines bounded pulse, with a pre-effect durable event and stop at time 1.5 | normal and inverted-model tests |
| 10 remeasurement | At time 2 compare apparatus x, separately acquired direct-reference x and expected change | independent-after-reference and stale-cache tests |
| 11 persistence | Intent/events and terminal result+snapshot use atomic ledger replacements with a separate commit witness | corruption/truncation/interrupted replacement tests |
| 12 history feedback | Restarted runtime reads validated terminal records, filters/deduplicates context/seed, queries at most eight | restart, real foreign history, same-seed tests |
| 13 conditional revision | Residual + rejected parent generates a new bounded composed structure; current graph removes unavailable parents | expiry/regeneration tests; no unbounded grammar claim |
| 14 isolation/recovery | Interrupted intent or uncertain acknowledgement never triggers automatic replay; disconnect confirmed in successful synthetic episodes | SIGKILL, live writer, lost response and recovery tests |

Measurements record target, cohort, actual observation time, receipt collection time, channel, apparatus, acquisition
key, read route, device-spec hash, boundary, scalar scale, window and history references. Reference and apparatus
routes are distinct software acquisition paths on the **same simulator backend**, not independent physical sensors.
Normal equal-valued stable-target samples remain valid separate acquisitions; IDs alone cannot establish independence.
The within-episode origin registry and acquisition-key checks are enforcement in this adapter, not device attestation.

## Storage contract and migration

This repository uses **JSON replacement, not SQLite**. No SQLite transaction was tested or claimed.
State/audit snapshot and associated terminal decisions/receipts are committed in one ledger record. Intermediate
operation phases have their own durable records; partially completed operation state is explicitly uncertain.

Default witness is `<SCIENCE_DATA_DIR>.checkpoint`, outside the ledger directory; `SCIENCE_CHECKPOINT_FILE` can select
another trusted persistent location. File fsync and same-filesystem rename commit the ledger. The separately fsynced
witness precedes replacement and identifies the exact durable pending file. Explicit recovery may finish **only that
matching pending replacement**. An arbitrary shortened chain is never promoted to a new trusted head.
A writer crash after connect/disconnect issue but before acknowledgement is quarantined. A successful disconnect
confirms local synthetic configuration, not hardware state. Snapshot restoration is audit-only; no live device is restored.

A legacy store with data but no witness fails closed. Do not delete, reset or silently bootstrap it. Back up all data;
obtain the exact count/tail hash from a separately trusted retained record, then explicitly invoke
`ledger.bootstrapLegacy({count, hash})` offline. `ledger.verifyCheckpoint({count, hash})` compares an independently
retained head. Keep the ledger and witness across ordinary process restarts and also retain an independent head.

The local witness detects ledger-only rollback. A writer able to replace **both** local files can roll both back;
an independently trusted head is required to detect that. A separately protected off-machine witness service is
**not provisioned** here. No claim of adversarial tamper resistance follows from unsigned local hashes.
Concurrent readers may fail closed during the short witness/rename interval and should retry. No partial state is
returned as a successful read. The stale-writer check is serialized; a live/reused/unknown PID cannot be stolen.
If the recovery process itself dies holding its recovery guard, isolate the store and inspect/remove the guard
only with all writers stopped; automatic guard stealing is deliberately unsupported.

A caller must provide a stable operation ID to get retry protection. Reusing an ID with different input is an error.
An uncertain operation cannot be retried as a new effect under the same ID. Clients creating a new ID for every retry
are explicitly requesting new episodes. None of these guarantees atomically commits a physical actuator with disk.

## v2 comparison and interpretation

`results/scientific-cycle/v2-comparison.json` is a new result; v1 is retained. It again executes exactly 504 cycles,
84 cells with six runs each: 7 conditions × 2 candidate caps × 3 base seeds × 2 episodes × 6 methods.

Same target seed, condition, generation/final/control packets, candidate-slot random stream, candidate/adoption caps,
actuation opportunities and sequential machine are shared. There is no exogenous noise in these fixtures. Every
common reference acquisition key is checked against a common payload digest across methods. Candidate-slot data are
disjoint within each method; generation/evaluation/control packet digests are included in per-run results.

All methods retain the same opportunities for earlier episodes. D queries compatible records; E queries actual
foreign-context records, excluding the current seed. Other policies do not query history. B and F remain identical
ablations here. The original synthetic adverse-ranking condition is tested separately and is not passed off as
real historical evidence. Actual prior packets, candidates and conditional revisions can differ with strategy;
this is not identical realized information, a fixed CPU quota, or proof of an isolated history advantage.

Costs include generated candidates, measured comparator calls, candidate-slot/reference acquisitions, generation,
ranking, decision and history-query CPU/wall, and full transaction CPU/wall including phase/witness I/O. Unit costs
are supplied accounting units, not physical energy. Fixed/trigger policies legitimately consume fewer acquisitions;
equal candidate caps alone are never described as complete fairness. Reference probes are charged and identified
separately from the one control intervention opportunity.

At cap 3 on the coupled target, B/C/D/E/F each have 6/6 verified adoptions and 6/6 consistent interventions; A has
none. D and C have **equal success**, with average acquisition units 84 and 87 respectively. This does not establish
history-specific scientific superiority. In the inverted intervention condition, all adaptive/search methods verify
sensing but have zero consistent interventions and are quarantined; D can spend **more** measurement units than C
(91 versus 87). Period/threshold shifts still fail final evaluation; disconnected grammar and sensor-fault failures
remain. E's real foreign history does not reproduce the old fixed adverse-ranking result, which remains a separately
labelled budget-dependent stress finding. Do not overwrite the old negative result or pretend these are the same E.

Target resets, scalar observation scope, fixed probe horizon, supplied candidate operations, synthetic conditions,
small seed count and strategy-dependent realized history limit interpretation. Revisions do not invent a measurement
principle. Final-failure data may inform later, different-seed episodes, but cannot select another candidate in the
same episode. There is no empirical validation or evidence for the four strong Xenoscience conditions jointly.

## Validation and reproduction

Local validation: 122 tests passed = unchanged original 73 + all original 26 (assertions strengthened for new event/data
contracts) + 23 added audit tests. Comparison 11 passed; typecheck, existing benchmark suites, 38 presets and API checks
passed, with zero failures/skips. Existing core/analysis/ziran/domain/preset/benchmark/public/bin/embodied files and
historical negative-result artifacts are unchanged from the baseline PR. The pre-existing whole-tree comparison test
still checks the original protected files and the two-line server integration boundary.

```bash
cd /workspace/ziran-xeno-simulator
npm ci
git fetch origin --tags
npm run typecheck
npm test
npm run bench
npm run check:presets
npm run check:api
npm run test:comparison
node scripts/scientific-comparison.ts --out /tmp/v2-report.json --receipts-dir /tmp/v2-new-evidence
node scripts/scientific-comparison.ts --out /tmp/v2-repeat.json --verify-against /tmp/v2-report.json
npm start
```

Evidence directories must be empty. CI performs both complete v2 runs and fails on any scientific fingerprint
mismatch, missing cell, cost invariant or common-packet mismatch. Timing, timestamps and operation UUIDs are excluded
from scientific identity; decisions, measurements, geometry, connection states, snapshots and operational counts remain.

```bash
curl -sS -X POST http://127.0.0.1:3010/api/science/cycles \
  -H 'content-type: application/json' -H 'Idempotency-Key: experiment-operation-0001' \
  -d '{"seed":1,"condition":"coupled","method":"history","budget":3}'
curl -sS http://127.0.0.1:3010/api/science/checkpoint
```

Reusing the same operation key returns the exact saved result, without another event or intervention.
For legacy validation, download the original `scientific-comparison` artifact and reproduce v1 with the code at
`ff45ab0` in a temporary snapshot, then run `scripts/verify-scientific-legacy.ts --artifact <downloaded-dir>
--reproduction <v1-report> --out <validation.json>`. The verifier executes only the fixed committed fingerprint
function, verifies source hashes, ledger hashes, complete counts and unique expected receipts.

## Security and outstanding completion conditions

There is no HTTP authentication, API-key store, token issuer/verifier/refresh/revocation code or WebSocket upgrade
handler in the inspected core runtime. These absent components cannot have a demonstrated regression here.
Loopback remains the default. Cross-site protection is not user authentication; externally exposing HOST still
requires a separately designed security boundary. HTTP clients cannot supply paths, arbitrary code or instruments.
Ledger/error records do not persist exception text from callbacks. No secret values were read or printed.

Actions now explicitly requests only `contents: read`. This workflow contains no configured Actions Secret
references. Listing repository secret **metadata** returned `Resource not accessible by integration`; repository-wide
secret configuration therefore remains uninspected, not “no secrets exist”. Existing platform GitHub authentication
was reused. No new token was requested or placed in source, records or configuration.

No source/protocol/result artifact for the specifically described runtime v0.2.0 experiment was found in advertised
refs, tags, tracked artifacts or searchable history. Its user-supplied negative claims remain documented as
unreproduced historical constraints; no current feature or prior result was removed because of that absence.

Environment install/start drafts were read back. Startup remains `npm start`; newer instructions cover witness
retention, explicit recovery, stable operation IDs and comparison reruns. The toolset still has no publish or
fresh-task creation operation. **Publication and new-task restoration are not complete.** A human must review/save
and publish in environment settings, then start a new task and run the documented checks. Current runtime process
restart tests are not a replacement for that test. Physical-device recovery and a protected external witness service
are also unverified/unprovisioned. Strong Xenoscience's four conditions are not established.

Even if GitHub reports a clean merge and passing CI, those external completion conditions are not silently marked
done. Final whole-request merge approval remains on hold until the required environment restoration is verified.
