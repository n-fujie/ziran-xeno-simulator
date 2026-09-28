// Ziran System building blocks: heterogeneous local processes that conditionally ignite, stop,
// reconnect and revise one another. Each block is an ordinary rule over core positions; nothing here
// assumes its own permanent necessity (compatible with future MO / DO / ZCA / MS / ΩⅨ / R-A / HDA
// modules, which would be further rule bundles).
import type { Ctx, RuleSpec, Address } from '../core/types.ts';

/** Conditionally start/stop a set of processes (rules). */
export function conditionalProcess(o: { id: string; clock: string; targets: string[]; start: (c: Ctx) => boolean; stop: (c: Ctx) => boolean }): RuleSpec[] {
  return [
    { id: `${o.id}.start`, clock: o.clock, tags: ['ziran', 'control'], when: (c) => o.start(c) && o.targets.some((t) => !c.ruleEnabled(t)), then: (_c, e) => o.targets.forEach((t) => e.rule.enable(t)) },
    { id: `${o.id}.stop`, clock: o.clock, tags: ['ziran', 'control'], when: (c) => o.stop(c) && o.targets.some((t) => c.ruleEnabled(t)), then: (_c, e) => o.targets.forEach((t) => e.rule.disable(t)) },
  ];
}

/** Historical difference reinsertion: re-inject the difference an address had `lag` ago. */
export function historicalReinsertion(o: { id: string; clock: string; address: Address; lag: number; gain: number; when?: (c: Ctx) => boolean }): RuleSpec {
  return { id: o.id, clock: o.clock, tags: ['ziran', 'history'], when: o.when ?? (() => true),
    then: (c, e) => e.add(o.address, o.gain * (c.hist(o.address, o.lag) - c.hist(o.address, o.lag + 1))) };
}

/** Multi-timescale comparison: discrepancy between a fast and a slow view of the same address. */
export function multiTimescaleComparison(o: { id: string; clock: string; address: Address; fastLag: number; slowLag: number; out: Address }): RuleSpec {
  return { id: o.id, clock: o.clock, tags: ['ziran', 'timescale'], when: () => true,
    then: (c, e) => e.set(o.out, (c.get(o.address) - c.hist(o.address, o.fastLag)) / o.fastLag - (c.get(o.address) - c.hist(o.address, o.slowLag)) / o.slowLag) };
}

/** Reconnect: enable a coupling when a condition ignites, disable when it stops holding. */
export function conditionalCoupling(o: { id: string; clock: string; coupling: string; when: (c: Ctx) => boolean }): RuleSpec {
  return { id: o.id, clock: o.clock, tags: ['ziran', 'coupling'], when: (c) => o.when(c) !== (c.coupling(o.coupling)?.enabled !== false),
    then: (c, e) => e.coupling.patch(o.coupling, { enabled: o.when(c) }) };
}
