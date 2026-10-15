// Durable local records, not a transaction with an external instrument.
import { openSync, closeSync, writeFileSync, readFileSync, fsyncSync, renameSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256 } from '../core/hash.ts';

export interface LedgerEntry { sequence: number; previous: string; kind: 'prepared' | 'completed' | 'quarantined'; operation: string; data: unknown; hash: string }
export class Ledger {
  readonly directory: string;
  constructor(directory: string) { this.directory = directory; mkdirSync(directory, { recursive: true, mode: 0o700 }); }
  private path(name: string) { return join(this.directory, name); }
  read(): LedgerEntry[] {
    if (!existsSync(this.path('ledger.json'))) return [];
    const entries: LedgerEntry[] = JSON.parse(readFileSync(this.path('ledger.json'), 'utf8'));
    if (!Array.isArray(entries)) throw Error('ledger integrity: expected array');
    let previous = '';
    for (const [sequence, entry] of entries.entries()) {
      const { hash, ...payload } = entry;
      if (entry.sequence !== sequence || entry.previous !== previous || !['prepared', 'completed', 'quarantined'].includes(entry.kind) || hash !== sha256(JSON.stringify(payload))) throw Error('ledger integrity: invalid chain; preserve and isolate the store');
      previous = hash;
    }
    return entries;
  }
  // Synchronous single-writer transaction. Never steal a lock from a live/unknown owner.
  exclusive<T>(action: () => T): T {
    const lock = openSync(this.path('writer.lock'), 'wx', 0o600);
    try { writeFileSync(lock, JSON.stringify({ pid: process.pid })); fsyncSync(lock); return action(); }
    finally { closeSync(lock); unlinkSync(this.path('writer.lock')); }
  }
  recoverDeadWriter(): void {
    if (!existsSync(this.path('writer.lock'))) return;
    const { pid } = JSON.parse(readFileSync(this.path('writer.lock'), 'utf8'));
    if (!Number.isInteger(pid) || pid <= 0) throw Error('invalid writer lock; manual isolation required');
    try { process.kill(pid, 0); } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ESRCH') { unlinkSync(this.path('writer.lock')); return; }
      throw e;
    }
    throw Error('writer is alive (or PID reused); do not steal its lock');
  }
  append(kind: LedgerEntry['kind'], operation: string, data: unknown): LedgerEntry {
    const entries = this.read();
    const payload = { sequence: entries.length, previous: entries.at(-1)?.hash ?? '', kind, operation, data };
    const entry = { ...payload, hash: sha256(JSON.stringify(payload)) };
    const temp = this.path(`.pending-${randomUUID()}`);
    const fd = openSync(temp, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify([...entries, entry])); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, this.path('ledger.json'));
    const dir = openSync(this.directory, 'r');
    try { fsyncSync(dir); } finally { closeSync(dir); }
    return entry;
  }
  recover(): LedgerEntry[] {
    return this.exclusive(() => {
      const entries = this.read();
      const terminal = new Set(entries.filter((e) => e.kind !== 'prepared').map((e) => e.operation));
      for (const entry of entries.filter((e) => e.kind === 'prepared' && !terminal.has(e.operation))) {
        this.append('quarantined', entry.operation, { reason: 'interrupted operation; actuation outcome unknown; never auto-replay', prepared: entry.hash });
      }
      return this.read();
    });
  }
}
