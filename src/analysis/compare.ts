// Cross-configuration comparison. Eight levels that are never treated as automatically equivalent:
// same label, same nominal input, same measured difference, same ignition condition,
// same operational transition, same output, same downstream penetration, same reachability change.
import type { Trace } from '../core/trace.ts';
import type { TraceEvent } from '../core/types.ts';
import { penetration, forwardIndex } from '../core/penetration.ts';
import { canonical } from '../core/hash.ts';

export const LEVELS = ['label', 'nominal-input', 'measured-difference', 'ignition-condition', 'operational-transition', 'output', 'downstream-penetration', 'reachability-change'] as const;
export type Level = (typeof LEVELS)[number];

function ruleOf(tr: Trace, id: string) { return tr.initial.rules.find((r) => r.id === id); }
function opOf(tr: Trace, ign: number): TraceEvent | undefined { return tr.events.find((e) => e.kind === 'operation' && e.ignition === ign); }
function effectsOf(tr: Trace, ign: number): TraceEvent[] {
  const op = opOf(tr, ign); if (!op) return [];
  return tr.events.filter((e) => e.kind === 'effect' && (e.cause as number[]).includes(op.seq));
}
function measured(tr: Trace, ign: TraceEvent): string {
  return canonical(Object.entries(ign.inputs ?? {}).filter(([k]) => k.startsWith('o:')).sort());
}
function nextReach(tr: Trace, t: number): unknown {
  const r = tr.events.find((e) => e.kind === 'reachability.probe-relative' && e.t >= t);
  return r ? r.changes.map((c: any) => c.probe + ':' + c.change).sort() : null;
}

export function compareIgnitions(a: Trace, ia: number, b: Trace, ib: number): Record<Level, boolean | null> {
  const A = a.events[ia], B = b.events[ib];
  const ra = ruleOf(a, A.rule), rb = ruleOf(b, B.rule);
  const ea = effectsOf(a, ia), eb = effectsOf(b, ib);
  const pa = ea[0] ? penetration(a, ea[0].seq, { maxDepth: 8 }) : null, pb = eb[0] ? penetration(b, eb[0].seq, { maxDepth: 8 }) : null;
  const pSig = (p: ReturnType<typeof penetration> | null) => (p ? canonical({ r: p.reached, m: p.media, d: p.domains }) : 'none');
  const reachA = nextReach(a, A.t), reachB = nextReach(b, B.t);
  return {
    label: (ra?.label ?? A.rule) === (rb?.label ?? B.rule),
    'nominal-input': canonical([...A.reads].sort()) === canonical([...B.reads].sort()),
    'measured-difference': measured(a, A) === measured(b, B),
    'ignition-condition': !!ra && !!rb && ra.whenHash === rb.whenHash && canonical(A.inputs) === canonical(B.inputs),
    'operational-transition': !!ra && !!rb && ra.thenHash === rb.thenHash && canonical(ea.map((e) => [e.address, round(e.delta)])) === canonical(eb.map((e) => [e.address, round(e.delta)])),
    output: canonical(ea.map((e) => [e.address, round(e.after)])) === canonical(eb.map((e) => [e.address, round(e.after)])),
    'downstream-penetration': pSig(pa) === pSig(pb),
    'reachability-change': reachA === null && reachB === null ? null : canonical(reachA) === canonical(reachB),
  };
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * Run-level comparison: match ignitions by (rule, occurrence) — or by an explicit mapping of rule ids —
 * and report, per level, the fraction of matched ignitions that agree.
 */
export function compareRuns(a: Trace, b: Trace, map?: Record<string, string>, limit = 60): { matched: number; levels: Record<Level, number | null>; examples: { a: number; b: number; levels: Record<Level, boolean | null> }[] } {
  const idx = new Map<string, number>();
  for (const e of b.events) if (e.kind === 'ignition' && !e.suppressed) idx.set(e.rule + '#' + e.occurrence, e.seq);
  const acc: Record<string, { y: number; n: number }> = {};
  const examples: { a: number; b: number; levels: Record<Level, boolean | null> }[] = [];
  let matched = 0;
  for (const e of a.events) {
    if (e.kind !== 'ignition' || e.suppressed) continue;
    const other = idx.get((map?.[e.rule] ?? e.rule) + '#' + e.occurrence);
    if (other === undefined) continue;
    const L = compareIgnitions(a, e.seq, b, other);
    matched++;
    for (const l of LEVELS) { const v = L[l]; if (v === null) continue; const s = (acc[l] ??= { y: 0, n: 0 }); s.n++; if (v) s.y++; }
    if (examples.length < 12) examples.push({ a: e.seq, b: other, levels: L });
    if (matched >= limit) break;
  }
  const levels = Object.fromEntries(LEVELS.map((l) => [l, acc[l] ? acc[l].y / acc[l].n : null])) as Record<Level, number | null>;
  void forwardIndex;
  return { matched, levels, examples };
}
