# Scientific cycle integrated with the core runtime

Historical protocol-v1 description at `ff45ab0`. Current behavior, repaired guarantees and validation are documented
in [the PR #1 protocol-v2 audit](scientific-runtime-audit.md); the v1 results below remain preserved.

Status: executable synthetic engineering prototype. Claim status: **synthetic-world result**.
This extension does not establish strong Xenoscience. It uses the existing Node runtime and has no Python dependency.

## Inspection and integration boundary

Inspected main `5781641d825bd2c25a61de3ebbd6ded94d77822f`, all five advertised branch heads,
tags `v0.3.0` and `v0.4.0`, and their available commit history. Main matched the previous setup.
The three research branches are integrated into the release; the release preparation branch precedes main.
No pull-request heads were advertised by Git. Initial GitHub REST/GraphQL requests failed with proxy CONNECT
403. After the API domain was added to the environment draft, subsequent API validation succeeded with the
existing authentication: no prior pull requests or Actions runs were returned. This does not prove publication.

| Mechanism | Existing implementation | Extension / conclusion |
|---|---|---|
| Sensors, observations, missingness | `src/core/types.ts`, `engine.ts`: apparatus, channels, boundaries, resolution, windows, observation status | Reused; receipts add source, target instance, apparatus, channel, boundary, scale, window, acquisition time and history references |
| Target state and update | `Engine.state`, rules, clocks, couplings, emitted intents | Reused without changing the engine; supplied synthetic scalar targets only |
| Measurement acquisition | `Engine.ctx().obs`, `readChannel`, apparatus sampling | Actual engine acquisitions; missing storage is explicitly unmeasurable rather than scalar zero |
| History and external memory | `changeLog`, `Ctx.hist`, apparatus memory, `ziran/system.ts` historical reinsertion | Existing history is in-memory; durable scientific records and compatible-record queries added |
| Interventions and experiments | `Engine.intervene`, `core/experiment.ts`, `counterfactual.ts` | Existing emitted apparatus reorganization and scheduled scalar interventions reused |
| Candidate generation | `ziran/reviser.ts:candidatesFor` | Reused resolution, boundary, disaggregation, construction, memory, graph placement, relocation and sampling operations; no duplicate sensor grammar |
| Candidate acceptance/rejection | Existing reviser evaluates retained snapshots and Pareto/lookahead profiles | Existing presets are untouched. New opt-in protocol uses independent decision targets, preserves x, then verifies on a sealed final cohort |
| Atomic persistence and recovery | Existing run Map and trace exports have no durable transaction/recovery service | Added single-writer, checksum-chained, fsync/rename ledger; intent before execution; interruption quarantine, no automatic actuation replay |
| Authentication | No authentication component in the HTTP server | Preserved loopback default; scientific routes inherit the existing trust boundary |
| HTTP / WebSocket | Existing JSON and static HTTP handlers; no WebSocket upgrade handler or implementation found | Two additive lines route `/api/science/*`; original handlers and UI remain intact; no WebSocket feature claimed |
| Credentials / tokens | No core API key or token storage required | No credentials added, logged or embedded in records; network proxy credentials are outside application code |
| CI / tests / benchmarks | npm scripts; 73 core tests; comparison tests; 38 presets; no tracked Actions workflow | Added full Node 24 CI, functional integration and fault tests, reproducible comparison artifact |

The server's original source must equal the v0.3.0 server after removing the two explicit integration lines.
The comparison anti-regression test now enforces that identity and keeps every other existing file under
`src`, `public` and `bin` frozen. Only the new `src/science/` subtree is exempted from the old whole-tree assertion.
This is a scoped integration contract, not a disabled test. Fetching `v0.3.0` removes the previous skip.

## Executable cycle

1. Acquire generation target pairs through the existing Engine. Independently probe each target's response
   to the same input. Equal apparatus readings with different reference responses are an unexplained distinction.
2. Generate apparatus candidates from generation snapshots and the declared coupling graph using `candidatesFor`.
   Compose graph placement and sampling operations when the required parent operations exist; record lineage.
3. Reorder the supplied grammar with at most eight compatible prior completed/quarantined scientific records.
   Rejected or quarantined outcomes demote proposals; verified successful outcomes promote them. This is bounded
   priority revision, not arbitrary grammar invention. Raw failure intents without complete scientific receipts
   are isolated, not used as if they were successful evidence.
4. Only now acquire independent decision targets, using a separate PRNG stream. Within the candidate cap,
   independently remeasure each pair. Require determinate discrimination, an actual discriminating challenge,
   and retention of the existing x channel. Select one lowest-cost eligible candidate, or reject all.
5. Only after decisions are fixed, acquire the final evaluation cohort from a third stream. A failed final test
   isolates this episode; it never selects a replacement using final data.
6. Install the chosen apparatus using the Engine's emitted intervention. Its h measurement determines a single
   bounded input pulse. Stop that pulse between ticks; remeasure x at the next sampling tick, because the existing
   Engine samples sensors before executing that tick's rules. Compare observed with predicted change.
7. Atomically persist the result, decisions, receipts, failures and resource accounting. Future history-mode
   episodes query these records. A new episode resets the target; it does not silently continue an old target.

Generation, decision and evaluation target IDs and random streams are disjoint within each episode. This is
independent synthetic reacquisition, not held-out files containing the same snapshots. Prior final results can
enter a **later episode's** generation history; the later episode still has newly acquired decision/final data.
The reference probe is recorded separately and is never available to the control policy as a production sensor.
Raw generation snapshots and the supplied coupling graph are privileged simulator inputs, equally available
to all methods. They must not be mistaken for real-world discoverable sensing physics.

`no-difference-in-measured-channels` is a relation between successful readings, never a universal absence claim.
Unmeasurable, not measured, sensor fault, boundary hidden, scale incompatible, inaccessible and other core
statuses remain distinct from measured equality. The live adapter here has one declared scalar scale; passing
an incompatible-scale status through the receipt model does not establish a physical scale-changing apparatus.

## Persistence and safety

Default storage: `/workspace/.ziran-science`, outside the checkout. Override with trusted process configuration
`SCIENCE_DATA_DIR`. HTTP clients cannot select storage paths or provide executable worlds, sensor code or actions.
Cycle requests accept only bounded seeds, allowlisted methods/conditions, candidate caps 1–8 and adoption cap 0–1.
Request bodies are capped at 4096 bytes. No physical actuation adapter is exposed.

Each operation writes a durable `prepared` intent first. The terminal record is `completed` or `quarantined`.
`ledger.json` is rewritten via an exclusive temporary file, file fsync, atomic rename and directory fsync on
the same local filesystem. A SHA-256 chain detects accidental corruption; it is not authentication against
a malicious local writer. An exclusive writer lock prevents competing commits. A dead writer's lock may be
removed only after its recorded PID is confirmed absent; a live/reused/unknown PID blocks recovery.

After a process crash, explicit recovery marks pending operations quarantined, preserves the evidence and
does not retry the intervention. Corrupt chains block execution and recovery until the store is isolated and
investigated. Failed durable completion never returns apparent success. Unfinished temporary files are evidence
and are not silently treated as a committed ledger. Back up the ledger and residual files before manual repair.

These guarantees concern local persisted records. They do **not** atomically commit a physical device action
with storage, provide hardware acknowledgements, or recover a physical device. A future device adapter needs
independent command IDs, acknowledgement/reconciliation, interlocks and an explicit uncertain-effect state.
An isolated synthetic target is abandoned; other fresh synthetic episodes may still run.

## Run and reproduce

```bash
cd /workspace/ziran-xeno-simulator
npm ci
npm start
```

The server defaults to loopback port 3010. It has no authentication; do not expose it as an authenticated service.
The original UI, API, CLI and 38 presets remain available. No preview link is required.

```bash
curl -sS http://127.0.0.1:3010/api/science/protocol
curl -sS -X POST http://127.0.0.1:3010/api/science/cycles \
  -H 'content-type: application/json' \
  -d '{"seed":1,"condition":"coupled","method":"history","budget":3}'
curl -sS http://127.0.0.1:3010/api/science/ledger
curl -sS -X POST http://127.0.0.1:3010/api/science/recover
```

Recovery is explicit and local. It does not restart or resume an interrupted physical action.

```bash
git fetch origin --tags
npm run typecheck
npm test
npm run bench
npm run check:presets
npm run check:api
npm run test:comparison
node scripts/scientific-comparison.ts --out /tmp/scientific-comparison.json \
  --receipts-dir /tmp/scientific-evidence-new
```

The receipts directory must be empty; this prevents old experiment history contaminating a rerun.
Omit `--receipts-dir` for an automatically cleaned temporary store. The JSON report preserves per-run outcomes,
decisions, costs, fingerprints, protocol controls, machine details and source hashes. Full ledger receipts are
retained when requested. Timing, wall-clock acquisition timestamps and operation UUIDs vary; scientific
fingerprints exclude those fields and retain the scientific outcomes. Actions uploads both report and receipts.

Local validation on Node 24.19.0: typecheck passed; **99 tests passed (the original 73 plus 26 new), zero skips**;
all core benchmark suites completed with zero errors; all 38 presets reran identically; every existing API smoke
check passed; comparison tests **11 passed, zero skips** after tag retrieval. The new tests include live HTTP
restart restoration, disjoint data cohorts, generated-operation composition, history feedback, repeated-seed
identity, adverse priors, distribution shifts, model mismatch, four injected failures, actual process exit,
failed durable completion, corrupt storage and writer exclusion. Existing theory benchmark negative/null
outcomes are retained research results, not converted to passing scientific hypotheses.
The complete 504-cycle comparison was independently rerun in fresh stores: all 504 scientific fingerprints
matched exactly. This verifies the reported protocol's reproducibility, not external validity.

## Comparison protocol and results

See [`../results/scientific-cycle/v1-comparison.json`](../results/scientific-cycle/v1-comparison.json).
504 cycles = 7 conditions × 2 candidate caps × 3 seeds × 2 episodes × 6 methods. Each cell below has six runs.

| Method | Policy |
|---|---|
| A fixed | Existing x sensor, no search |
| B adaptive | Search only after an unexplained distinction |
| C always | Search each episode |
| D history | Adaptive trigger plus compatible, bounded scientific-history ranking |
| E mismatched history | Explicit synthetic adverse-prior stress: an unhelpful memory operation is ranked first |
| F no history | Adaptive policy with history query disabled |

B and F are identical in this episode protocol; their equality is a negative control, not six independent
algorithmic innovations. E is deliberately incompatible prior information, not trusted production history or
a matched superiority comparison. D gets no additional target source or extra prior episodes. Every method
persists records, but only D queries compatible prior records. Actual prior packets can differ because past
choices differ. This is equal opportunity/caps, not identical realized information or equal CPU consumption.

All share target seeds, condition, three pairs per partition, candidate budget cap (3 or 4), one adoption cap,
one intervention opportunity and the same sequential machine/process. Execution order rotates. Ranking cost
is included. Reports separate internal cycle CPU/wall/ranking time and transaction-wide CPU/wall including
ledger I/O. Measurement costs count recorded channel acquisitions and independent reference probes in supplied
unit costs; simulator-internal state reads are computation, not additional physical measurements. These units
are not measured energy consumption. No equal CPU quota or hardware energy claim is made.

| Condition, candidate cap 3 | A | B | C | D | E | F |
|---|---:|---:|---:|---:|---:|---:|
| Coupled: verified adoption / consistent intervention | 0/0 | 6/6 | 6/6 | 6/6 | 0/0 | 6/6 |
| Stable: verified adoption / consistent intervention | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| Disconnected graph: verified adoption / consistent intervention | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| Threshold shift: quarantined after final evaluation | 0 | 6 | 6 | 6 | 0 | 6 |
| Period shift: quarantined after final evaluation | 0 | 6 | 6 | 6 | 0 | 6 |
| Sensor fault: verified adoption / consistent intervention | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| Intervention-model mismatch: verified adoption / consistent intervention | 0/0 | 6/0 | 6/0 | 6/0 | 0/0 | 6/0 |

In coupled targets, D and C have equal adoption/control success. D averages 67 recorded acquisition units versus
C's 70 at cap 3; this arises from bounded ordering changing which candidates are measured, not a demonstrated
history-specific scientific discovery advantage. CPU/wall observations are descriptive small-sample timings,
not a statistically supported performance ranking. At cap 4 E also succeeds in coupled targets: its harm at cap 3
is a budget-dependent adverse-prior result, not a universal inferiority claim.

In stable targets, adaptive methods spend 30 acquisition units and C spends 60 at cap 3, with no adoption or
intervention benefit. Disconnected targets have no graph-reachable sensor for h: the supplied grammar fails.
At final evaluation the threshold changes from 0.5 to 3, or the target period changes from 1 to 3, while the
one-tick reference horizon stays fixed. The proposed apparatus does not establish usable discrimination under
the new conditions; the system quarantines the episode rather than extending the horizon using final data.
The deliberately inverted intervention model passes sensor discrimination but fails action/remeasurement
consistency. Sensor success and control correctness are therefore reported separately.

## Prior results and scientific limits

No prior reports, datasets, benchmark outcomes or historical experiments are deleted or rewritten. Existing
negative/null findings in `docs/negative-results.md`, `docs/external-comparison.md`, the Xeno-14 reports and
Active Inference reports remain authoritative for their protocols. New success cannot overwrite them.

The task request additionally reports earlier history/always-search equivalence, harmful incompatible history,
failed generation environments, period/threshold search failures, supplied-grammar dependence, intervention
model inconsistency, and absence of an established history-reinsertion effect in runtime v0.2.0. No distinct
runtime-v0.2.0 source/result artifact was identifiable in the advertised branches, tags or searchable history.
Those statements are preserved here as **user-supplied historical constraints**, not independently reproduced
facts about an available v0.2.0 runtime. The new fixtures demonstrate related bounded failure modes; they do not
reproduce or replace the missing historical experiment. Its exact source/protocol/results remain outstanding.

Engineering capabilities verified here do not establish the four strong Xenoscience conditions:

| Condition | Evidence in this change |
|---|---|
| Independence from human-system energy | Not demonstrated; ordinary externally powered infrastructure |
| Independence from human readability | Not demonstrated; supplied representations, grammar and criteria |
| Material/organizational self-reproduction of inquiry | Not implemented or demonstrated |
| Autonomous revision of variables, boundaries, scales, etc. | Bounded apparatus operations and history priority revision only; no general autonomous revision demonstrated |

No strong Xenoscience establishment claim follows from these tests.

## Environment and delivery limitations

The previous `install_script` and `start_skill` draft were read back successfully. This toolset cannot publish
an environment or create a fresh cloud task. Publication and fresh-task snapshot restoration remain unverified;
the tested HTTP process restart is a different guarantee. The GitHub API domain was added to the environment
draft after proxy 403 evidence. Draft saving does not by itself prove runtime application or snapshot publication.
Subsequent PR/run API requests succeeded, independently confirming current API connectivity. The existing
`GH_TOKEN` binding was reused; no new secret was requested or stored in source or experiment results.
