// Atomic local records plus a separately retained witness. Never a physical-device transaction.
//
// Storage layout. A ledger is a hash-chained JSON array of entries. By default (no `maxSegmentBytes`) it is ONE
// file, `ledger.json`, rewritten atomically on every append: byte-for-byte the format and commit protocol of
// earlier versions. With the opt-in `maxSegmentBytes`, when the active file reaches that size the NEXT append
// first seals it as an immutable `segment-NNNNNN.json` (a hard link to the exact same bytes, never a copy or a
// rewrite) and starts a fresh active `ledger.json` containing only the new entry. The hash chain, global
// sequence numbers and operation state machine run across segments unchanged; the witness records every sealed
// segment's count, tip hash and byte digest. Sealed segments are never modified, moved or deleted by this code.
import { openSync, closeSync, writeFileSync, readFileSync, fsyncSync, renameSync, linkSync, mkdirSync, unlinkSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256 } from '../core/hash.ts';
import { externalHead, sameHead } from './checkpoint.ts';
import type { ExternalCheckpointBinding, ExternalHead } from './checkpoint.ts';

export interface LedgerEntry { sequence: number; previous: string; kind: 'prepared' | 'event' | 'completed' | 'quarantined'; operation: string; data: unknown; hash: string }
/** One immutable, witnessed generation of the chain. `digest` is sha256 of the segment file's exact bytes. */
export interface SealedSegment { file: string; count: number; hash: string; digest: string }
export interface Checkpoint { count: number; hash: string; digest: string; pending: string; sealed?: SealedSegment[]; rotates?: boolean }

/** The only filesystem operations the ledger performs. Injectable so write faults can be reproduced exactly. */
export interface LedgerFs {
  openSync(path: string, flags: string, mode?: number): number;
  closeSync(fd: number): void;
  writeFileSync(fd: number, data: string): void;
  readFileSync(path: string): string;
  fsyncSync(fd: number): void;
  renameSync(from: string, to: string): void;
  linkSync(existing: string, created: string): void;
  unlinkSync(path: string): void;
  mkdirSync(path: string, mode: number): void;
  existsSync(path: string): boolean;
  readdirSync(path: string): string[];
}
export const nodeLedgerFs: LedgerFs = {
  openSync: (path, flags, mode) => openSync(path, flags, mode),
  closeSync: (fd) => closeSync(fd),
  writeFileSync: (fd, data) => writeFileSync(fd, data),
  readFileSync: (path) => readFileSync(path, 'utf8'),
  fsyncSync: (fd) => fsyncSync(fd),
  renameSync: (from, to) => renameSync(from, to),
  linkSync: (existing, created) => linkSync(existing, created),
  unlinkSync: (path) => unlinkSync(path),
  mkdirSync: (path, mode) => { mkdirSync(path, { recursive: true, mode }); },
  existsSync: (path) => existsSync(path),
  readdirSync: (path) => readdirSync(path),
};
export interface LedgerOptions {
  /** Opt-in rotation threshold (512 B .. 1 GiB). Unset (default) keeps one `ledger.json`, exactly as before. */
  maxSegmentBytes?: number;
  fs?: LedgerFs;
}
interface LedgerState { sealed: SealedSegment[]; activeRaw: string; activeCount: number; entries: LedgerEntry[]; digest: string }

const SEGMENT_FILE = /^segment-\d{6,}\.json$/;
/** Errors meaning "this filesystem cannot hard-link" (not transient I/O errors, which must fail the append). */
const LINK_UNSUPPORTED = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS']);
const segmentName = (index: number) => `segment-${String(index).padStart(6, '0')}.json`;

export class Ledger {
  readonly directory: string;
  readonly checkpointPath: string;
  private writing = false;
  private external: ExternalCheckpointBinding | undefined;
  private fs: LedgerFs;
  private maxSegmentBytes: number | undefined;
  constructor(directory: string, checkpointPath = `${resolve(directory)}.checkpoint`, external?: ExternalCheckpointBinding, options: LedgerOptions = {}) {
    if (external) { externalHead(external); this.external = { ...external }; }
    const limit = options.maxSegmentBytes;
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 512 || limit > 2 ** 30)) throw Error('invalid segment size limit');
    this.maxSegmentBytes = limit; this.fs = options.fs ?? nodeLedgerFs;
    this.directory = resolve(directory); this.checkpointPath = resolve(checkpointPath);
    if (this.checkpointPath === join(this.directory, 'ledger.json')) throw Error('checkpoint must be separate from ledger');
    this.fs.mkdirSync(this.directory, 0o700);
    if (!this.fs.existsSync(this.checkpointPath) && !this.fs.existsSync(this.path('ledger.json'))) {
      try { const fd = this.fs.openSync(this.checkpointPath, 'wx', 0o600); try { this.fs.writeFileSync(fd, JSON.stringify({ count: 0, hash: '', digest: sha256('[]'), pending: '' })); this.fs.fsyncSync(fd); } finally { this.fs.closeSync(fd); } }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    }
  }
  /** True only when an external checkpoint binding was supplied; says nothing about that store's independence. */
  get externalWitnessed(): boolean { return this.external !== undefined; }
  /** Whether rotation is enabled for this instance (a property of the opener, not stored in the history). */
  get segmentLimit(): number | undefined { return this.maxSegmentBytes; }
  private path(name: string) { return join(this.directory, name); }
  private syncDirectory(dir = this.directory) { const fd = this.fs.openSync(dir, 'r'); try { this.fs.fsyncSync(fd); } finally { this.fs.closeSync(fd); } }
  private stateDigest(sealed: SealedSegment[], activeRaw: string): string {
    // One sealed generation or none: with no sealed segments this is exactly the historic whole-file digest.
    return sealed.length === 0 ? sha256(activeRaw) : sha256(JSON.stringify({ sealed: sealed.map(({ file, count, hash, digest }) => ({ file, count, hash, digest })), active: sha256(activeRaw) }));
  }
  private head(state: LedgerState): ExternalHead {
    return externalHead(this.external!, state.entries.length, state.entries.at(-1)?.hash ?? '', state.digest);
  }
  private verifyExternal(state: LedgerState) {
    if (this.external && !sameHead(this.external.store.read(this.external.historyId, this.external.seriesId), this.head(state))) throw Error('external checkpoint mismatch; isolate store');
  }
  private advanceExternal(previous: LedgerState, next: LedgerState) {
    if (!this.external) return;
    this.external.store.compareAndSet(this.head(previous), this.head(next));
    this.verifyExternal(next); // An acknowledgement alone does not prove the retained head.
  }
  private parse(raw: string): LedgerEntry[] {
    const entries: LedgerEntry[] = JSON.parse(raw);
    if (!Array.isArray(entries)) throw Error('ledger integrity: expected array');
    return entries;
  }
  private validate(entries: LedgerEntry[]): LedgerEntry[] {
    let previous = ''; const operations = new Map<string, boolean>();
    for (const [sequence, entry] of entries.entries()) {
      const { hash, ...payload } = entry;
      if (entry.sequence !== sequence || entry.previous !== previous || !['prepared', 'event', 'completed', 'quarantined'].includes(entry.kind) || hash !== sha256(JSON.stringify(payload))) throw Error('ledger integrity: invalid chain');
      if (entry.kind === 'prepared') { if (operations.has(entry.operation)) throw Error('ledger integrity: duplicate operation'); operations.set(entry.operation, false); }
      else { if (!operations.has(entry.operation) || operations.get(entry.operation)) throw Error('ledger integrity: event outside active operation'); if (entry.kind !== 'event') operations.set(entry.operation, true); }
      previous = hash;
    }
    return entries;
  }
  /** Read and verify sealed segments (exact bytes, count, tip) plus the active file, then the whole chain.
   * `unlinkedLast` supplies the bytes of a segment whose hard link has not been created yet (recovery only). */
  private loadState(sealed: SealedSegment[], activeRaw: string, unlinkedLast?: string): LedgerState {
    const all: LedgerEntry[] = [];
    for (const [index, segment] of sealed.entries()) {
      const target = this.path(segment.file);
      const raw = this.fs.existsSync(target) ? this.fs.readFileSync(target) : index === sealed.length - 1 && unlinkedLast !== undefined ? unlinkedLast : undefined;
      if (raw === undefined) throw Error('ledger integrity: sealed segment missing');
      const entries = this.parse(raw);
      if (sha256(raw) !== segment.digest || entries.length !== segment.count || entries.at(-1)?.hash !== segment.hash) throw Error('ledger integrity: sealed segment mismatch');
      all.push(...entries);
    }
    const active = this.parse(activeRaw);
    all.push(...active);
    this.validate(all);
    return { sealed, activeRaw, activeCount: active.length, entries: all, digest: this.stateDigest(sealed, activeRaw) };
  }
  private activeRaw(): string { return this.fs.existsSync(this.path('ledger.json')) ? this.fs.readFileSync(this.path('ledger.json')) : '[]'; }
  checkpoint(): Checkpoint {
    if (!this.fs.existsSync(this.checkpointPath)) throw Error('ledger integrity: missing separate checkpoint; legacy data requires trusted bootstrap');
    const value: Checkpoint = JSON.parse(this.fs.readFileSync(this.checkpointPath));
    const sealedOk = value.sealed === undefined || (Array.isArray(value.sealed) && value.sealed.every((s) => s && SEGMENT_FILE.test(s.file) && Number.isInteger(s.count) && s.count > 0 && /^[a-f0-9]{64}$/.test(s.hash) && /^[a-f0-9]{64}$/.test(s.digest)));
    if (!Number.isInteger(value.count) || value.count < 0 || typeof value.hash !== 'string' || !/^[a-f0-9]{64}$/.test(value.digest) || (value.pending !== '' && !/^\.pending-[a-f0-9-]+$/.test(value.pending)) || !sealedOk || (value.rotates !== undefined && typeof value.rotates !== 'boolean')) throw Error('ledger integrity: invalid checkpoint');
    return value;
  }
  verifyCheckpoint(expected: Pick<Checkpoint, 'count' | 'hash'>) {
    const current = this.checkpoint();
    if (current.count !== expected.count || current.hash !== expected.hash) throw Error('ledger integrity: external checkpoint mismatch');
    this.read();
  }
  /** A rotating commit that stopped after its witness became durable: the witness names the next layout and the
   * witnessed pending file still exists. Used only to give a precise diagnostic; recovery re-verifies everything. */
  private rotationCommitInterrupted(): boolean {
    try { const cp = this.checkpoint(); return cp.rotates === true && cp.pending !== '' && this.fs.existsSync(this.path(cp.pending)); } catch { return false; }
  }
  private load(): LedgerState {
    const raw = this.activeRaw();
    let sealed: SealedSegment[] = [];
    if (this.fs.existsSync(this.checkpointPath)) {
      // Only a malformed witness is deferred to the checkpoint() call below (keeps the historic error order);
      // storage errors (EIO and the like) are real failures and must propagate.
      try { sealed = this.checkpoint().sealed ?? []; } catch (e) { if (!(e instanceof SyntaxError) && !String((e as Error).message).startsWith('ledger integrity')) throw e; }
    }
    let state: LedgerState;
    try { state = this.loadState(sealed, raw); } catch (error) {
      if (this.rotationCommitInterrupted()) throw Error('ledger integrity: checkpoint mismatch (truncation, rollback or interrupted commit); explicit recovery required');
      throw error;
    }
    const checkpoint = this.checkpoint();
    if (checkpoint.count !== state.entries.length || checkpoint.hash !== (state.entries.at(-1)?.hash ?? '') || checkpoint.digest !== state.digest) throw Error('ledger integrity: checkpoint mismatch (truncation, rollback or interrupted commit); explicit recovery required');
    this.verifyExternal(state);
    return state;
  }
  read(): LedgerEntry[] { return this.load().entries; }
  /** Facts about the current layout for audits; verifies like read(). */
  layout(): { sealed: SealedSegment[]; activeEntries: number; activeBytes: number; sealedBytes: number; unreferencedSegments: string[] } {
    const state = this.load();
    const referenced = new Set(state.sealed.map((s) => s.file));
    return {
      sealed: state.sealed.map((s) => ({ ...s })), activeEntries: state.activeCount, activeBytes: Buffer.byteLength(state.activeRaw),
      sealedBytes: state.sealed.reduce((sum, s) => sum + Buffer.byteLength(this.fs.readFileSync(this.path(s.file))), 0),
      unreferencedSegments: this.fs.readdirSync(this.directory).filter((f) => SEGMENT_FILE.test(f) && !referenced.has(f)).sort(),
    };
  }
  exclusive<T>(action: () => T): T {
    const lock = this.fs.openSync(this.path('writer.lock'), 'wx', 0o600);
    try { this.fs.writeFileSync(lock, JSON.stringify({ pid: process.pid })); this.fs.fsyncSync(lock); this.writing = true; return action(); }
    finally { this.writing = false; this.fs.closeSync(lock); this.fs.unlinkSync(this.path('writer.lock')); }
  }
  recoverDeadWriter(): void {
    // Serialize stale-lock inspection/removal so two recovery attempts cannot remove a new writer's lock.
    const guard = this.fs.openSync(this.path('recovery.lock'), 'wx', 0o600);
    try {
      if (!this.fs.existsSync(this.path('writer.lock'))) return;
      const { pid } = JSON.parse(this.fs.readFileSync(this.path('writer.lock')));
      if (!Number.isInteger(pid) || pid <= 0) throw Error('invalid writer lock; manual isolation required');
      try { process.kill(pid, 0); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ESRCH') { this.fs.unlinkSync(this.path('writer.lock')); return; } throw e; }
      throw Error('writer is alive (or PID reused); do not steal its lock');
    } finally { this.fs.closeSync(guard); this.fs.unlinkSync(this.path('recovery.lock')); }
  }
  /** Seal the current active file as an immutable segment: a hard link to the exact same bytes, or, only where the
   * filesystem cannot hard-link, an atomic byte-for-byte copy. Idempotent only if an existing target is byte-identical,
   * and refuses to seal a file that is not exactly the one the witness describes. */
  private seal(segment: SealedSegment) {
    const target = this.path(segment.file);
    if (this.fs.existsSync(target)) { if (sha256(this.fs.readFileSync(target)) !== segment.digest) throw Error('ledger integrity: sealed segment conflict'); return; }
    const bytes = this.fs.readFileSync(this.path('ledger.json'));
    if (sha256(bytes) !== segment.digest) throw Error('ledger integrity: sealed segment conflict');
    try { this.fs.linkSync(this.path('ledger.json'), target); }
    catch (e) {
      if (!LINK_UNSUPPORTED.has((e as NodeJS.ErrnoException).code ?? '')) throw e;
      const temp = `${target}.${randomUUID()}.tmp`, fd = this.fs.openSync(temp, 'wx', 0o600);
      try { this.fs.writeFileSync(fd, bytes); this.fs.fsyncSync(fd); } finally { this.fs.closeSync(fd); }
      this.fs.renameSync(temp, target);
    }
    this.syncDirectory();
  }
  append(kind: LedgerEntry['kind'], operation: string, data: unknown): LedgerEntry {
    if (!this.writing) throw Error('ledger mutation requires exclusive writer');
    const state = this.load(), entries = state.entries;
    const payload = { sequence: entries.length, previous: entries.at(-1)?.hash ?? '', kind, operation, data };
    const entry = { ...payload, hash: sha256(JSON.stringify(payload)) };
    const all = [...entries, entry]; this.validate(all);
    // Rotation is decided from the verified active file before this entry is added; it never splits an entry.
    const rotate = this.maxSegmentBytes !== undefined && state.activeCount > 0 && Buffer.byteLength(state.activeRaw) >= this.maxSegmentBytes;
    const sealed = rotate ? [...state.sealed, { file: segmentName(state.sealed.length + 1), count: state.activeCount, hash: entries.at(-1)!.hash, digest: sha256(state.activeRaw) }] : state.sealed;
    const active = rotate ? [entry] : [...entries.slice(entries.length - state.activeCount), entry];
    const raw = JSON.stringify(active);
    const next: LedgerState = { sealed, activeRaw: raw, activeCount: active.length, entries: all, digest: this.stateDigest(sealed, raw) };
    const pending = `.pending-${randomUUID()}`, temp = this.path(pending);
    const fd = this.fs.openSync(temp, 'wx', 0o600);
    try { this.fs.writeFileSync(fd, raw); this.fs.fsyncSync(fd); } finally { this.fs.closeSync(fd); }
    this.syncDirectory();
    // Witness first: after a crash it either matches the ledger or identifies the exact durable pending file.
    const witnessTemp = `${this.checkpointPath}.${randomUUID()}.tmp`;
    const witness = this.fs.openSync(witnessTemp, 'wx', 0o600);
    try { this.fs.writeFileSync(witness, JSON.stringify({ count: all.length, hash: entry.hash, digest: next.digest, pending, ...(sealed.length ? { sealed } : {}), ...(rotate ? { rotates: true } : {}) })); this.fs.fsyncSync(witness); } finally { this.fs.closeSync(witness); }
    this.fs.renameSync(witnessTemp, this.checkpointPath);
    this.syncDirectory(resolve(this.checkpointPath, '..'));
    // Intent is durable before external CAS. A timeout may mean committed: stop, never retry effects.
    this.advanceExternal(state, next);
    if (rotate) this.seal(sealed.at(-1)!);
    this.fs.renameSync(temp, this.path('ledger.json')); this.syncDirectory();
    return entry;
  }
  // Offline migration only: caller must obtain this exact head from a separately trusted record.
  bootstrapLegacy(expected: Pick<Checkpoint, 'count' | 'hash'>): void {
    this.exclusive(() => {
      if (this.fs.existsSync(this.checkpointPath)) throw Error('checkpoint already exists');
      const state = this.loadState([], this.fs.readFileSync(this.path('ledger.json')));
      if (state.entries.length !== expected.count || (state.entries.at(-1)?.hash ?? '') !== expected.hash) throw Error('external checkpoint mismatch');
      this.verifyExternal(state);
      const fd = this.fs.openSync(this.checkpointPath, 'wx', 0o600);
      try { this.fs.writeFileSync(fd, JSON.stringify({ ...expected, digest: state.digest, pending: '' })); this.fs.fsyncSync(fd); } finally { this.fs.closeSync(fd); }
    });
  }
  recover(): LedgerEntry[] {
    return this.exclusive(() => {
      const checkpoint = this.checkpoint();
      try { this.read(); } catch (error) {
        // Never bless a shortened chain. Finish only the exact pre-witnessed pending replacement.
        if (!checkpoint.pending || !this.fs.existsSync(this.path(checkpoint.pending))) throw error;
        const raw = this.fs.readFileSync(this.path(checkpoint.pending));
        const target = this.sealedTarget(checkpoint, raw);
        if (target.digest !== checkpoint.digest || target.entries.length !== checkpoint.count || target.entries.at(-1)?.hash !== checkpoint.hash) throw Error('ledger integrity: pending replacement mismatch');
        if (this.external) {
          const current = this.external.store.read(this.external.historyId, this.external.seriesId);
          if (!sameHead(current, this.head(target))) {
            const sealedBefore = checkpoint.rotates ? (checkpoint.sealed ?? []).slice(0, -1) : (checkpoint.sealed ?? []);
            const previous = this.loadState(sealedBefore, this.activeRaw());
            // Only an exact one-event extension of the externally retained previous head can advance.
            if (target.entries.length !== previous.entries.length + 1 || JSON.stringify(target.entries.slice(0, -1)) !== JSON.stringify(previous.entries) || !sameHead(current, this.head(previous))) throw Error('external checkpoint mismatch; isolate store');
            this.advanceExternal(previous, target);
          }
        }
        if (checkpoint.rotates) this.seal((checkpoint.sealed ?? []).at(-1)!);
        this.fs.renameSync(this.path(checkpoint.pending), this.path('ledger.json')); this.syncDirectory(); this.read();
      }
      const entries = this.read();
      const terminal = new Set(entries.filter((e) => e.kind === 'completed' || e.kind === 'quarantined').map((e) => e.operation));
      for (const entry of entries.filter((e) => e.kind === 'prepared' && !terminal.has(e.operation))) {
        this.append('quarantined', entry.operation, { reason: 'interrupted operation; connection/actuation outcome unknown; never auto-replay', prepared: entry.hash, lastPhase: entries.filter((e) => e.operation === entry.operation && e.kind === 'event').at(-1)?.data ?? null, physicalRecoveryVerified: false });
      }
      const final = this.read();
      this.removeStrays();
      return final;
    });
  }
  /** The state a witnessed pending file would produce: its sealed list, with the bytes of the segment being
   * sealed taken from the still-current ledger.json when that segment's hard link has not been created yet. */
  private sealedTarget(checkpoint: Checkpoint, pendingRaw: string): LedgerState {
    return this.loadState(checkpoint.sealed ?? [], pendingRaw, checkpoint.rotates ? this.activeRaw() : undefined);
  }
  /** Remove only files that can never be history: abandoned pending replacements and witness temporaries. Runs
   * after a full successful verification, so nothing it removes is referenced by the verified state. */
  private removeStrays() {
    const referenced = this.checkpoint().pending;
    for (const name of this.fs.readdirSync(this.directory)) if (/^\.pending-[a-f0-9-]+$/.test(name) && name !== referenced) this.fs.unlinkSync(this.path(name));
    for (const name of this.fs.readdirSync(this.directory)) if (/^segment-\d{6,}\.json\.[a-f0-9-]+\.tmp$/.test(name)) this.fs.unlinkSync(this.path(name));
    const parent = dirname(this.checkpointPath), prefix = `${basename(this.checkpointPath)}.`;
    for (const name of this.fs.readdirSync(parent)) if (name.startsWith(prefix) && name.endsWith('.tmp')) this.fs.unlinkSync(join(parent, name));
  }
}
