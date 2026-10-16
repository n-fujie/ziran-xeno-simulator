import { sha256 } from '../core/hash.ts';

/** Stable operator-assigned names must survive process restart and local rollback. */
export interface ExternalHead {
  version: 1; historyId: string; seriesId: string; count: number; hash: string; digest: string;
}
/** Synchronous, bounded adapter for the existing synchronous runtime.
 * Provision the genesis/trusted existing head outside the runtime. Never auto-enrol on read failure.
 * Implementations must authenticate the store and atomically reject stale expected heads.
 * Durability, access control and immutable retention are deployment obligations, not this interface's guarantees.
 */
export interface ExternalCheckpointStore {
  read(historyId: string, seriesId: string): ExternalHead;
  compareAndSet(expected: ExternalHead, next: ExternalHead): void;
}
export interface ExternalCheckpointBinding { historyId: string; seriesId: string; store: ExternalCheckpointStore }
export function externalHead(binding: ExternalCheckpointBinding, count = 0, hash = '', digest = sha256('[]')): ExternalHead {
  for (const id of [binding.historyId, binding.seriesId]) if (!/^[A-Za-z0-9_.-]{1,128}$/.test(id)) throw Error('invalid external checkpoint identity');
  return { version: 1, historyId: binding.historyId, seriesId: binding.seriesId, count, hash, digest };
}
export function sameHead(actual: ExternalHead, expected: ExternalHead): boolean {
  return actual?.version === 1 && actual.historyId === expected.historyId && actual.seriesId === expected.seriesId && actual.count === expected.count && actual.hash === expected.hash && actual.digest === expected.digest;
}
