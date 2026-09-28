// Deterministic, cloneable PRNG (splitmix32 seeding + mulberry32 stream).
export interface RngState { s: number }

export function seedStream(seed: number, stream: number): RngState {
  let z = (seed ^ Math.imul(stream + 1, 0x9e3779b9)) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
  return { s: (z ^ (z >>> 16)) >>> 0 };
}

export function next(r: RngState): number {
  r.s = (r.s + 0x6d2b79f5) >>> 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function gauss(r: RngState): number {
  const u = Math.max(next(r), 1e-12);
  const v = next(r);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
