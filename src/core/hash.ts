import { createHash } from 'node:crypto';

/** Canonical JSON: sorted keys, functions rendered as their source (code identity is part of a run's identity). */
export function canonical(x: unknown): string {
  if (x === null || x === undefined) return 'null';
  if (typeof x === 'function') return JSON.stringify('fn:' + x.toString());
  if (typeof x === 'number') return Number.isFinite(x) ? JSON.stringify(round(x)) : JSON.stringify(String(x));
  if (typeof x !== 'object') return JSON.stringify(x);
  if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
  const o = x as Record<string, unknown>;
  return '{' + Object.keys(o).sort().filter((k) => o[k] !== undefined)
    .map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
}

function round(n: number): number { return Math.round(n * 1e9) / 1e9; }

export function sha256(s: string): string { return createHash('sha256').update(s).digest('hex'); }
export function hashOf(x: unknown): string { return sha256(canonical(x)); }
