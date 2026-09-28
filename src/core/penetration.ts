// Real penetration: how a local difference propagates, transforms, splits, is lost, reappears
// and crosses media, scales, clocks and address domains. A penetrating difference is NOT
// assumed to stay identical: every hop records its transformation ratio.
import type { TraceEvent } from './types.ts';
import type { Trace } from './trace.ts';

export interface Hop {
  seq: number; t: number; kind: string; address?: string; via?: string; medium?: string; scale?: string; clock?: string;
  domain?: string; depth: number; parent: number; ratio?: number; delay: number;
}

export interface PenetrationReport {
  origin: number;
  hops: Hop[];
  reached: string[];
  media: string[]; scales: string[]; domains: string[]; clocks: string[];
  crossMedium: number; crossScale: number; crossDomain: number; crossClock: number;
  amplified: number; attenuated: number; transformed: number; losses: { seq: number; why: string }[];
  branching: number; closures: number; reappearances: string[]; maxDelay: number; ignitionsTriggered: number;
  reorganizations: number; feedbacks: number;
}

export function forwardIndex(events: TraceEvent[]): Map<number, number[]> {
  const fwd = new Map<number, number[]>();
  for (const e of events) for (const c of (e.cause as number[] | undefined) ?? []) (fwd.get(c) ?? fwd.set(c, []).get(c)!).push(e.seq);
  return fwd;
}

const domainOf = (a?: string) => (a ? a.split('/')[0] : undefined);

export function penetration(tr: Trace, origin: number, opts: { maxDepth?: number; maxNodes?: number; fwd?: Map<number, number[]> } = {}): PenetrationReport {
  const ev = tr.events;
  const fwd = opts.fwd ?? forwardIndex(ev);
  const meta = (tr.initial.addresses ?? {}) as Record<string, { medium?: string; scale?: string }>;
  const ruleClock: Record<string, string> = Object.fromEntries(tr.initial.rules.map((r) => [r.id, r.clock]));
  const maxDepth = opts.maxDepth ?? 40, maxNodes = opts.maxNodes ?? 4000;
  const hops: Hop[] = [];
  const seen = new Set<number>([origin]);
  const q: { s: number; d: number; p: number }[] = [{ s: origin, d: 0, p: -1 }];
  const lastAddrEffect = new Map<string, number>();
  const rep = {
    losses: [] as { seq: number; why: string }[], cm: 0, cs: 0, cd: 0, cc: 0, amp: 0, att: 0, tf: 0, branch: 0, close: 0, reap: new Set<string>(), maxDelay: 0,
    ign: 0, reorg: 0, fb: 0,
  };
  const o = ev[origin];
  while (q.length && hops.length < maxNodes) {
    const { s, d, p } = q.shift()!;
    const e = ev[s]; if (!e) continue;
    const addr = e.address as string | undefined;
    const pe = p >= 0 ? ev[p] : undefined;
    const rid: string | undefined = e.rule ?? (typeof e.via === 'string' && e.via.startsWith('rule:') ? e.via.slice(5) : undefined);
    const clock = e.kind === 'ignition' ? e.clock : rid ? ruleClock[rid] : undefined;
    const h: Hop = {
      seq: s, t: e.t, kind: e.kind, address: addr, via: e.via, medium: e.medium ?? (addr ? meta[addr]?.medium : undefined),
      scale: addr ? meta[addr]?.scale : undefined, clock, domain: domainOf(addr), depth: d, parent: p, delay: e.t - o.t,
    };
    if (e.kind === 'effect' && pe) {
      const src = findAncestorEffect(ev, p);
      if (src && Math.abs(src.delta) > 0) {
        h.ratio = e.delta / src.delta;
        if (Math.abs(h.ratio) > 1 + 1e-9) rep.amp++; else if (Math.abs(h.ratio) < 1 - 1e-9) rep.att++;
        if (Math.abs(h.ratio - 1) > 1e-9) rep.tf++;
        const srcMedium = src.medium ?? meta[src.address]?.medium; if (h.medium && srcMedium && h.medium !== srcMedium) rep.cm++;
        const srcScale = meta[src.address]?.scale; if (h.scale && srcScale && h.scale !== srcScale) rep.cs++;
        if (h.domain && domainOf(src.address) !== h.domain) rep.cd++;
      }
      if (addr) { if (lastAddrEffect.has(addr) && d - lastAddrEffect.get(addr)! > 1) rep.reap.add(addr); lastAddrEffect.set(addr, d); }
    }
    if (e.kind === 'ignition') { rep.ign++; const pc = pe?.kind === 'ignition' ? pe.clock : undefined; if (pc && pc !== e.clock) rep.cc++; }
    if (e.kind === 'reorganization') rep.reorg++;
    if (e.kind === 'feedback') rep.fb++;
    if (e.kind === 'loss') rep.losses.push({ seq: s, why: e.why });
    rep.maxDelay = Math.max(rep.maxDelay, h.delay);
    hops.push(h);
    const kids = (fwd.get(s) ?? []).filter((k) => !seen.has(k));
    const effKids = kids.filter((k) => ev[k].kind === 'effect' || ev[k].kind === 'ignition' || ev[k].kind === 'operation');
    if (effKids.length > 1) rep.branch++;
    if (!kids.length && e.kind === 'effect') rep.close++;
    if (d >= maxDepth) continue;
    for (const k of kids) { seen.add(k); q.push({ s: k, d: d + 1, p: s }); }
  }
  // clock crossing via operations
  const clocksSeen = new Set(hops.map((h) => h.clock).filter(Boolean) as string[]);
  const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter(Boolean) as string[])].sort();
  return {
    origin, hops,
    reached: uniq(hops.filter((h) => h.kind === 'effect').map((h) => h.address)),
    media: uniq(hops.map((h) => h.medium)), scales: uniq(hops.map((h) => h.scale)), domains: uniq(hops.map((h) => h.domain)), clocks: [...clocksSeen].sort(),
    crossMedium: rep.cm, crossScale: rep.cs, crossDomain: rep.cd, crossClock: Math.max(rep.cc, clocksSeen.size - 1),
    amplified: rep.amp, attenuated: rep.att, transformed: rep.tf, losses: rep.losses, branching: rep.branch, closures: rep.close,
    reappearances: [...rep.reap].sort(), maxDelay: rep.maxDelay, ignitionsTriggered: rep.ign, reorganizations: rep.reorg, feedbacks: rep.fb,
  };
}

function findAncestorEffect(ev: TraceEvent[], s: number): TraceEvent | undefined {
  let cur: TraceEvent | undefined = ev[s];
  for (let i = 0; i < 6 && cur; i++) {
    if (cur.kind === 'effect') return cur;
    const c = cur.cause as number[] | undefined;
    cur = c && c.length ? ev[c[c.length - 1]] : undefined;
  }
  return undefined;
}
