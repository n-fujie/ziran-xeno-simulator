# Ledger history verification: cost, and an opt-in section-scoped mode

Base: `main` at `34299e94895feb8482d4bbbed0e38dc654e15c4b` (PR #5 merged). TypeScript only, in the existing runtime.
Scientific protocol `engine-scientific-cycle-v2`, retained v1/v2 results, stored `CycleResult`/`Measurement` shapes and
`scientificFingerprint` are unchanged. **The default is unchanged: every load verifies the whole history, exactly as
before.** The new mode is opt-in per opener.

This is an engineering change to a storage/verification layer. It says nothing about the scientific claims, and none
of the strong-Xenoscience conditions are established by it (section 10).

## 1. Where the time goes (measured on unmodified `main`)

A verification (`Ledger.read()`, and the load inside every `append`) does, for the whole history:
read every sealed segment and the active file → `JSON.parse` each → `sha256` of each file's bytes against the digest
in the witness → recompute `sha256(JSON.stringify(entry))` for every entry and check sequence/link/kind/operation
state → compare count, tip and combined digest with the witness → compare with the external head.

`append` additionally ran the per-entry validation **a second time** over the whole chain plus the new entry, so one
append cost one full verification plus half of another. A research cycle is one `read()` and eight appends (prepared,
six events, completed), i.e. about nine whole-history verifications per cycle.

Stage breakdown, P50 over 7 repetitions on the real files (ms; `results/ledger-verification/before-*.json`):

| ledger | entries | bytes | disk read | JSON parse | file digest | per-entry hash+rules | one full verification |
|---|---:|---:|---:|---:|---:|---:|---:|
| 30 cycles, 1 MiB segments | 114 | 2.0 MB | 3.7 | 5.2 | 5.1 | 11.3 | 25.9 |
| 120 cycles, 1 MiB segments | 450 | 9.8 MB | 16.7 | 23.2 | 24.7 | 52.0 | 121.5 |
| 480 cycles, 1 MiB segments | 1,782 | 41.3 MB | 69.4 | 96.5 | 104.9 | 226.6 | 517.2 |

Cost is linear in total history (bytes and entries), independent of the segment size. The per-entry hash/rule pass
is the largest single stage (~44%). A full verification of the 480-cycle history reads 41.3 MB, allocates ~84 MB of
heap and uses ~0.57 s of CPU. A restart in a fresh process costs the same (P50 544 ms).

Consequence in `main`: an append at 41 MB takes P50 757 ms (P99 1.5 s); a whole research cycle's ledger work takes
P50 6.7 s and reads 371 MB from disk. Segment rotation (PR #5) bounded the bytes *written*, not the bytes *verified*.

## 2. Options considered

| Option | Decision | Reason |
|---|---|---|
| A. Cache of verified segments (persistent) | Rejected | A file the cache vouches for can be replaced after the cache was written. A cache is not evidence about the current files. Only an in-memory state that was verified in this process, in this section, is used. |
| B. Per-segment SHA-256 commitments | Already present | The witness already commits to every sealed segment's `count`, tip `hash` and byte `digest`. Nothing to add. |
| C. Incremental verification from a trusted checkpoint | Not implemented | Needs a trusted anchor that lets the verifier skip *reading* sealed bytes. The only anchors here (local witness, external head) commit to digests; comparing a digest with the bytes on disk requires reading them. No independent anchor of the bytes exists, so full verification is kept wherever no anchor exists (every section start, restart, recovery, audit). |
| D. Content-addressed segments | Rejected | Changes the on-disk format and adds migration risk without removing the need to read bytes to know they are unmodified. |
| E. Verified prefix persisted across processes | Rejected | Same objection as A; it would be a persisted claim about files that can change afterwards. |
| F. Merkle tree | Rejected | New structure and no new trust anchor; the per-append cost is dominated by re-reading, not by combining digests. No invented cryptography is introduced. |
| **R1. Validate only the new entry in `append`** | **Implemented (all modes)** | The duplicate full validation re-checked a chain that `load()` had just verified. Only the new entry needs position, link, hash and operation-state checks. Same guarantee, less work. |
| **S. Verify the whole history once per exclusive section (`verification: 'section'`)** | **Implemented, opt-in** | See section 3. Removes eight of the nine whole-history verifications of a cycle. |

## 3. What was implemented

`src/science/store.ts`, `src/science/profile.ts`, `src/science/http.ts`, `src/science/ledger-audit.ts`.

**R1 (all modes, equivalent guarantee).** `append` no longer re-runs the full chain validation. It checks the one new
entry through the same function (`checkEntry`) the full validator uses: sequence, previous hash, kind, own hash and the
operation rules (no duplicate `prepared`, no event outside an active operation, nothing after `completed`/`quarantined`).
The per-operation state is built once during load. Behavior and error messages are unchanged.

**Section-scoped verification (opt-in).** `new Ledger(dir, witness, external, { verification: 'section' })`.
The default is `'full'`; any other value throws `invalid verification mode`.

Inside one `exclusive()` critical section:

1. The first load (`read()`, or the first `append` if no read came first) is a **full** verification, exactly as in
   `'full'` mode: sealed bytes, counts, tips, entry hashes, chain, witness, external head. Just *before* each sealed
   segment is read, its file attributes (device, inode, size, mtime, ctime) are recorded.
2. That verified state (counts, tip, sealed list, operation states, the attributes) is kept **in memory only**.
3. Each later `append` in the same section does **not** re-read sealed segments. It verifies what can differ between
   two appends of one writer: (a) the writer lock is still this section's (token compare); (b) the witness still
   describes exactly the state this section verified or wrote; (c) the active file's bytes still hash to the digest that
   state commits to (that digest also commits to every sealed segment's digest); (d) **attribute tripwire:** every
   sealed segment still has the attributes recorded before it was verified; (e) the external head, when bound, still
   equals the head of that state; (f) the new entry.
4. After a successful commit the kept state becomes the state just written. A segment this section just sealed joins
   it only after its bytes are re-read once and match the digest the witness records.

**Attributes are a tripwire, not evidence.** (d) can only *escalate*: any difference, or any failure to inspect a
segment, sends the append back to a full verification, which reads and hashes every sealed byte. Unchanged attributes
prove nothing about content and skip nothing the section had not already verified. An attacker who can make the
attributes look unchanged (set the clock, act inside one filesystem timestamp tick, or use a filesystem whose
timestamps are coarse) is not seen by (d); see section 4.

Anything else is a full verification: a witness that is not exactly the kept state, active bytes that differ, any
exception from any append, any call to `read()`, `recover()`, `layout()`, the audit or the resume gate. The kept state
is dropped when the section ends, when any load starts and when any append throws (an unconfirmed append is never
continued from stale state).

**Writer lock (both modes).** The lock file now carries a random token next to the pid. A section removes the lock file
only if it still holds *its* token (never a lock another owner created), checks that it still holds the lock before each
append and again right before the first durable change that names the new state, and does not report success if it
finished without owning the lock. A lock file that was created but could not be filled (a full disk) is removed as
before. Old lock files without a token still block a second writer and are still recoverable with `recoverDeadWriter()`.

`ProfileConfig.verification` and the HTTP environment variable `SCIENCE_LEDGER_VERIFICATION=section` select the mode for
the service. Both safety profiles keep `'full'` unless it is chosen explicitly; `strict` does not turn it on. The audit
report gains `verification: { mode, auditVerifiedWholeHistory: true }` (the audit always verifies the whole history).

## 4. What each mode guarantees

Observed outcomes for every condition are in section 7 (`test/ledger-tamper-matrix.test.ts`, 30 matrix rows plus 6 lock/race/profile tests; table printable
with `node scripts/ledger-tamper-matrix.ts`). Summary of what is and is not guaranteed:

| | `full` (default) | `section` (opt-in) |
|---|---|---|
| Whole-history verification (sealed bytes, hash chain, witness, external head) | at every `read()` and at every `append` | at every `read()`, `recover()`, `layout()`, audit, restart and **the start of every section**; **not** at later appends of the same section |
| Per-append, what is re-checked | everything above | lock token; witness equals the section's verified state; active file bytes equal their committed digest; sealed-segment attributes unchanged since verification; external head equals the section's head; the new entry |
| Alteration of a sealed segment *before* a section, or *during the section's first load* | detected | detected |
| Alteration of the active file, witness or external head *between two appends* | detected at the next append | detected at the next append |
| Alteration of a **sealed** segment *between two appends of one section* | detected at the next append (re-read and hashed) | detected at the next append **if the attributes changed** (all ordinary writes, replacements and re-creations, including with mtime/atime restored, change ctime); **not** detected by that section if the attacker also hides the change from the attributes. The next section, `read()`, restart, recovery or audit then catches it |
| Writer lock deleted or replaced mid-section | stopped at the next append (new in this PR) | stopped at the next append (new in this PR) |
| History written | identical bytes | identical bytes (tested, single-file and rotating) |
| Unconfirmed append | never success; retry re-verifies | never success; the kept state is dropped, retry re-verifies |

What section mode gives up is exactly one thing: a sealed segment rewritten *during* an open section by an attacker
who can also make the file's attributes look unchanged. That requires clock control or acting inside one filesystem
timestamp tick (on Linux, one kernel tick, 1-10 ms), so it is a much narrower condition than "any write access", but
it is **not** zero and **no cryptographic argument closes it**. In `full` mode the same attacker is caught at the next
append. Writing a **new** valid-looking entry cannot hide the change: the new entry's `previous` is the tip verified at
section start (or written by the section), and the altered segment will not match its committed digest at the next full
verification. A section lasts one research cycle (milliseconds to seconds), not a process lifetime.

**Not claimed, in either mode:** protection against an attacker who rewrites the segments, the entry hashes, the chain
and the witness consistently when **no external checkpoint is bound** (T09/T11): every local check passes, because the
verifier and the data share one trust domain. Binding an external checkpoint (the `strict` profile requires one) turns
that into a refusal. The writer lock is advisory: a process that ignores it can still lose or overwrite another
writer's update unless an external compare-and-set sits behind it (R08 vs R15).

**Production use.** Section mode is offered as an opt-in performance mode for deployments that bind an external
checkpoint and accept the single residual window above. It should not be presented as a stronger or equal integrity
guarantee than `full`; `full` remains the default and the only mode with no residual window.

There is no persistent cache, so there is nothing on disk to tamper with or replay.

## 5. Cache (kept state) invalidation conditions

The kept state exists only inside an `exclusive()` section of one `Ledger` object, only in `section` mode, and is
discarded on: end of section (normal or exceptional); the start of any full load; any exception from `append`
(including a fault after the witness became durable); a witness whose count/hash/digest differs from the kept state;
active-file bytes whose digest differs; any sealed segment whose attributes differ or cannot be inspected (these three
fall back to a full verification); an external head that differs (this one throws, it does not fall back); a lost
writer lock (throws). `full` mode never keeps anything.

## 6. Measured performance

Final code (attribute tripwire and lock token included), re-measured after the hardening on histories rebuilt with
unmodified `main` (`34299e9`); every variant is measured on the same files. Apple M1, 8 logical CPUs, macOS 25.6.0,
Node v24.14.1, `--expose-gc`, machine otherwise idle, variants run back to back per ledger. A cycle-shaped section is one
`read()` plus eight appends; 10 sections = 80 appends per cell; 20 repetitions of a full verification.
Raw numbers and reproduction commands: `results/ledger-verification/final-code/`. An earlier run on the first PR commit
(without the tripwire; six ledgers, including 256 KiB and 4 MiB segments) is in `results/ledger-verification/` and agrees
(480 cycles: append P50 757 → 23.0 ms there as well).

| ledger | variant | append P50 | P95 | P99 | cycle section P50 | CPU / append P50 | MB read / cycle | whole-history verifications / cycle |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 30 cycles, 1 MiB seg (2.0 MB) | before (main) | 66.0 ms | 93.9 | 505.9 | 549 ms | 48.0 ms | 18.1 | 9 (derived: 1 read + 8 appends) |
|  | R1 only | 51.5 ms | 69.9 | 130.8 | 461 ms | 35.2 ms | 18.1 | 9 |
|  | section | 29.3 ms | 34.0 | 40.3 | 268 ms | 13.4 ms | 9.0 | 1 (+8 section checks) |
| 120 cycles, 1 MiB seg (9.8 MB) | before (main) | 216.2 ms | 503.2 | 841.5 | 1878 ms | 194.8 ms | 88.1 | 9 (derived: 1 read + 8 appends) |
|  | R1 only | 142.8 ms | 159.9 | 180.7 | 1283 ms | 126.2 ms | 88.1 | 9 |
|  | section | 28.0 ms | 33.4 | 89.0 | 342 ms | 13.4 ms | 17.1 | 1 (+8 section checks) |
| 120 cycles, no rotation (9.8 MB) | before (main) | 264.8 ms | 300.0 | 340.4 | 2280 ms | 244.5 ms | 88.1 | 9 (derived: 1 read + 8 appends) |
|  | R1 only | 210.4 ms | 242.7 | 312.8 | 1825 ms | 190.8 ms | 88.1 | 9 |
|  | section | 134.9 ms | 157.9 | 239.9 | 1200 ms | 112.1 ms | 88.1 | 1 (+8 section checks) |
| 480 cycles, 1 MiB seg (41 MB) | before (main) | 757.9 ms | 859.6 | 1469.2 | 6656 ms | 797.3 ms | 371.4 | 9 (derived: 1 read + 8 appends) |
|  | R1 only | 533.5 ms | 626.7 | 1441.6 | 4840 ms | 575.7 ms | 371.4 | 9 |
|  | section | 23.0 ms | 28.3 | 43.0 | 693 ms | 8.7 ms | 45.4 | 1 (+8 section checks) |

Reading it honestly:

- R1 alone (full mode, same guarantee as before): -20% to -30% per append and per cycle; bytes read unchanged.
- Section mode on a rotated ledger makes the append cost follow the **active segment**, not the history: at 41 MB an
  append is P50 23.0 ms instead of 757.9 ms (33x) and a whole cycle's ledger work 0.69 s instead of 6.66 s (9.6x); bytes
  read per cycle 45 MB instead of 371 MB; CPU per append 8.7 ms instead of 797 ms; whole-history verifications per cycle
  9 → 1. The remaining per-cycle cost is the one full verification at the start of the section (about 0.5 s at 41 MB).
  **Cost per section, per restart, per audit and per recovery is still linear in history** (restart P50 533 ms at 41 MB in
  every variant; recovery of a healthy 41 MB ledger about 1.6 s in every variant, because recovery verifies repeatedly by
  design and always in full).
- The attribute tripwire adds one `stat` per sealed segment per append. It is not visible in the measurements (append P50
  23.0 ms with and without it at 37 sealed segments); with very many segments it grows linearly in their number.
- Not rotated (`c120-plain`), the active file is the whole history, so every append still rewrites and re-hashes it
  (78 MB written per cycle); section mode helps (-49% per append) but does not change the growth shape.
- Before/after distributions do not overlap in any cell (the slowest section-mode append and the slowest section-mode
  cycle are faster than the fastest "before" sample). Section-mode CV 0.09-0.27; a few outlier samples (P99 up to 89 ms at
  120 cycles) are visible, so P99 is the least stable figure.
- Single machine, warm cache, SSD. A cold cache, a network filesystem or a spinning disk would change absolute figures.

## 7. Fault injection, tamper and race conditions

Kinds: **simulated** (an error injected, or a file edited, at one exact filesystem step by the test), **real process**
(a separate OS process killed with `SIGKILL`, or rewriting a file; contention), **real kernel** (the OS returned the
error), **real volume** (a genuinely full filesystem; local only). Every existing fault suite also runs with
`LEDGER_TEST_VERIFICATION=section` (CI does both).

### 7.1 Tamper and race matrix (`test/ledger-tamper-matrix.test.ts`, `scripts/ledger-tamper-matrix.ts`)

Each row builds a rotated ledger with ten cycles (several sealed segments), opens one exclusive section, performs the
attack at the stated point, and records what happened. Outcomes: **blocked-in-section** (a later append of the same
section refused to continue), **failed-safe** (the append in progress failed; nothing was blessed), **caught-later**
(the section went on; the next full verification refuses the history), **accepted** (every later verification accepts
the result). Attacks T02 and the file edits run in separate OS processes or directly on the files; times are restored
with `utimes` where the row says so. The "before" column is section mode as submitted in the first commit of this PR
(`594aca9`), recorded by the same matrix (`results/ledger-verification/matrix-before-hardening.json`).

| ID | Condition | External anchor | `full` | `section` before this PR's hardening | `section` now |
|---|---|---|---|---|---|
| T01 | same-process content change of a sealed segment (same size) | no | blocked-in-section | caught-later | blocked-in-section |
| T02 | content change of a sealed segment by another process | no | blocked-in-section | caught-later | blocked-in-section |
| T03 | sealed segment swapped with another valid segment | no | blocked-in-section | caught-later | blocked-in-section |
| T04 | same size, different content, mtime NOT restored | no | blocked-in-section | caught-later | blocked-in-section |
| T05 | same size, different content, mtime/atime restored | no | blocked-in-section | caught-later | blocked-in-section |
| T06a | file replaced by a new inode, times restored | no | blocked-in-section | caught-later | blocked-in-section |
| T06b | file deleted and re-created (inode may be reused), times restored | no | blocked-in-section | caught-later | blocked-in-section |
| T07 | consistent rollback: an older snapshot of ALL files restored | no | blocked-in-section | blocked-in-section | blocked-in-section |
| T07 | consistent rollback: an older snapshot of ALL files restored | yes | blocked-in-section | blocked-in-section | blocked-in-section |
| T08 | witness rolled back to an earlier value | no | blocked-in-section | blocked-in-section | blocked-in-section |
| T09 | witness regenerated to describe tampered files (no external anchor) | no | accepted | accepted | accepted |
| T09x | witness regenerated to describe tampered files (external anchor bound) | yes | blocked-in-section | blocked-in-section | blocked-in-section |
| T10 | tail of the active file deleted | no | blocked-in-section | blocked-in-section | blocked-in-section |
| T11 | hash chain regenerated after editing an old entry (witness updated) | no | accepted | accepted | accepted |
| T11x | hash chain regenerated after editing an old entry (external anchor bound) | yes | blocked-in-section | blocked-in-section | blocked-in-section |
| T12 | decoy "verified cache" files planted, sealed segment altered | no | blocked-in-section | caught-later | blocked-in-section |
| T13 | earlier section result replayed: sealed segment altered between two sections of ONE object | no | blocked-in-section | blocked-in-section | blocked-in-section |
| T14 | sealed segment altered, then a fresh object (restart) opens a section | no | blocked-in-section | blocked-in-section | blocked-in-section |
| T15 | external head moved/rolled back by someone else | yes | blocked-in-section | blocked-in-section | blocked-in-section |
| R01 | history altered before the lock is taken | no | blocked-in-section | blocked-in-section | blocked-in-section |
| R02 | history altered right after the lock is taken, before the first load | no | blocked-in-section | blocked-in-section | blocked-in-section |
| R03 | history altered DURING verification, after that segment was already read | no | failed-safe | caught-later | failed-safe |
| R04 | segment swapped right after verification, before the first append | no | failed-safe | caught-later | failed-safe |
| R05 | witness changed right before the append | no | failed-safe | failed-safe | failed-safe |
| R06 | sealed segment altered while the pending file is being saved | no | blocked-in-section | caught-later | blocked-in-section |
| R07 | active file altered while the segment is being sealed | no | caught-later | caught-later | blocked-in-section |
| R08 | witness replaced by a foreign file just before our witness rename | no | accepted | accepted | accepted |
| R12a | writer.lock deleted by a third party mid-section (ownership lost) | no | blocked-in-section | blocked-in-section | blocked-in-section |
| R12b | writer.lock replaced by another owner mid-section | no | blocked-in-section | accepted | blocked-in-section |
| R15 | external head advanced by another writer just before our compare-and-set | yes | failed-safe | failed-safe | failed-safe |

Reading it:

- Before the hardening, section mode did **not** stop in-section sealed-segment changes (T01-T06b, T12, R04, R06; R03
  after a verification-time change; R07 after a seal-time change). It caught them at the next verification. That was
  the documented window; the new attribute tripwire closes it for every attack that changes the file's attributes.
  `T05`, `T06a`, `T06b` restore mtime/atime and re-create the inode: ctime still changes and the tripwire fires.
- The remaining `accepted` rows are the same in both modes and are **not passes**: T09/T11 (a consistent forgery of
  files and witness with no independent anchor; refused as soon as an external anchor is bound, T09x/T11x) and R08 (a
  foreign witness replaced by this writer's own atomic witness rename; the lock is advisory).
- The attribute tripwire is exercised with attributes it cannot see (`signatureSync` stubbed constant): section mode then
  accepts an in-section sealed-segment change and only the next full verification refuses it, while `full` mode refuses
  it at once. That is the residual window, tested, not assumed away.
- Two defects were found and fixed by this matrix: `exclusive()` unlinked `writer.lock` unconditionally (it could remove
  another owner's lock, R12b), and a lock lost mid-section was not noticed by appends (R12a was caught only by the
  accident of the final unlink failing).

### 7.2 Other conditions

| Condition | Kind | Result |
|---|---|---|
| Writer lock replaced / deleted mid-section | simulated | next append stops; foreign lock is left in place; a section that lost its lock does not report success |
| Legacy lock file without a token; dead owner; live owner | simulated | still blocks a second writer; dead owner's lock removed by `recoverDeadWriter()`; live owner refused |
| Recovery or a second writer while a section is open | simulated | `EEXIST` |
| Reader polling while a section-mode writer commits (60 cycles, rotating) | real process | only complete verified prefixes of increasing length; refused reads are integrity refusals; creation-time empty witness is a refusal, never wrong data |
| Four-process contention, `SIGKILL` at every commit step (also against the HTTP checkpoint service) | real process | passes in both modes |
| Partial write, ENOSPC / EIO at every commit step; fsync, rename, link, read failures; disk that stays full; lock file that cannot be filled | simulated | pass in both modes; a failing append is never reported as success; the kept state is dropped; retry re-verifies |
| `EACCES`, `EFBIG` (genuine torn write) | real kernel | pass in both modes |
| Full volume `ENOSPC` | real volume (local, not CI) | `results/ledger-verification/real-enospc-section.json` |
| Incomplete rotation (kill / fault between witness, seal, rename) | simulated + real process | recovery completes only the exact witnessed file, in both modes |
| Resume gate with a tampered sealed segment, section mode | simulated | new work refused at the first load of the section |
| Cache tampering, stale-cache replay, cache after restart | n/a | no persistent cache exists; decoy cache files are ignored (T12); a new object or process always starts with a full verification (T13, T14) |
| Power loss, lying `fsync`, controller faults | **not tested** | not covered |

## 8. Scientific regression and safety are checked separately

Scientific reproducibility: `node scripts/scientific-comparison.ts ... --verify-against results/scientific-cycle/v2-comparison.json`
over all 504 cycles (36 chains = 2 caps x 3 seeds x 6 methods), once per storage layout: single file, segmented
(131,072 B), section, segmented + section. This says nothing about integrity safety: matching fingerprints do not show
that a tampered history would be refused; that is section 7. Conversely, section 7 says nothing about the science.

## 9. Results (final code)

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` (default mode) | 339 / 339 pass (290 from before this PR + 13 section-mode + 36 tamper/race matrix), 0 skipped |
| `LEDGER_TEST_VERIFICATION=section npm test` (the same 339 with every `Ledger` in section mode, including real `SIGKILL`, `EACCES`, `EFBIG`, four-process and TLS tests) | 339 / 339 pass, 0 skipped |
| `npm run test:comparison` | 11 / 11 pass |
| `npm run bench` | 57 conformance checks, 0 failed; 14 theory: 7 positive / 5 negative / 2 null; 7 meta-boundedness: 2 stable, 5 meta-dependent |
| `check:presets` / `check:api` | 38 presets, 0 failed / 0 endpoint checks failed |
| 504 fingerprints vs retained v2: single / segmented / section / segmented + section | all reproduced exactly, in all four |
| Record structure in all four layouts (independent count over the stored ledgers) | 36 chains; prepared 504, event 720, completed 324, quarantined 180 (terminal 504); 1,728 entries; 150 sealed segments when segmented |
| Real full volume (`ENOSPC` from a 3 MB disk image), `full` and `section`, single file and rotating | all invariants held in both; recovery while the volume is still full may itself fail with `ENOSPC` and then stays stopped; after space is freed recovery and a new append succeed |

Outside wall-clock and CPU timings, the rows, summary and controls of all four comparison reports are identical to the
retained v2 report. Wall time of the four runs (41-52 s) was not controlled and is not performance evidence.
Details: `results/ledger-verification/regression.json`.

## 10. Unfinished, and what is not claimed

- Verification per section, per restart and per audit is still O(history). A trusted anchor that avoids reading sealed
  bytes does not exist in this design; none was invented.
- Unrotated ledgers still rewrite the whole file per append.
- Section mode is not the default, and `strict` does not select it. Choosing it accepts the narrow residual window in
  section 4 (an in-section sealed-segment change that also hides from file attributes). It is not offered as an integrity
  guarantee equal to `full`.
- The attribute tripwire depends on filesystem timestamp resolution; on a filesystem with coarse timestamps it is weaker.
- The advisory writer lock cannot stop a process that ignores it; only an external compare-and-set closes lost updates.
- `resumeAuthorized` and `physicalRecoveryVerified` remain literal `false`; the resume gate is unchanged and always
  fully verifies.
- Retained negative results are unchanged: history changed the candidate set in 72 of 114 history-using cycles, yet
  history versus no-history performance is identical over 84 runs each; theory: 7 positive / 5 negative / 2 null;
  foreign-history limits; the intervention-quarantine inversion. Nothing here supports a performance advantage of
  history.
- The strong-Xenoscience conditions (external reproduction, independent measurement of real devices, a deployed
  independent immutable checkpoint, physical recovery verification) remain **unestablished**. This is an engineering
  improvement of an ingestion/audit layer.
