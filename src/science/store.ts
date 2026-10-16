// Atomic local records plus a separately retained witness. Never a physical-device transaction.
import { openSync, closeSync, writeFileSync, readFileSync, fsyncSync, renameSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256 } from '../core/hash.ts';
import { externalHead, sameHead } from './checkpoint.ts';
import type { ExternalCheckpointBinding, ExternalHead } from './checkpoint.ts';

export interface LedgerEntry { sequence: number; previous: string; kind: 'prepared' | 'event' | 'completed' | 'quarantined'; operation: string; data: unknown; hash: string }
export interface Checkpoint { count: number; hash: string; digest: string; pending: string }
export class Ledger {
  readonly directory: string;
  readonly checkpointPath: string;
  private writing = false;
  private external: ExternalCheckpointBinding | undefined;
  constructor(directory: string, checkpointPath = `${resolve(directory)}.checkpoint`, external?: ExternalCheckpointBinding) {
    if (external) { externalHead(external); this.external = { ...external }; }
    this.directory = resolve(directory); this.checkpointPath = resolve(checkpointPath);
    if (this.checkpointPath === join(this.directory, 'ledger.json')) throw Error('checkpoint must be separate from ledger');
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    if (!existsSync(this.checkpointPath) && !existsSync(this.path('ledger.json'))) {
      try { const fd = openSync(this.checkpointPath, 'wx', 0o600); try { writeFileSync(fd, JSON.stringify({ count: 0, hash: '', digest: sha256('[]'), pending: '' })); fsyncSync(fd); } finally { closeSync(fd); } }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    }
  }
  private path(name: string) { return join(this.directory, name); }
  private syncDirectory() { const fd = openSync(this.directory, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
  private head(raw: string, entries: LedgerEntry[]): ExternalHead {
    return externalHead(this.external!, entries.length, entries.at(-1)?.hash ?? '', sha256(raw));
  }
  private verifyExternal(raw: string, entries: LedgerEntry[]) {
    if (this.external && !sameHead(this.external.store.read(this.external.historyId, this.external.seriesId), this.head(raw, entries))) throw Error('external checkpoint mismatch; isolate store');
  }
  private advanceExternal(previousRaw: string, previous: LedgerEntry[], raw: string, entries: LedgerEntry[]) {
    if (!this.external) return;
    const next = this.head(raw, entries);
    this.external.store.compareAndSet(this.head(previousRaw, previous), next);
    this.verifyExternal(raw, entries); // An acknowledgement alone does not prove the retained head.
  }
  private decode(raw: string): LedgerEntry[] {
    const entries: LedgerEntry[] = JSON.parse(raw);
    if (!Array.isArray(entries)) throw Error('ledger integrity: expected array');
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
  checkpoint(): Checkpoint {
    if (!existsSync(this.checkpointPath)) throw Error('ledger integrity: missing separate checkpoint; legacy data requires trusted bootstrap');
    const value: Checkpoint = JSON.parse(readFileSync(this.checkpointPath, 'utf8'));
    if (!Number.isInteger(value.count) || value.count < 0 || typeof value.hash !== 'string' || !/^[a-f0-9]{64}$/.test(value.digest) || (value.pending !== '' && !/^\.pending-[a-f0-9-]+$/.test(value.pending))) throw Error('ledger integrity: invalid checkpoint');
    return value;
  }
  verifyCheckpoint(expected: Pick<Checkpoint, 'count' | 'hash'>) {
    const current = this.checkpoint();
    if (current.count !== expected.count || current.hash !== expected.hash) throw Error('ledger integrity: external checkpoint mismatch');
    this.read();
  }
  read(): LedgerEntry[] {
    const raw = existsSync(this.path('ledger.json')) ? readFileSync(this.path('ledger.json'), 'utf8') : '[]';
    const entries = this.decode(raw), checkpoint = this.checkpoint();
    if (checkpoint.count !== entries.length || checkpoint.hash !== (entries.at(-1)?.hash ?? '') || checkpoint.digest !== sha256(raw)) throw Error('ledger integrity: checkpoint mismatch (truncation, rollback or interrupted commit); explicit recovery required');
    this.verifyExternal(raw, entries);
    return entries;
  }
  exclusive<T>(action: () => T): T {
    const lock = openSync(this.path('writer.lock'), 'wx', 0o600);
    try { writeFileSync(lock, JSON.stringify({ pid: process.pid })); fsyncSync(lock); this.writing = true; return action(); }
    finally { this.writing = false; closeSync(lock); unlinkSync(this.path('writer.lock')); }
  }
  recoverDeadWriter(): void {
    // Serialize stale-lock inspection/removal so two recovery attempts cannot remove a new writer's lock.
    const guard = openSync(this.path('recovery.lock'), 'wx', 0o600);
    try {
      if (!existsSync(this.path('writer.lock'))) return;
      const { pid } = JSON.parse(readFileSync(this.path('writer.lock'), 'utf8'));
      if (!Number.isInteger(pid) || pid <= 0) throw Error('invalid writer lock; manual isolation required');
      try { process.kill(pid, 0); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ESRCH') { unlinkSync(this.path('writer.lock')); return; } throw e; }
      throw Error('writer is alive (or PID reused); do not steal its lock');
    } finally { closeSync(guard); unlinkSync(this.path('recovery.lock')); }
  }
  append(kind: LedgerEntry['kind'], operation: string, data: unknown): LedgerEntry {
    if (!this.writing) throw Error('ledger mutation requires exclusive writer');
    const entries = this.read();
    const payload = { sequence: entries.length, previous: entries.at(-1)?.hash ?? '', kind, operation, data };
    const entry = { ...payload, hash: sha256(JSON.stringify(payload)) };
    const raw = JSON.stringify([...entries, entry]); this.decode(raw);
    const pending = `.pending-${randomUUID()}`, temp = this.path(pending);
    const fd = openSync(temp, 'wx', 0o600);
    try { writeFileSync(fd, raw); fsyncSync(fd); } finally { closeSync(fd); }
    this.syncDirectory();
    // Witness first: after a crash it either matches the ledger or identifies the exact durable pending file.
    const witnessTemp = `${this.checkpointPath}.${randomUUID()}.tmp`;
    const witness = openSync(witnessTemp, 'wx', 0o600);
    try { writeFileSync(witness, JSON.stringify({ count: entries.length + 1, hash: entry.hash, digest: sha256(raw), pending })); fsyncSync(witness); } finally { closeSync(witness); }
    renameSync(witnessTemp, this.checkpointPath);
    const parent = openSync(resolve(this.checkpointPath, '..'), 'r'); try { fsyncSync(parent); } finally { closeSync(parent); }
    // Intent is durable before external CAS. A timeout may mean committed: stop, never retry effects.
    this.advanceExternal(existsSync(this.path('ledger.json')) ? readFileSync(this.path('ledger.json'), 'utf8') : '[]', entries, raw, [...entries, entry]);
    renameSync(temp, this.path('ledger.json')); this.syncDirectory();
    return entry;
  }
  // Offline migration only: caller must obtain this exact head from a separately trusted record.
  bootstrapLegacy(expected: Pick<Checkpoint, 'count' | 'hash'>): void {
    this.exclusive(() => {
      if (existsSync(this.checkpointPath)) throw Error('checkpoint already exists');
      const raw = readFileSync(this.path('ledger.json'), 'utf8'), entries = this.decode(raw);
      if (entries.length !== expected.count || (entries.at(-1)?.hash ?? '') !== expected.hash) throw Error('external checkpoint mismatch');
      this.verifyExternal(raw, entries);
      const fd = openSync(this.checkpointPath, 'wx', 0o600);
      try { writeFileSync(fd, JSON.stringify({ ...expected, digest: sha256(raw), pending: '' })); fsyncSync(fd); } finally { closeSync(fd); }
    });
  }
  recover(): LedgerEntry[] {
    return this.exclusive(() => {
      const checkpoint = this.checkpoint();
      try { this.read(); } catch (error) {
        // Never bless a shortened chain. Finish only the exact pre-witnessed pending replacement.
        if (!checkpoint.pending || !existsSync(this.path(checkpoint.pending))) throw error;
        const raw = readFileSync(this.path(checkpoint.pending), 'utf8'), entries = this.decode(raw);
        if (sha256(raw) !== checkpoint.digest || entries.length !== checkpoint.count || entries.at(-1)?.hash !== checkpoint.hash) throw Error('ledger integrity: pending replacement mismatch');
        if (this.external) {
          const current = this.external.store.read(this.external.historyId, this.external.seriesId);
          if (!sameHead(current, this.head(raw, entries))) {
            const previousRaw = existsSync(this.path('ledger.json')) ? readFileSync(this.path('ledger.json'), 'utf8') : '[]';
            const previous = this.decode(previousRaw);
            // Only an exact one-event extension of the externally retained previous head can advance.
            if (entries.length !== previous.length + 1 || JSON.stringify(entries.slice(0, -1)) !== JSON.stringify(previous) || !sameHead(current, this.head(previousRaw, previous))) throw Error('external checkpoint mismatch; isolate store');
            this.advanceExternal(previousRaw, previous, raw, entries);
          }
        }
        renameSync(this.path(checkpoint.pending), this.path('ledger.json')); this.syncDirectory(); this.read();
      }
      const entries = this.read();
      const terminal = new Set(entries.filter((e) => e.kind === 'completed' || e.kind === 'quarantined').map((e) => e.operation));
      for (const entry of entries.filter((e) => e.kind === 'prepared' && !terminal.has(e.operation))) {
        this.append('quarantined', entry.operation, { reason: 'interrupted operation; connection/actuation outcome unknown; never auto-replay', prepared: entry.hash, lastPhase: entries.filter((e) => e.operation === entry.operation && e.kind === 'event').at(-1)?.data ?? null, physicalRecoveryVerified: false });
      }
      return this.read();
    });
  }
}
