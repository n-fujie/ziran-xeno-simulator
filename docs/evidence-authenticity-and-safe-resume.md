# Evidence authenticity, long-term history audit and fail-closed resume

Base: `main` at `276dad4f9d24bacfd12ba6390d140d491320c218` (PR #1, #2 and #3 merged). Scientific protocol
`engine-scientific-cycle-v2`, package 0.4.0, retained v1/v2 results, the 504 comparison conditions and every
existing source file's behaviour are unchanged. Additions are TypeScript only, in the existing runtime.

**Scope of what is verified.** Everything below was exercised against the simulated engine, in-memory/loopback
contract models, a local TLS contract server and an HMAC device model. **No real external checkpoint service,
no real device and no real instrument was used.** Passing these tests does not establish deployed immutability,
hardware recovery or physical measurement authenticity.

## 1. External checkpoint (`checkpoint-http.ts` unchanged)

PR #2/#3's CAS contract, rollback detection, expiry/rotation, redirect/oversize/corruption handling and
two-process contention are retained and still pass. New in this change:

- **Real TLS verification is now exercised** (`test/science-checkpoint-assurance.test.ts`). Earlier transport
  tests used plaintext loopback. A local HTTPS contract server with generated certificates shows that (a) an
  untrusted certificate fails closed with the fixed message `checkpoint transport failed; outcome unknown;
  explicit recovery required` and no certificate/host detail; (b) the parent setting
  `NODE_TLS_REJECT_UNAUTHORIZED=0` does **not** weaken the bridge (the worker environment forwards only
  `NODE_EXTRA_CA_CERTS`); (c) an operator-trusted certificate carries read, CAS and a bound runtime end to end,
  with the external head advancing once per durable ledger entry; (d) a trusted certificate for a different host
  name is rejected.
- **`evaluateCheckpointIndependence`** (`checkpoint-independence.ts`) turns an operator declaration of who can
  write the ledger/witness, who can write or roll back the external head, retention and credential separation
  into a verdict. The strongest possible result is `declared-independent-unverified` (`verifiedByRuntime:
  false`). Shared administrators, wildcard writers or a credential reachable by ledger writers are
  `not-independent`; mutable/unknown retention or non-HTTPS transport are `not-established`. A report can
  therefore never present same-administrator rewrite power as independent immutability.

Still required of a real deployment, unchanged: an independently administered service honouring the contract,
append-only/versioned retention enforced by the service, a scoped credential delivered through a secret manager
(never ledger data, request bodies, logs or result JSON), a trusted genesis head provisioned out of band, and
provisioned initial state. GitHub repository Secrets listing returned 403 earlier and remains uninspected.

## 2. Device state reconciliation (unchanged) and recovery claims

`DeviceReconciler` still returns `resumeAuthorized: false` and `physicalRecoveryVerified: false` as literal
types; nothing in this change sets either to true. The new resume gate (section 5) reads reconciliation
evidence; it does not issue device commands. No real device API exists in this repository; the HMAC model is the
only contract exercised.

## 3. Measurement provenance audit (`measurement-audit.ts`)

`auditCycleMeasurements(result)` re-checks a stored cycle offline: unique measurement ids and acquisition keys;
every target belongs to its partition and seed (relabelled or reused targets fail); the same observation
re-registered under a different acquisition identity is flagged (cache-style re-measurement); decision
cohorts are not shared between candidates; assessments reference existing measurements of the right
partition; `detected` requires a valid value and non-detections carry none; route/apparatus coherence; history
references are inside the cycle's recorded provenance; a **determinate comparison never rests on an undetected
reading** (failure to measure is not absence). Status classes keep unmeasured, unmeasurable/faulty,
apparatus-incompatible, scale/resolution-incompatible and boundary-hidden apart from each other and from the
distinct relation outcome "no difference in measured channels".

What it deliberately does not claim: for the synthetic source the report states `authenticity:
synthetic-internal-consistency-only`, `deviceSideEvidence: none`, `externalTimeEvidence: none`,
`resolution: not-recorded-per-measurement`, `physicalIndependence: unverified`. Measurement ids and hashes are
internal-consistency evidence, not proof of independent physical measurement. A foreign source is
`not-assessable`. Stored `Measurement` records and `scientificFingerprint` are unchanged, so retained v2
fingerprints still reproduce; no instrument evidence was fabricated.

## 4. Long-term history audit (`ledger-audit.ts`, `GET /api/science/audit`)

`auditLedger(ledger)` is read-only and re-verifies the hash chain, contiguous sequence, separate witness and
external head, then reports entry/byte counts, operation states, pending operations, open interruptions,
cycle/non-cycle payloads, per-cycle measurement consistency, growth against a threshold and free-space headroom.
Failures are reported only as `ledger-integrity`, `external-checkpoint` or `unavailable`, never as raw error
text. The route is a GET on the existing unauthenticated loopback service and exposes no mutation.

Measured on the 504 comparison receipts regenerated for this change: 36/36 chains verified, 504 cycles audited,
0 inconsistent, 0 open interruptions, 1,728 entries, 28,285,416 bytes (~56 KB per cycle including events).
**Known limit when this was written (since addressed, opt-in, in [long-term-ledger-and-write-faults.md](long-term-ledger-and-write-faults.md)):** every append rewrites the whole ledger (plus a pending copy), so cost and the
free space needed per append grow with history size (`requiredFreeBytesForNextAppend` ≈ 2× ledger bytes).
Rotation/segmentation would change the persisted format and is left as future work with a migration plan.
Storage-full and permission-denied write faults were reasoned from the write-then-witness-then-rename order but
**not fault-injected**.

## 5. Fail-closed, idempotent resume (`resume.ts`)

`ResumeGate.assess(request)` evaluates an explicit operator request and records it in the ledger whether it
passes or not. It is a **software run clearance only** (`scope: software-run-clearance-only`,
`automaticResume: false`, `physicalRecoveryVerified: false`); it never actuates, never retries the interrupted
effect and never clears the original quarantine. Conditions (all must hold):

| Condition | Block reason |
|---|---|
| ledger + witness + external head verify | request throws, nothing recorded |
| target is an open interruption (not a finished or synthetic-isolated cycle) | `operation-not-an-open-interruption` |
| no other prepared-but-unfinished operation | `pending-operation` |
| external checkpoint bound (default; explicit opt-out only) | `external-checkpoint-absent` |
| a device reconciliation exists, is the latest, and verified a safe stop | `no-device-reconciliation`, `device-evidence-not-verified` |
| that evidence refers to the current quarantine record | `device-evidence-for-different-quarantine` |
| evidence age ≤ limit (default 30 s, 1–300 s) | `device-evidence-expired` |
| freshly observed boot epoch equals the reconciled one | `device-boot-changed` |
| last confirmed apparatus hash exists and equals the intended configuration | `apparatus-unverified`, `apparatus-changed` |
| an issued intervention was re-measured, or explicitly acknowledged and recorded | `intervention-effect-unmeasured` |

Idempotency: `resumeId` plus identical content returns the recorded assessment without re-evaluation; different
content under the same id throws `resumeId conflict`; a blocked attempt replays as blocked and a retry needs a
new id and is a new record. Duplicate operation ids are already rejected by the ledger. The caller-supplied
`observedBootId`, `currentApparatusHash` and `requestedBy` are operator assertions (a label, not
authentication); the freshness limit and the recorded reconciliation are what bind them to evidence.
Resume and reconciliation records are ignored by scientific history. The newest reconciliation governs: an
older verified safe stop is never reused once a newer one fails.

`ScientificRuntime` gained an **opt-in** `requireResumeClearance` (default off, so existing callers and all 504
conditions behave exactly as before). When enabled, new work is refused while any interrupted operation lacks a
satisfied assessment; idempotent replay of an already finished operation is still allowed. The gate is
library-only: it is not exposed over the unauthenticated HTTP service. The check for evidence tied to a
*different* quarantine record is implemented defensively but has no dedicated test, because the current ledger
cannot produce that state through its public operations.

### Protection scope: guard on versus off

Verified by `test/science-resume-gate.test.ts` (two tests added after review):

| | Guard OFF (default; behaviour unchanged from main) | Guard ON (`requireResumeClearance`) |
|---|---|---|
| A prepared record with no terminal record (crash) refuses all new work until explicit `recover()` | yes | yes |
| A recovered interruption is a permanent quarantine; its operation id can never be replayed | yes | yes |
| Ledger chain, witness and external head are verified before every operation | yes | yes |
| A satisfied assessment for one interruption never clears another or un-quarantines the cleared one | yes | yes |
| New work is refused while an interruption lacks a satisfied assessment | **no** | yes |

So with the guard off, enabling nothing weakens an existing safety stop, but **new cycles may start after
`recover()` even though the interrupted operation's physical outcome is uncleared**; only the guard closes that.
Limits that hold in both modes:

- The guard is a property of one `ScientificRuntime` instance. The existing HTTP singleton (`src/science/http.ts`)
  is constructed **without** it and this change adds no switch for it, so HTTP-hosted runs are unguarded.
- Clearance is **tamper-evident, not tamper-proof**. The ledger authorizes nobody: a party who can append to the
  ledger (and, if bound, hold the external CAS credential) can write any record, including a clearance. Forged
  entries without a valid hash chain and witness are rejected, but a faithful forger is not.
- A clearance is per interruption and is not re-evaluated against later device state; the freshness limit applies
  to the evidence at assessment time only. `observedBootId`, `currentApparatusHash` and `requestedBy` are operator
  assertions. "Last confirmed apparatus hash" is the hash recorded by the last confirming event of the interrupted
  operation (for example the adopted configuration); an operator intending a different configuration is blocked.

## 6. Local authentication and external credentials

The HTTP server remains unauthenticated and loopback-bound; Origin and DNS-rebinding checks are not user
authentication. External checkpoint credentials stay separate (bridge stdin only, per-request callback, expiry
check, no logging); token expiry is checked per request, rotation works through the callback, revocation surfaces
as 401/403.

## 7. Negative and unestablished results (retained)

Theory benchmarks still give 7 positive / 5 negative / 2 null; meta-boundedness 2 stable / 5 meta-dependent.
History-specific performance superiority remains unestablished; foreign-history limits and intervention
quarantine inversions remain. All device effects in scientific cycles are simulated. Runtime v0.2.0 source and
data remain unlocated and unreproduced. The four strong-Xenoscience conditions (human-energy independence,
human-readability independence, material/organizational self-reproduction of inquiry, autonomous
variable/boundary/scale revision) are each unestablished, and so is their joint establishment. Engineering
robustness here is not evidence for any of them.

## Reproduce

```sh
npm ci
npm run typecheck
npm test                 # 185 tests: 153 existing + 32 new
npm run test:comparison  # 11
npm run bench && npm run check:presets && npm run check:api
node scripts/scientific-comparison.ts --out /tmp/new.json --receipts-dir /tmp/new-receipts \
  --verify-against results/scientific-cycle/v2-comparison.json
```
The TLS tests need the `openssl` command-line tool (present on GitHub's Ubuntu runners).
