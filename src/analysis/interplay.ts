// Simultaneous operational organizations (bundles): competition, cooperation, suppression, lock-in,
// sensor redistribution, path change and resource redistribution. Nothing assumes one organization
// = one controller; bundles are just groups of rules identified by id prefix or tag.
import type { Trace } from '../core/trace.ts';
import { sc } from '../core/values.ts';

export function bundleOf(tr: Trace, rule: string, key: 'prefix' | 'tag' = 'prefix'): string {
  if (key === 'tag') return tr.initial.rules.find((r) => r.id === rule)?.tags?.[0] ?? rule.split('.')[0];
  return rule.split('.')[0];
}

export function interplay(tr: Trace, windows = 6) {
  const B = (r: string) => bundleOf(tr, r);
  const pair = (a: string, b: string) => [a, b].sort().join(' ↔ ');
  const comp: Record<string, number> = {}, coop: Record<string, number> = {}, supp: Record<string, number> = {};
  for (const [, x] of (tr.interactions as { rules: string[]; mode: string; count: number }[]).entries()) {
    const bs = [...new Set(x.rules.map(B))]; if (bs.length < 2) continue;
    const k = pair(bs[0], bs[1]);
    if (x.mode === 'cooperation') coop[k] = (coop[k] ?? 0) + x.count; else comp[k] = (comp[k] ?? 0) + x.count;
  }
  for (const e of tr.events) if (e.kind === 'suppression') for (const by of e.by as string[]) {
    if (!by.startsWith('rule:')) continue;
    const k = B(by.slice(5)) + ' ⊣ ' + B(e.rule); supp[k] = (supp[k] ?? 0) + 1;
  }
  const H = tr.meta.horizon, w = H / windows;
  const share: { t0: number; shares: Record<string, number> }[] = [];
  const bundles = [...new Set(tr.initial.rules.map((r) => B(r.id)))].sort();
  for (let i = 0; i < windows; i++) {
    const c: Record<string, number> = Object.fromEntries(bundles.map((b) => [b, 0])); let tot = 0;
    for (const e of tr.events) if (e.kind === 'ignition' && !e.suppressed && e.t >= i * w && e.t < (i + 1) * w) { c[B(e.rule)]++; tot++; }
    share.push({ t0: i * w, shares: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, tot ? v / tot : 0])) });
  }
  const last = share.slice(-2);
  const lockIn = bundles.filter((b) => last.every((s) => s.shares[b] > 0.7));
  const silenced = bundles.filter((b) => share[0].shares[b] > 0.05 && last.every((s) => s.shares[b] === 0));
  const sensor = tr.events.filter((e) => e.kind === 'reorganization' && e.target === 'apparatus').map((e) => ({ t: e.t, op: e.op, key: e.key, via: e.via }));
  return { bundles, competition: comp, cooperation: coop, suppression: supp, share, lockIn, silenced, sensorRedistribution: sensor };
}

/** Path of a set of addresses over time (movement path) and resource redistribution between two traces. */
export function pathAndResources(a: Trace, b: Trace, pathAddrs: string[], resourcePrefixes: string[]) {
  const path = (tr: Trace) => { const st = { ...tr.initial.state }; const p: number[][] = []; for (const e of tr.events) if (e.kind === 'effect') { st[e.address] = e.after; if (pathAddrs.includes(e.address)) p.push(pathAddrs.map((x) => sc(st[x]))); } return p; };
  const pa = path(a), pb = path(b);
  const n = Math.min(pa.length, pb.length);
  let dev = 0; for (let i = 0; i < n; i++) dev += Math.hypot(...pa[i].map((x, j) => x - pb[i][j]));
  const res = (tr: Trace) => Object.fromEntries(resourcePrefixes.map((p) => [p, Object.entries(tr.final.state).filter(([k]) => k.startsWith(p)).reduce((s, [, v]) => s + sc(v), 0)]));
  return { pathDeviation: n ? dev / n : 0, resourcesA: res(a), resourcesB: res(b) };
}
