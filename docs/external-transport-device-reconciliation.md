# Checkpoint transport and device-state reconciliation

This work is stacked on **unmerged PR #2**, head `dca726b5908671bcbcc5acf59b92652efa0005d8`.
Latest confirmed main is `39b2a47c4ec99c00a22929e31e18ee31e5cc063e`. Merge PR #2 first;
then retarget this PR to main. No PR #2 source, schema, hashes, tests or results are rewritten.
Package 0.4.0 and scientific protocol v2 are unchanged.

## Operator-provided external service

`CheckpointHttpStore` implements PR #2's `ExternalCheckpointStore` using a bounded subprocess
bridge to native Node HTTPS fetch. This preserves the synchronous Ledger/Engine API. It is a
client for the following **operator-provided service contract**, not a newly provisioned service:

- `GET <endpoint>/heads/<historyId>/<seriesId>` returns the exact `ExternalHead` JSON.
- `POST .../cas` receives `{ expected, next }`, atomically advances an exact matching head by
  one entry, and returns the retained next head. Stale expected heads return 409 or 412.
- Missing namespaces must fail; the client never creates a series or reconstructs trusted state
  from unverified local files. Operators provision a trusted genesis/existing head out of band.
- The service must authenticate the bearer credential, scope it to the specific history/series,
  reject rollback/deletion, retain versioned immutable audit evidence, and provide durability
  independent of the local machine/writer. TLS alone and this API do not prove any of those facts.

Example embedder integration (the existing server singleton is deliberately unchanged):

```ts
import { Ledger } from '../src/science/store.ts';
import { ScientificRuntime } from '../src/science/runtime.ts';
import { checkpointBindingFromEnvironment } from '../src/science/checkpoint-http.ts';
const runtime = new ScientificRuntime(new Ledger(dataDirectory, witnessFile, checkpointBindingFromEnvironment()));
```

Trusted configuration names: `SCIENCE_CHECKPOINT_URL` (HTTPS, no embedded credentials/query/fragment),
`SCIENCE_CHECKPOINT_HISTORY_ID`, `SCIENCE_CHECKPOINT_SERIES_ID`, `SCIENCE_CHECKPOINT_TOKEN`,
`SCIENCE_CHECKPOINT_TOKEN_EXPIRES_AT` (epoch milliseconds). Supply the token through the environment's
secure secret binding, never a URL, command argument, repository file, ledger or PR. Do not put
secret values into `install_script` or `start_skill`. An injected `credential()` callback may obtain
rotated credentials from an existing provider; it is consulted on every request. Expired/near-expiry
credentials fail closed. There is no token issuance or automatic refresh subsystem here.

Requests use a 5-second default timeout (configurable 100–30000ms), a 64KiB response bound, no
redirects, standard TLS verification and no application retries. Token data goes to the bundled
worker through stdin, not argv; unrelated environment secrets and NODE_OPTIONS are not inherited.
A trusted `NODE_EXTRA_CA_CERTS` may be inherited for an operator CA. Proxy configuration is not
implicitly inherited; deployment routing must support the configured HTTPS destination.
The worker never prints URL/token/error-response bodies; callers receive bounded generic errors.
The bridge is intentionally synchronous and blocks the existing synchronous runtime within its
bounded deadline. Production latency/capacity and provider-specific CAS/retention need validation.

A lost update response means **outcome unknown**. The adapter never repeats the update itself.
PR #2's Ledger retains pending intent, blocks reads/runs and requires explicit reconciliation of
the service's actual head. A false acknowledgement, conflicting head, outage or invalid response
also stops progress. Completed operation IDs replay only the saved result after current head validation.
This is local single-writer plus external CAS, not distributed physical-device fencing.

No usable external endpoint/credential binding was found; none was created or purchased. Tests use
an actual loopback HTTP server in a separate process, with explicit loopback-only plaintext opt-in.
It is a contract model, **not deployed external immutable storage**, TLS deployment or proof of
independent administration. Two actual client processes compete for one head; only one CAS succeeds.
Further tests exercise pre/post-commit response loss, bad acknowledgement, 401/403, 503, timeout,
redirect denial, malformed/oversized response, credential rotation/expiry, restart replay and
rollback of both local files. Existing PR #2 corruption/truncation/sequence tests remain.

## Read-only device reconciliation

`DeviceReconciler` uses the existing Ledger to audit queries against **already quarantined**
operations. `DeviceStateProbe` contains only `query(request)` and `verify(response, request)`;
there is no connect, disconnect, intervention, resend or automatic resume method.

Trusted operator configuration provides device ID, expected boot epoch, original operation ID,
pre-operation sequence and required measurement channels. A deployment must independently establish
this mapping between local target and real device; simulator target labels alone cannot do so.
The probe must use authenticated transport or a verified device signature over the complete
response, including the fresh query nonce and operation. A response's own `authenticated` flag
is insufficient. The caller's verifier is a trust boundary, not proof automatically provided by this library.

Verification requires matching device/boot/operation/nonce; current observation and measurement
timestamps inside the query window; disconnected, not connected, safe-stopped state; complete
confirmed per-operation history in contiguous sequence and issued-phase order; matching last
operation; and operational required measurement channels. No unexpected intervention may appear.
If disconnect was not issued locally, a final device-confirmed safety disconnect is permitted;
its provenance must be covered by the trusted device evidence. A changed boot epoch or missing
history is quarantined pending independently verified operator reconciliation.

Each query has a new nonce and a five-second validity window. Probe implementations must enforce
bounded transport timeouts themselves (the synchronous interface cannot preempt a blocked driver).
Clock sync/trust and a trustworthy initial device sequence are deployment prerequisites. Stale,
reversed, duplicate, competing, unconfirmed, unavailable or untrusted data cannot establish safe stop.

The audit uses new prepared/completed/quarantined operations linked to the original terminal hash.
It stores normalized expectations, request and accepted evidence digest, not credentials or raw
adapter errors. Scientific v2 history selection ignores these audit records. `verified-safe-stop`
is an evidence verdict only: **`resumeAuthorized: false`, `physicalRecoveryVerified: false`**.
The original operation remains quarantined and its stable ID cannot replay the effect. Historical
successful evidence must never be reused as a current resume authorization. Physical restart/
release control requires a separately validated device adapter and policy in a later deployment.

Contract tests use an HMAC-authenticated model, including connect/disconnect response loss,
wrong device/boot/nonce, stale data, unsafe state, insufficient channels, reversed/duplicate/conflicting
history, query outage/deadline, repeated query and writer exclusion. No physical device was used.
Existing actual SIGKILL/concurrent-writer and independent-acquisition tests are retained.

## Validation and scope

```sh
npm ci
npm run typecheck
npm test
npm run test:comparison
npm run bench
npm run check:presets
npm run check:api
```

Local validation passed all 153 tests (existing 134 + 19 new), plus 11 comparison tests, with zero failures/skips. Typecheck, 57 conformance checks, 38 presets and API passed; theory retained 7 positive/5 negative/2 null results and meta retained 2 stable/5 dependent results. Existing 134 tests and 11 comparison tests remain. New test files are automatically included by
`npm test` and the existing CI. Source files for scientific generation, acquisition, intervention,
Ledger, HTTP routes, core, UI, presets, dependency locks and retained v1/v2 results are unchanged.
No experimental conditions changed; verify existing v2 fingerprints rather than replacing results.
CI still runs the complete 504 comparison twice and uploads both reports/36 chains/504 receipts.
There is no SQLite, separate build target or WebSocket implementation to claim tested.

The server remains unauthenticated and loopback-bound by default; existing Origin/DNS-rebinding
checks are unchanged and are not user authentication. External exposure requires an independently
authenticated proxy and authorization policy for the whole service. Secrets metadata access remains
403/uninspected; no secret values are retrieved or printed. Cloud install/start instructions are
saved drafts. Environment publication and restoration in a genuinely new task are unverified;
review/save/publish in Codex environment settings, then launch a new task and execute saved checks.

Authentic runtime v0.2.0 source/protocol/data remain unlocated; unreproduced, never fabricated.
Historical negative results and the lack of demonstrated history-specific performance superiority
remain. No measurement physics is invented: supplied-candidate selection and bounded supplied-
operation composition/revision retain their existing limitations. All device effects in scientific
cycles remain simulated. Strong Xenoscience conditions are independently unproven: human-energy
independence, human-readability independence, material/organizational self-reproduction of inquiry,
and general autonomous variable/boundary/scale revision. Their joint establishment is unproven.
