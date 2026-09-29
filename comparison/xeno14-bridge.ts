// Bridge from the Python Xeno-14 experiment to the v0.3.0 revision machinery (paretoFront / selectFrom).
// Reads JSON on stdin: { candidates: [{ id, description, cost, values: {axis: number} }], axes: [{ id, prefer, assumptions }], policy }
// Writes JSON on stdout: { pareto: [ids], selected: [ids], axisValues }. Axes are registered as domain-registered
// ParetoAxis objects; v0.3.0 code is used unchanged.
import { paretoFront, selectFrom, type CandidateProfile, type ParetoAxis, type SelectionPolicy } from '../src/ziran/reviser.ts';

const input = JSON.parse(await new Promise<string>((ok) => { let s = ''; process.stdin.on('data', (d) => (s += d)).on('end', () => ok(s)); })) as {
  candidates: { id: string; description: string; cost: number; values: Record<string, number> }[];
  axes: { id: string; prefer: 'min' | 'max'; assumptions: string }[];
  policy: SelectionPolicy;
};
const byId = new Map<CandidateProfile, string>();
const profiles: CandidateProfile[] = input.candidates.map((c) => {
  const p: CandidateProfile = { kind: c.id, description: c.description, cost: c.cost, resolves: true, aliasesResolved: 0, lostObservability: [], newObservability: [], resourceCost: c.cost, fragility: { blockedDelta: 0, resourcesDepleted: [] }, reachabilityChange: [], delayedConsequences: [], descriptionSpaceChange: [], pareto: false, selected: false, evaluated: 'lookahead' };
  (p as CandidateProfile & { values: Record<string, number> }).values = c.values; byId.set(p, c.id); return p;
});
const axes: ParetoAxis[] = input.axes.map((a) => ({ id: a.id, prefer: a.prefer, measure: (p) => (p as CandidateProfile & { values: Record<string, number> }).values[a.id], assumptions: a.assumptions, window: 'validation episodes', configuration: 'Walker2d-v5 stress push', comparability: 'same validation seeds and push', preferenceOrigin: 'external', origin: 'domain-registered' }));
const front = paretoFront(profiles, axes);
const sel = selectFrom(profiles, input.policy, axes);
process.stdout.write(JSON.stringify({ pareto: front.map((p) => byId.get(p)), selected: sel.map((p) => byId.get(p)), axisValues: Object.fromEntries(profiles.map((p) => [byId.get(p), p.axisValues])), policy: input.policy, policyOrigin: 'external' }));
