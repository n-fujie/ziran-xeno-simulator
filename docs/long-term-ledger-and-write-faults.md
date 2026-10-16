# Long-term ledger storage, write-fault behaviour and resume integration

Base: `main` at `3e06f35542b3a1c6efbededcec3fd198dc3cb5c6` (PRs #1–#4 merged). TypeScript only, in the existing
runtime. Scientific protocol `engine-scientific-cycle-v2`, retained v1/v2 results, stored `CycleResult`/`Measurement`
shapes and `scientificFingerprint` are unchanged. **Everything is opt-in; defaults reproduce earlier behaviour
byte for byte.**

## 0. What kind of evidence each claim rests on

| Label | Meaning |
|---|---|
| **simulated** | An error injected at one exact filesystem step by a wrapper around the ledger's filesystem layer. The real writes before the fault really happen, including genuine torn writes. |
| **real process** | A separate OS process killed with `SIGKILL` at an exact step, or several real processes contending. |
| **real kernel** | The operating system itself returned the error (`EACCES` from permissions, `EFBIG` from `RLIMIT_FSIZE` with a genuine partial file). |
| **real volume** | A genuinely full filesystem (`ENOSPC`). Run locally on a 3 MB macOS disk image; **not part of CI**. |
| **not tested** | Stated explicitly in section 11. |

No physical device, real instrument or deployed immutable checkpoint service was used anywhere.

## 1. The problem, measured on unmodified main

Every append rewrote the whole ledger. Measured with the same workload on unmodified `main` (120 cycles alternating
`adaptive`/`history` over the seven conditions): **450 appends, ledger 9.8 MB, 2,082.7 MB written, write amplification
212.8×**, the last append rewriting 9.8 MB and taking ~284 ms (first appends ~19 ms). At 30 cycles amplification was
54.9×: 4× the cycles gave 19× the bytes, i.e. quadratic growth. The earlier "~56 KB/cycle" figure was the stored size,
not the bytes written.

## 2. Options compared

| Option | Verdict | Why |
|---|---|---|
| A. Append-only JSONL event log | rejected | A new commit protocol (the existing crash-recovery proofs and tests would not carry over) and a new meaning for the external head's `digest` (a whole-file digest today), which would need a coordinated migration of every deployed external store. |
| B. Generation checkpoints | **adopted as part of D** | The witness records each sealed generation's count, tip hash and byte digest. |
| C. Snapshot + event differences | rejected | Stored results would be summarised or duplicated, risking the history queries and fingerprints that the 504-cycle comparison depends on. |
| D. Rotation into immutable segments | **adopted** | Keeps the per-segment format, the hash chain, the witness-first commit protocol and the external-head semantics. An unrotated ledger is *identical* to the old format. |
| E. Compatibility-preserving migration | **adopted** | Opt-in; an old ledger becomes "segment 0" byte-for-byte; nothing is converted, moved or deleted. |

## 3. Layout and commit protocol

`ledger.json` is the **active** segment. With the opt-in `maxSegmentBytes` (512 B – 1 GiB, per opener), when the
active file has reached that size the *next* append first seals it as `segment-NNNNNN.json` (a hard link to the exact
same bytes; where the filesystem cannot hard-link — `EPERM`/`ENOTSUP`/`EXDEV`/`ENOSYS` only — an atomic, byte-verified
copy) and starts a new active file holding only the new entry. Global sequence numbers, the hash chain and the
operation state machine run across segments. The witness (`*.checkpoint`) records `count`, `hash`, a `digest`, and,
once segments exist, every sealed segment's `{file, count, hash, digest}` plus `rotates` while a rotation is in flight.
With no sealed segments the `digest` is exactly the historic whole-file sha256, so existing external heads stay valid.

Append, in order: (1) write + fsync the pending replacement of the active file, sync the directory; (2) write + fsync +
rename the **witness** naming that pending file (and the new sealed list), sync the directory; (3) compare-and-set the
external head; (4) seal (rotation only) then atomically rename pending over `ledger.json`, sync the directory.
Recovery re-verifies everything: it completes *only* the exact witnessed pending file, advances the external head only
for an exact one-event extension, re-seals idempotently (an existing segment must be byte-identical), and then
removes abandoned temporaries (pending replacements, witness and segment-copy temporaries) — the only files it ever deletes. Sealed segments are never
modified, moved or deleted by this code.

## 4. Compatibility and migration

- **Old format read:** a ledger written by the previous version (real bytes, `test/fixtures/legacy-ledger-v1/`) is read
  unchanged; head hash and counts match.
- **Default appends are byte-identical** to the historic whole-array rewrite (asserted), and the witness keeps its four keys.
- **Opt-in migration:** opening an old ledger with rotation on seals it as `segment-000001.json`, byte-for-byte equal to the
  original `ledger.json` (asserted), then continues the same chain. No irreversible automatic step exists; nothing runs
  unless the opener asks for rotation.
- **A non-rotating opener** can still read and append to a rotated ledger (the active segment then grows unbounded).
- **Downgrade is not supported after the first rotation.** Earlier code fails closed on a rotated ledger (the active
  file no longer starts at sequence 0). There is no reverse exporter; keep the sealed files, which are the original bytes.

## 5. Measured effect (instrumented writes; byte totals reproducible to ~1%, times machine-dependent)

| Run | Appends | Ledger | Bytes written | Amplification | Largest append | Last append | Witness (max) | Segments | Append time first→last 10 |
|---|---|---|---|---|---|---|---|---|---|
| 30 cycles, single file | 114 | 2.0 MB | 110.2 MB | 54.9× | 2.0 MB | 2.0 MB | 221 B | 0 | 18 → 71 ms |
| **120 cycles, single file** | 450 | 9.8 MB | **2,082.7 MB** | **212.8×** | 9.8 MB | 9.8 MB | 221 B | 0 | 19 → 284 ms |
| 120 cycles, 1 MiB segments | 450 | 9.8 MB | 226.5 MB | 23.2× | 1.2 MB | 0.9 MB | 1.8 KB | 8 | 20 → 192 ms |
| 120 cycles, 256 KiB segments | 450 | 9.8 MB | 58.1 MB | 5.9× | 375 KB | 138 KB | 6.4 KB | 32 | 17 → 184 ms |
| 480 cycles, 1 MiB segments | 1,782 | 41.3 MB | 911.7 MB | 22.1× | 1.2 MB | 520 KB | 7.4 KB | 37 | 17 → 745 ms |

Reproduce: `node scripts/ledger-write-bench.ts --cycles N [--segment-bytes M]`. With rotation, total bytes written grow
**linearly** (≈22–23× at 120 and at 480 cycles) and one append writes at most one active segment plus the witness.
Residual amplification ≈ segment size ÷ (2 × mean entry size). **What did not improve:** every append still reads and
re-verifies *all* history (chain, hashes, sealed-segment digests), so append **time** keeps growing with history
(745 ms at 41 MB). That was kept deliberately, because skipping it would trade away tamper detection (section 11).

## 6. Write-fault matrix (all twelve requested conditions)

| # | Condition | Evidence | Observed behaviour |
|---|---|---|---|
| 1 | Out of space | **simulated** `ENOSPC` with real half-written files at the pending and witness steps, persistent variant; **real kernel** `EFBIG` file-size limit; **real volume** `ENOSPC` (local) | Append throws; every acknowledged entry stays visible and verified; the torn file is never history; `recover()` removes it. On a *completely* full volume recovery may be unable to start (it needs a few bytes for its lock) and fails closed; after space is freed it succeeds and appends resume. Real-volume invariants held in both runs of the final script, both layouts (an earlier version of the script reported a failure that was the script's own defect: it did not retry recovery after freeing space). The number of appends acknowledged before `ENOSPC` varied run to run (13–40 single-file, 35–60 rotating on the same 3 MB volume). |
| 2 | No write permission | **real kernel** `EACCES` on the ledger directory and on the witness directory (non-root) | Append throws `EACCES`; history unchanged; nothing abandoned. |
| 3 | Partial write | **simulated** half write at pending/witness; **real kernel** `EFBIG` torn file (102,400 bytes of a >400,000-byte write reached the disk on this machine; the limit's unit differs between shells) | Never visible as history; witness unchanged, so the previous state stays valid. |
| 4 | `SIGKILL` mid-save | **real process**, every commit step: 9 steps single-file, 11 with rotation; plus 4 steps against the real HTTP checkpoint service | Every append the child was told succeeded is present after restart. Killed before the witness is durable → absent; killed after → committed on recovery. Unfinished operations are isolated, never completed. |
| 5 | File sync failure | **simulated** `fsync` on pending and on witness | Append throws; pre-witness failures leave no trace. |
| 6 | Atomic replace failure | **simulated** `rename` of the witness and of pending (`EXDEV`); hard-link failure | Pre-witness: absent. After witness: committed on recovery. Link `EPERM`/`ENOTSUP`/`EXDEV` falls back to a verified copy; any other link error fails the append. |
| 7 | Directory sync failure | **simulated** at each of the 3–4 directory syncs per append | Same classification; failure after the final rename throws although the entry is committed (outcome unknown → treated as failure and isolated). |
| 8 | Concurrent writers | **real process**: 4 processes × 10 operations with retry | 80 entries, none lost, duplicated or interleaved; a live lock is never stolen; a dead owner's lock is removable. |
| 9 | Truncated tail | tamper matrix on single-file and rotating ledgers (valid-prefix truncation, emptied/deleted active segment, dropped last entry of a sealed segment) | Detected; `read()`, `recover()` and new work all refuse. |
| 10 | Corrupt JSON | tamper matrix; audit classification | Detected as ledger-integrity; bounded category in reports, no raw error text. |
| 11 | Storage temporarily unavailable | **simulated** `EIO` on ledger/segment/witness reads; persistent write failure then repair; **real** `EACCES` | Append throws, nothing changes; the next deliberate append works. |
| 12 | External checkpoint update failure | memory store: not applied; applied but acknowledgement lost; outage during recovery; real HTTP service with `SIGKILL` | Fail closed; nothing lost or duplicated; recovery advances or accepts the head only for an exact one-event extension. |

**Runtime sweep:** the swept cycle performs 8 durable ledger writes. For every position *k*, the *k*-th write was failed, both
as a one-off and as a disk that stays broken, on both layouts. The run always threw (a storage failure is never
reported as success); unfinished work was isolated as a quarantine, never completed; and no device effect ran without
its `…-issued` event already durable (**write-ahead discipline**, checked against the effects the run actually reached).
After repair the same operation id is refused and new work proceeds.

## 7. Restart reconciliation of stored events and executed effects

The runtime persists `connect-issued`, `intervention-issued` and `disconnect-issued` *before* each simulated effect
and the sweep above checks this at every failure position. After a crash, `recover()` records `lastPhase` from the
last durable event; `DeviceReconciler` then compares device history with the *issued* phases; and the resume gate
(section 8) refuses clearance when an issued intervention was never re-measured. A cause that cannot be established
stays unresolved: the operation remains quarantined and nothing is retried.

## 8. Resume gate, ledger layout and safety profiles

- The resume-gate suite now runs on **both** layouts (44 tests): assessments, clearances, idempotency, conflict
  detection and the runtime guard all cross sealed-segment boundaries.
- New: idempotency and conflict detection survive a restart; if storage fails while recording a request, a failed
  first write records nothing (the same `resumeId` can be resubmitted), and a failed second write leaves a pending
  record that refuses new work until explicit recovery isolates it — it can never count as clearance.
- `resumeAuthorized` and `physicalRecoveryVerified` remain literal `false`.
- **Safety profiles** (`SCIENCE_SAFETY_PROFILE`, library `createProfiledRuntime`): `compat` (default) is the old
  behaviour; `strict` requires an external checkpoint, turns on rotation (1 MiB) and requires resume clearance, and
  refuses to start if a prerequisite is missing. An unknown value or an incomplete strict configuration returns an
  error and writes nothing; the service never falls back to weaker protection. Verified over a real HTTPS checkpoint
  service. This is software run protection only.

## 9. Evidence chain (`evidence-chain.ts`) on the 504-cycle comparison

Checked for every stored cycle: measurement → decision → adoption → final evaluation → intervention →
independent re-measurement → durable history → later candidate generation. On the regenerated 504 cycles, single-file
**and** rotated (128 KiB): 36/36 chains verified, **0 findings**, 240 adoptions all evaluated, 120 interventions all
re-measured through separate reference paths with write-ahead events, 114 cycles used history, **0** unresolved history
references. History demonstrably **changed the candidate set in 72 of 114** history-using cycles and the adopted
candidate was a history-regenerated one in 18. **That is a mechanism-level effect, not a performance result:** in the
retained v2 comparison, `history` and `no-history` have identical outcomes over 84 runs each (24 verified adoptions, 12
consistent interventions, 36 quarantined, mean final score 0.429). History-specific performance superiority remains
unestablished, and the audit reports `performanceAdvantage: not-established-by-the-record-alone`.

## 10. Scientific results do not depend on the storage layout

The complete 504-cycle comparison was run with single-file ledgers and with 128 KiB rotation; **both reproduce all
504 retained v2 fingerprints exactly** (36 chains, prepared 504 / completed 324 / quarantined 180 / events 720, 504
terminal records; the rotated set has 150 sealed segments). CI now repeats the rotated run against the retained v2 file.

## 11. Known limits (not fixed here)

- **Read/verify cost is still O(total history) per append** (745 ms at 41 MB). A verified-prefix cache keyed on file
  metadata would remove it but would let a modification that preserves size/mtime/inode go unnoticed within a running
  process; that trade-off needs an explicit decision, so it was not made.
- The witness lists every sealed segment (~200 B each), so its rewrite cost grows slowly with segment count.
- Sealed segments are never pruned or archived by this code; storage grows without bound.
- Downgrade after rotation is unsupported (section 4). The segment limit is per opener, not stored in the history.
- **Not tested:** power loss (whether `fsync` ordering is actually honoured by the hardware), real `fsync`/`rename`
  failures from a kernel, network filesystems, Windows, a real full volume in CI, and any real external service or device.
  `fsync`/`rename`/directory-sync failures are simulated only.
- The ledger is tamper-**evident**, not access control: someone who can write the ledger (and, if bound, hold the
  external CAS credential) can write any record. Without an external checkpoint a consistent whole-directory rollback is
  not detectable locally (asserted by test).
- `unreferencedSegments` (a `segment-*.json` not in the witness) are reported by the audit and never adopted or deleted.

## 12. Negative results retained; strong Xenoscience

Theory benchmarks remain 7 positive / 5 negative / 2 null and meta-boundedness 2 stable / 5 meta-dependent. Foreign-history
limits, intervention-quarantine inversions and the absence of demonstrated history-specific performance advantage
remain. All device effects remain simulated. The four strong-Xenoscience conditions (independence from human energy,
independence from human readability, material/organizational self-reproduction of inquiry, autonomous revision of
variables/boundaries/scales) are each unestablished, and so is their joint establishment. This is engineering
robustness of a synthetic runtime.

## Reproduce

```sh
npm ci && npm run typecheck && npm test           # 290 tests
npm run test:comparison && npm run bench && npm run check:presets && npm run check:api
node scripts/scientific-comparison.ts --out /tmp/a.json --receipts-dir /tmp/a-r --verify-against results/scientific-cycle/v2-comparison.json
node scripts/scientific-comparison.ts --out /tmp/b.json --receipts-dir /tmp/b-r --segment-bytes 131072 --verify-against results/scientific-cycle/v2-comparison.json
node scripts/ledger-write-bench.ts --cycles 120 [--segment-bytes 1048576]
# macOS only, not CI: real full-volume ENOSPC
hdiutil create -size 3m -fs "HFS+" -volname ZXSFULL probe.dmg && hdiutil attach probe.dmg -nobrowse -mountpoint /tmp/zxs-full
node scripts/real-enospc-experiment.ts /tmp/zxs-full
```
The permission test needs a non-root user; the TLS tests need `openssl`.
