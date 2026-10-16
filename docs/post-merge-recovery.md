# Post-merge checkpoint and recovery integration

Base main: `39b2a47c4ec99c00a22929e31e18ee31e5cc063e` (GitHub-confirmed PR #1 merge).
`git merge-base --is-ancestor 39b2a47 HEAD` returned 0 before branching.
Package version remains 0.4.0; scientific protocol remains `engine-scientific-cycle-v2`.

## External store integration

The existing JSON ledger and separate local witness retain their exact formats and hashes.
Neither file is external immutable storage. `Ledger` now accepts an optional third argument,
`ExternalCheckpointBinding` from `src/science/checkpoint.ts`. Existing callers are unchanged.
For an embedded deployment, inject a bounded **synchronous** adapter:

```ts
const binding = { historyId: 'experiment-01', seriesId: 'series-01', store: trustedAdapter };
const runtime = new ScientificRuntime(new Ledger(dataDirectory, witnessFile, binding));
```

This is a programmatic interface for the existing runtime, not a new experiment framework.
The HTTP singleton continues to use local storage; it does not silently activate an external service.
A deployment must wire its trusted adapter before claiming external protection for HTTP operations.
No actual external endpoint, credential or immutable service was available in this task.

The adapter implements `read(historyId, seriesId)` and atomic `compareAndSet(expected, next)`.
A head carries version, operator-assigned stable history and series identifiers, count, tail hash,
and the SHA-256 digest of the complete serialized ledger. The operator must provision genesis
(`externalHead(binding)`) or an independently verified existing head **out of band**, once.
Never provision from an unverified local store or automatically enrol a missing/unreachable series.
The trusted configuration must preserve both identifiers and adapter binding across restarts.
Do not disable the binding after a failure or relabel a series to bypass a mismatch.
Adapters must enforce finite timeouts, authenticated transport, exact-head CAS, durable monotonic
retention and access isolation from the ledger writer. The interface cannot establish these facts.
It is intentionally synchronous because the current Engine and transaction API are synchronous;
network adapters must not return promises or rely on same-thread async callbacks.
A production async client needs an explicit asynchronous runtime integration in a follow-up.

## Commit, interruption and reconciliation

1. Every read/run verifies local chain and witness, then the exact externally retained head.
   Unavailability, wrong identity/digest/position or local rollback stops before measurement/control.
2. Under the existing writer lock, append writes/fsyncs pending data and the local witness.
3. External CAS advances the previously verified head to the new exact digest; a read-back checks it.
4. Only then does local ledger replacement finish. An acknowledgement alone is insufficient.

A transport error may occur after the external write succeeded. The pending intent remains durable;
ordinary reads/runs fail closed. Explicit `recover()` accepts only the exact witnessed pending data.
If the external head already equals pending, it finishes the local replacement without another CAS.
If external still equals the exact local predecessor, it can CAS only a verified one-event extension.
Any other head, corruption or unavailable service stops recovery. Unfinished operation intents are
then quarantined with their recorded last phase; there is no automatic intervention replay.
A failed quarantine append may surface the existing local `checkpoint mismatch` error rather than
the initial transport exception: this is a recovery-required state, not proof of an unexecuted effect.
Local snapshots remain audit data; no physical device state is restored by this process.
The checkpoint HTTP export now validates the ledger before returning its local witness.

## Regression and fault evidence

Existing 122 tests are preserved. Added coverage includes external-head restart/idempotent replay,
rollback of both local files, alternate-history replacement, identity/digest/position mismatch,
read outage, pre-commit outage, committed-but-lost acknowledgement, post-intervention outage,
false acknowledgement, external CAS conflict, corrupt pending data and truncated-ledger HTTP export.
The external model is an in-memory fault-injection adapter, **not an immutable-service deployment**.
Existing actual subprocess SIGKILL at uncertain connect/disconnect, concurrent writer exclusion,
lost HTTP response, repeated operation IDs, source-binding and independent-acquisition tests remain.
All device effects in these tests are simulated Engine effects; hardware is unverified.

Reproduce from Node >=23.6 (validated Node 24.19.0):

```sh
npm ci
npm run typecheck
npm test
npm run test:comparison
npm run bench
npm run check:presets
npm run check:api
node scripts/scientific-comparison.ts --out /tmp/postmerge-report.json --receipts-dir /tmp/postmerge-new-receipts --verify-against results/scientific-cycle/v2-comparison.json
```

Use a new/empty receipts directory. There is no separate build script (TypeScript runs natively;
`tsconfig.json` has `noEmit: true`) and no WebSocket implementation to test.
CI retains both complete 504 runs and artifacts containing 36 witnessed chains/504 terminal receipts.
The changed storage file has a new source hash, but scientific fingerprints must match retained v2.
Old v1 results remain untouched and are evaluated using their historical implementation, not v2.
No performance or fairness claim is inferred from the external-model tests or timing differences.

## Security and uncompleted work

HTTP has no user authentication, API keys or token issue/refresh/revocation subsystem. Same-origin
checks and loopback DNS-rebinding defenses are preserved and tested; these are not authentication.
The whole existing server must stay loopback-bound or behind an independently authenticated proxy.
External checkpoint credentials belong in the adapter's protected configuration, never ledger data,
request bodies or logged exception strings. No secrets are added by this change. Actions uses
`contents: read` and no explicit repository-secret references; secret-metadata listing returned 403,
so actual repository Secrets settings remain uninspected. Token-expiry tests would invent a subsystem.

Saved install/start instructions are cloud-side drafts, not repository configuration or proof of
publication. Publication and a newly created task's restoration require environment-settings review,
save/publish, then a fresh task executing those instructions. They remain unverified here.
Runtime v0.2.0 source/protocol/data remain unlocated in the available history/tags/releases; no
replacement material is fabricated. Previous source/ZIP provenance is recorded in the PR #1 audit.

Residual-conditioned supplied-grammar revision, separate generation/decision/evaluation/control
measurements, adoption, intervention and later history use are unchanged. Historical failures,
foreign-history limits, inverted intervention quarantine and the absence of proven history-specific
superiority remain research results. No new physical measurement principle is claimed.

Strong Xenoscience conditions are evaluated independently: (1) independence from human energy is
unproven; (2) independence from human readability is unproven; (3) material/organizational
self-reproduction of inquiry is unproven; (4) general autonomous variable/boundary/scale revision
is unproven (only bounded supplied-grammar/placement changes exist). Joint establishment is unproven.
Engineering regression success does not establish hardware/production readiness or strong Xenoscience.
