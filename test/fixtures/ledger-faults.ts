// Fault-injecting filesystem for the Ledger, plus an in-memory external checkpoint store. Test support only.
// Every filesystem call the ledger makes is labelled by role, so a fault can be placed at one exact step of the
// commit protocol: pending write/fsync, directory syncs (numbered per append), witness write/fsync/rename,
// the sealed-segment hard link, the final atomic rename, and reads of each file kind.
import { basename } from 'node:path';
import { nodeLedgerFs } from '../../src/science/store.ts';
import type { LedgerFs } from '../../src/science/store.ts';
import { sameHead } from '../../src/science/checkpoint.ts';
import type { ExternalHead, ExternalCheckpointStore } from '../../src/science/checkpoint.ts';
import { sha256 } from '../../src/core/hash.ts';

export interface Fault {
  label: string;
  /** errno code of the injected error (default EIO). */
  code?: string;
  /** For write labels: really write half of the bytes, then fail (a torn write). */
  partial?: boolean;
  /** Kill this process with SIGKILL at the step instead of throwing. */
  kill?: boolean;
  /** Keep failing every later labelled step after the first hit (storage stays broken). */
  persistent?: boolean;
  /** Fire on the n-th occurrence of the label (default 1). */
  nth?: number;
}
/** bytes: everything written; appendBytes/witnessBytes: per append, the pending (active segment) file and the witness. */
export interface FaultControl { armed?: Fault; seen: string[]; bytes: number; appendBytes: number[]; witnessBytes: number[]; fired: number }
export function control(): FaultControl { return { seen: [], bytes: 0, appendBytes: [], witnessBytes: [], fired: 0 }; }
const errno = (code: string) => Object.assign(Error(`${code}: injected storage fault`), { code });

export function faultyFs(c: FaultControl): LedgerFs {
  const roles = new Map<number, string>(); let dirSyncs = 0, matched = 0, broken: Fault | undefined;
  const role = (path: string) => {
    const name = basename(path);
    return name.startsWith('.pending-') ? 'pending' : name.startsWith('segment-') && name.endsWith('.tmp') ? 'segcopy' : name.endsWith('.tmp') ? 'witness' : name.endsWith('.lock') ? 'lock' : name === 'ledger.json' ? 'ledger' : /^segment-/.test(name) ? 'segment' : name.endsWith('.checkpoint') ? 'checkpoint' : 'dir';
  };
  /** Returns the fault to apply to this step, or undefined. Kill faults never return. */
  const hit = (label: string): Fault | undefined => {
    c.seen.push(label);
    if (broken && /^(write|fsync|rename|link):/.test(label)) return broken; // a full or failed disk fails every later write path
    const f = c.armed;
    if (!f || f.label !== label || ++matched < (f.nth ?? 1)) return undefined;
    c.fired++;
    if (f.kill) process.kill(process.pid, 'SIGKILL');
    if (f.persistent) broken = f; else c.armed = undefined;
    return f;
  };
  return {
    ...nodeLedgerFs,
    openSync(path, flags, mode) {
      const r = flags === 'r' ? 'dir' : role(path);
      if (r === 'pending') { dirSyncs = 0; c.appendBytes.push(0); c.witnessBytes.push(0); }
      const fd = nodeLedgerFs.openSync(path, flags, mode); roles.set(fd, r); return fd;
    },
    writeFileSync(fd, data) {
      const r = roles.get(fd) ?? 'dir', fault = hit(`write:${r}`);
      if (fault) {
        if (fault.partial) { const half = data.slice(0, Math.floor(data.length / 2)); nodeLedgerFs.writeFileSync(fd, half); c.bytes += Buffer.byteLength(half); }
        throw errno(fault.code ?? 'EIO');
      }
      nodeLedgerFs.writeFileSync(fd, data);
      const n = Buffer.byteLength(data); c.bytes += n;
      if (r === 'pending') c.appendBytes[c.appendBytes.length - 1] += n;
      if (r === 'witness') c.witnessBytes[c.witnessBytes.length - 1] += n;
    },
    fsyncSync(fd) {
      const r = roles.get(fd) ?? 'dir', fault = hit(r === 'dir' ? `fsync:dir#${++dirSyncs}` : `fsync:${r}`);
      if (fault) throw errno(fault.code ?? 'EIO');
      nodeLedgerFs.fsyncSync(fd);
    },
    renameSync(from, to) { const fault = hit(`rename:${role(from)}`); if (fault) throw errno(fault.code ?? 'EIO'); nodeLedgerFs.renameSync(from, to); },
    linkSync(existing, created) { const fault = hit('link:segment'); if (fault) throw errno(fault.code ?? 'EIO'); nodeLedgerFs.linkSync(existing, created); },
    readFileSync(path) { const fault = hit(`read:${role(path)}`); if (fault) throw errno(fault.code ?? 'EIO'); return nodeLedgerFs.readFileSync(path); },
  };
}

/** In-memory external CAS store with failure injection around the atomic step. */
export function memoryStore(historyId = 'faults', seriesId = 'series') {
  let head: ExternalHead = { version: 1, historyId, seriesId, count: 0, hash: '', digest: sha256('[]') };
  const state = { failBefore: false, failAfter: false, reads: 0, cas: 0 };
  const store: ExternalCheckpointStore = {
    read() { state.reads++; return { ...head }; },
    compareAndSet(expected, next) {
      state.cas++;
      if (state.failBefore) { state.failBefore = false; throw Error('checkpoint service unavailable; outcome unknown'); }
      if (!sameHead(head, expected)) throw Error('checkpoint update conflict');
      head = { ...next };
      if (state.failAfter) { state.failAfter = false; throw Error('checkpoint transport failed; outcome unknown; explicit recovery required'); }
    },
  };
  return { store, binding: { historyId, seriesId, store }, state, head: () => ({ ...head }), set: (h: ExternalHead) => { head = h; } };
}
