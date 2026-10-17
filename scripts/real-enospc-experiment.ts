// REAL full-volume experiment (not part of CI): run the ledger on a genuinely tiny volume until the operating system
// returns ENOSPC, then check what survives. Usage: node scripts/real-enospc-experiment.ts <directory-on-a-small-volume>
// macOS example (no privileges needed):
//   hdiutil create -size 3m -fs "HFS+" -volname ZXSFULL probe.dmg && hdiutil attach probe.dmg -nobrowse -mountpoint /tmp/zxs-full
//   node scripts/real-enospc-experiment.ts /tmp/zxs-full
// Prints one JSON object and exits non-zero if an invariant fails. Observations, not assumptions, are reported.
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ledger } from '../src/science/store.ts';

const base = process.argv[2];
if (!base) throw Error('usage: node scripts/real-enospc-experiment.ts <directory-on-a-small-volume>');
// LEDGER_VERIFICATION=section runs the same experiment with the opt-in section-scoped verification.
const verification = process.env.LEDGER_VERIFICATION === 'section' ? 'section' as const : 'full' as const;
const pad = (n: number) => 'x'.repeat(n);
const results: Record<string, unknown>[] = [];
let failed = false;
for (const [label, limit] of [['single-file', undefined], ['rotating-200KiB', 200_000]] as const) {
  const root = join(base, `exp-${label}`); rmSync(root, { recursive: true, force: true }); mkdirSync(root, { recursive: true });
  const dir = join(root, 'ledger');
  const ballast = join(root, 'ballast.bin'); writeFileSync(ballast, Buffer.alloc(500_000)); // freed later to give recovery some headroom
  const open = () => new Ledger(dir, undefined, undefined, { ...(limit === undefined ? {} : { maxSegmentBytes: limit }), verification });
  const ledger = open();
  let acked = 0, code: string | undefined;
  try { for (let i = 0; i < 1000; i++) ledger.exclusive(() => { ledger.append('prepared', `fill-${i}`, { pad: pad(60_000) }); acked++; ledger.append('completed', `fill-${i}`, { ok: i }); acked++; }); }
  catch (e) { code = (e as NodeJS.ErrnoException).code; }
  const torn = readdirSync(dir).filter((f) => f.startsWith('.pending-')).map((f) => statSync(join(dir, f)).size);
  const reopened = open();
  let visible = -1, integrityAfterFailure = 'verified';
  try { visible = reopened.read().length; } catch (e) { integrityAfterFailure = String((e as Error).message); }
  // 1. Recovery while the volume is still full: it may be unable to run at all (it needs a few bytes for its lock).
  const attemptRecovery = () => { try { const l = open(); l.recoverDeadWriter(); l.recover(); return 'ok'; } catch (e) { return `failed (${(e as NodeJS.ErrnoException).code ?? 'error'})`; } };
  const recoveryWhileFull = attemptRecovery();
  const strayWhileFull = readdirSync(dir).filter((f) => f.startsWith('.pending-')).length;
  // 2. The operator frees space, then recovery must succeed and leave nothing abandoned behind.
  rmSync(ballast);
  const recoveryAfterFree = attemptRecovery();
  const strays = readdirSync(dir).filter((f) => f.startsWith('.pending-')).length;
  // 3. A small append afterwards: a single-file ledger needs as much free space as its whole size; a rotating one only its active segment.
  let appendAfter: string; let layout: ReturnType<Ledger['layout']> | undefined;
  try { const l = open(); l.exclusive(() => l.append('prepared', 'after-full-disk', { ok: true })); appendAfter = 'succeeded'; } catch (e) { appendAfter = `failed (${(e as NodeJS.ErrnoException).code ?? 'error'})`; }
  try { layout = open().layout(); } catch { /* reported through integrity below */ }
  const finalIntegrity = (() => { try { open().read(); return 'verified'; } catch (e) { return String((e as Error).message); } })();
  const ok = code === 'ENOSPC' && integrityAfterFailure === 'verified' && visible >= acked && visible <= acked + 1 && recoveryAfterFree === 'ok' && strays === 0 && finalIntegrity === 'verified';
  if (!ok) failed = true;
  results.push({ layout: label, kernelError: code, acknowledgedAppends: acked, visibleAfterFailure: visible, integrityAfterFailure, tornPendingFilesLeft: torn, recoveryWhileVolumeFull: recoveryWhileFull, strayPendingWhileFull: strayWhileFull, recoveryAfterSpaceFreed: recoveryAfterFree, strayPendingAfterRecovery: strays, appendAfterSpaceFreed: appendAfter, sealedSegments: layout?.sealed.length ?? null, finalIntegrity, invariantsHeld: ok });
}
console.log(JSON.stringify({ volume: 'real small volume; ENOSPC returned by the operating system', experiments: results }, null, 2));
if (failed) process.exitCode = 1;
