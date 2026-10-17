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
   `'full'` mode: sealed bytes, counts, tips, entry hashes, chain, witness, external head.
2. That verified state (counts, tip, sealed list, operation states) is kept **in memory only**.
3. Each later `append` in the same section does **not** re-read sealed segments. It verifies what can differ between
   two appends of one writer: (a) the witness still describes exactly the state this section verified or wrote;
   (b) the active file's bytes still hash to the digest that state commits to (that digest also commits to every sealed
   segment's digest); (c) the external head, when bound, still equals the head of that state; (d) the new entry.
4. After a successful commit the kept state becomes the state just written.

Anything else is a full verification: a witness that is not exactly the kept state, active bytes that differ, any
exception from any append, any call to `read()`, `recover()`, `layout()`, the audit or the resume gate. The kept state
is dropped when the section ends, when any load starts and when any append throws (an unconfirmed append is never
continued from stale state).

`ProfileConfig.verification` and the HTTP environment variable `SCIENCE_LEDGER_VERIFICATION=section` select it for the
service. Both safety profiles keep `'full'` unless it is chosen explicitly; `strict` does not turn it on. The audit
report gains `verification: { mode, auditVerifiedWholeHistory: true }` (the audit always verifies the whole history).

## 4. What each mode guarantees

| | `full` (default) | `section` (opt-in) |
|---|---|---|
| Whole-history verification (sealed bytes, hash chain, witness, external head) | at every `read()` and at every `append` | at every `read()`, `recover()`, `layout()`, audit, restart and **the start of every section**; **not** again at later appends of the same section |
| Per-append, what is re-checked | everything above | witness equals the section's verified state; active file bytes equal its committed digest; external head equals the section's head; the new entry |
| Alteration of a sealed segment *before* a section | detected | detected (at that section's first load) |
| Alteration of the active file, witness or external head *between two appends* | detected at the next append | detected at the next append |
| Alteration of a **sealed** segment *between two appends of one section* | detected at the next append | **not detected by that section's appends**; detected by the next section, `read()`, restart, recovery or audit |
| History written | identical bytes | identical bytes (tested, single-file and rotating) |
| Unconfirmed append | never success; retry re-verifies | never success; the kept state is dropped, retry re-verifies |

The only guarantee section mode gives up is the middle row: a sealed segment rewritten by something with write access
to the ledger directory *during* an open section. In `full` mode the same attacker is caught at the next append; in
section mode the section's decisions come from the history verified at its start and the tampered file is caught at the
next verification. Writing a **new** valid-looking entry cannot hide it: the new entry's `previous` is the tip verified
at section start, and the tampered segment will not match its committed digest at the next full verification. A
section lasts one research cycle (milliseconds to seconds), not a process lifetime; nothing is carried to the next one.

No file attribute (mtime, inode, size) is trusted anywhere. There is no persistent cache, so there is nothing on disk
to tamper with or replay.

## 5. Cache (kept state) invalidation conditions

The kept state exists only inside an `exclusive()` section of one `Ledger` object, only in `section` mode, and is
discarded on: end of section (normal or exceptional); the start of any full load; any exception from `append`
(including a fault after the witness became durable); a witness whose count/hash/digest differs from the kept state;
active-file bytes whose digest differs; an external head that differs (this one throws, it does not fall back).
`full` mode never keeps anything.

## 6. Measured performance

Same workloads, same machine (Apple M1, 8 logical CPUs, macOS 25.6.0, Node v24.14.1, `--expose-gc`), same ledger
files copied for each run, measured before (`main` at `34299e9`, frozen worktree), with R1 only (`verification: 'full'`
on the new code) and with section mode. A cycle-shaped section is one `read()` plus eight appends, 10 sections = 80
appends per cell. Full tables and raw numbers: `results/ledger-verification/`.

| ledger | variant | append P50 | P95 | P99 | whole cycle section P50 | bytes read / cycle | bytes written / cycle |
|---|---|---:|---:|---:|---:|---:|---:|
| 30 cycles, 1 MiB seg | before | 65.2 ms | 89.6 | 130.0 | 547 ms | 18.1 MB | 7.0 MB |
| | R1 only | 49.0 | 53.0 | 55.9 | 423 | 18.1 | 7.0 |
| | section | 27.9 | 30.0 | 32.0 | 249 | 9.0 | 7.0 |
| 120 cycles, 256 KiB seg | before | 186.4 | 196.5 | 223.6 | 1,610 | 88.2 | 1.1 |
| | R1 only | 136.5 | 163.9 | 207.6 | 1,224 | 88.2 | 1.1 |
| | section | 17.1 | 20.0 | 21.6 | 260 | 10.9 | 1.1 |
| 120 cycles, 1 MiB seg | before | 194.8 | 210.9 | 298.2 | 1,698 | 88.1 | 7.3 |
| | R1 only | 142.6 | 157.3 | 187.3 | 1,268 | 88.1 | 7.3 |
| | section | 29.4 | 36.0 | 39.4 | 359 | 17.1 | 7.3 |
| 120 cycles, 4 MiB seg | before | 194.0 | 215.6 | 262.4 | 1,675 | 88.1 | 9.8 |
| | R1 only | 150.6 | 218.1 | 250.4 | 1,346 | 88.1 | 9.8 |
| | section | 32.1 | 38.0 | 46.6 | 383 | 19.6 | 9.8 |
| 120 cycles, no rotation | before | 260.0 | 418.5 | 473.3 | 2,250 | 88.1 | 78.3 |
| | R1 only | 207.8 | 228.0 | 241.5 | 1,802 | 88.1 | 78.3 |
| | section | 137.1 | 181.1 | 207.8 | 1,225 | 88.1 | 78.3 |
| 480 cycles, 1 MiB seg | before | 757.0 | 926.0 | 1,547 | 6,682 | 371.4 | 4.2 |
| | R1 only | 533.5 | 635.8 | 1,319 | 4,917 | 371.4 | 4.2 |
| | section | 23.0 | 58.7 | 245.8 | 708 | 45.4 | 4.2 |

Reading the table honestly:

- R1 alone removes the duplicate validation: roughly -20% to -30% per append and per cycle, no change in bytes read.
- Section mode on a rotated ledger makes the append cost track the **active segment**, not the history: at 480 cycles
  (41 MB) an append is P50 23 ms instead of 757 ms (33×), a whole cycle's ledger work 0.71 s instead of 6.7 s (9.4×),
  bytes read per cycle 45 MB instead of 371 MB. The remaining per-cycle cost is the one full verification at the start
  of the section (P50 535 ms at 480 cycles). **Cost per section, per restart and per audit is still linear in history.**
- Not rotated (`c120-plain`), the active file is the whole history, so every append still rewrites and re-hashes it
  (78 MB written per cycle); section mode helps there (-47% per append) but does not change the growth shape.
  Rotation remains the way to bound it.
- Distributions do not overlap between before and section in any cell (the slowest section-mode sample is faster than
  the fastest sample before), so the improvement is not noise. The 480-cycle section-mode P99 (246 ms) and CV (0.9)
  come from a few outliers (one-off ~250 ms samples, likely garbage collection or a slow `fsync`); P50 and P95 are
  stable. These are single-machine, single-filesystem measurements on an SSD with caching; a cold cache, a network
  filesystem or a spinning disk would change absolute figures.
- Restart (a fresh process reading the history) is unchanged by design: P50 540 ms at 480 cycles in all variants.

## 7. Fault injection and attack conditions

Kinds: **simulated** (error injected at one exact filesystem step), **real process** (separate OS process killed with
`SIGKILL` / contention), **real kernel** (the OS returned the error), **real volume** (genuinely full filesystem; local
only). Every existing fault suite also runs with `LEDGER_TEST_VERIFICATION=section` (CI does both); new tests are in
`test/ledger-section-verification.test.ts`.

| Condition | Kind | Result |
|---|---|---|
| Sealed segment altered before a section | simulated (file edit) | caught at that section's first load; audit reports `failed` |
| Sealed segment altered **during** a section | simulated | not caught by that section's appends (documented window, section 4); caught by next verification; `full` mode catches it at once; tests assert both |
| Segment swap, segment removal | simulated | caught by the next section |
| Active file extended, replaced by older copy (tail deletion / rollback) mid-section | simulated | caught at the next append |
| Witness rolled back, witness digest forged mid-section | simulated | caught at the next append |
| External head rolled back / replaced mid-section | simulated | append throws `external checkpoint mismatch`; the state is not blessed |
| Consistent rollback of segments + witness + active file | simulated (existing) | rejected by the external head |
| Cache tampering / stale cache replay | not applicable | no persistent cache exists; the in-memory state does not outlive its section (tested: tampering between two sections of the same object is caught) |
| Concurrent append / verify | simulated + real process | second writer refused (`EEXIST`) while a section is open; a reader sees only complete verified prefixes; four-process contention passes in section mode |
| Partial write, ENOSPC, EIO at every commit step; fsync, rename, link, read failures | simulated | each passes in both modes; failing append never reported as success; kept state dropped, retry re-verifies |
| `SIGKILL` at every commit step, incl. against the HTTP checkpoint service | real process | acknowledged appends durable, recovery defined, in both modes |
| `EACCES`, `EFBIG` (genuine torn write) | real kernel | pass in both modes |
| Incomplete rotation (kill / fault between witness, seal, rename) | simulated + real process | recovery completes only the exact witnessed file, in both modes |
| Full volume `ENOSPC` | real volume (local, not CI) | see `results/ledger-verification/real-enospc-section.json` |
| Power loss, `fsync` that lies, storage controller faults | **not tested** | not covered |

## 8. Scientific regression

`node scripts/scientific-comparison.ts ... --verify-against results/scientific-cycle/v2-comparison.json` over all
504 cycles (36 chains = 2 caps × 3 seeds × 6 methods), once per storage layout: single file, segmented (131,072 B),
section, segmented + section. Result: section 9. Fingerprints, counts, the 36 chains and every retained
negative result are unchanged and are not re-claimed here.

## 9. Results

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` (default, `verification: 'full'` everywhere) | 303 / 303 pass (290 existing + 13 new) |
| `LEDGER_TEST_VERIFICATION=section npm test` (the same 303 tests with every `Ledger` opened in section mode, including the real `SIGKILL`, `EACCES`, `EFBIG` and four-process tests) | 303 / 303 pass |
| `npm run test:comparison` | 11 / 11 pass |
| `npm run bench` | 57 conformance checks, 0 failed; 14 theory benchmarks: 7 positive, 5 negative, 2 null; 7 meta-boundedness: 2 stable, 5 meta-dependent |
| `npm run check:presets` / `check:api` | 38 presets, 0 failed / 38 presets listed, 0 endpoint checks failed |
| 504-cycle comparison vs retained v2: single file | all 504 fingerprints reproduced exactly |
| ... segmented (131,072 B) | all 504 reproduced exactly |
| ... section | all 504 reproduced exactly |
| ... segmented + section | all 504 reproduced exactly |
| Real full volume (`ENOSPC` from a 3 MB disk image), section mode, single file and rotating | all invariants held; nothing lost, torn file never trusted, recovery after freeing space succeeded |

Between layouts and against retained v2, the only fields that differ in the comparison reports are wall-clock and CPU
timings (non-deterministic); fingerprints, outcomes and counts are identical (`results/ledger-verification/regression.json`).
The wall time of the four comparison runs (54, 48, 48 and 42 s) was not measured under controlled conditions and is not
used as performance evidence.

## 10. Unfinished, and what is not claimed

- Verification per section, per restart and per audit is still O(history). A trusted anchor that avoids reading sealed
  bytes does not exist in this design; none was invented.
- Unrotated ledgers still rewrite the whole file per append.
- Section mode is not the default, and `strict` does not select it. Choosing it accepts the window in section 4.
- `resumeAuthorized` and `physicalRecoveryVerified` remain literal `false`; the resume gate is unchanged and always
  fully verifies.
- Retained negative results are unchanged: history changed the candidate set in 72 of 114 history-using cycles, yet
  history versus no-history performance is identical over 84 runs each; theory: 7 positive / 5 negative / 2 null;
  foreign-history limits; the intervention-quarantine inversion. Nothing here supports a performance advantage of
  history.
- The strong-Xenoscience conditions (external reproduction, independent measurement of real devices, a deployed
  independent immutable checkpoint, physical recovery verification) remain **unestablished**. This is an engineering
  improvement of an ingestion/audit layer.
