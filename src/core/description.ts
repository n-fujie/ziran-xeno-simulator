// The operational description space S — open but meta-bounded.
//
// S is rendered through *description facets*. Each facet is a registered object that says which descriptors
// it can see in a configuration (dimensions, value kinds, topology, channels, …). The core ships default
// facets; domains and experiments may register further facets (before or during a run) without editing
// core source. Two kinds of change are distinguished:
//   Level C (S_t → S_{t+1}): descriptors appear/disappear within the currently registered facets;
//   Level D (M_t → M_{t+1}): the set of facets itself changes (a new kind of description becomes possible,
//   or an existing kind is retired).
// The facet interface and the code that consults it remain fixed; this is the meta-bound.
import { kindOf } from './values.ts';
import { hashOf } from './hash.ts';
import type { Origin } from './meta.ts';

export interface SpaceSource {
  state: Record<string, unknown>;
  dims: Record<string, { key: string; resolution?: number }>;
  couplings: Record<string, { from: string; to: string; enabled?: boolean; medium?: string }>;
  apparatus: Record<string, { id: string; channels: { id: string; reads: string[]; aggregate?: string; resolution?: number; boundary?: string[]; construct?: { op: string; of: string[] }; enabled?: boolean }[] }>;
  rules: Record<string, { enabled: boolean; spec: { clock: string } }>;
  stochastic: Set<string>;
  opAddr: Record<string, { id: string; storage: string[]; domains: string[]; status: string; lineage: string[]; relations?: { to: string; type: string }[] }>;
}

export interface DescriptionFacet {
  id: string;
  label?: string;
  origin?: Origin;
  /** Descriptors this facet can see in the current configuration. */
  describe(src: SpaceSource): Iterable<string>;
  /** Optional custom comparison; default is set difference. */
  compare?(a: Set<string>, b: Set<string>): { added: string[]; removed: string[] };
  /** Optional serialization of the facet's descriptors. */
  serialize?(s: Set<string>): unknown;
  /** Optional lineage annotation for a change in this facet. */
  lineage?(change: { added: string[]; removed: string[] }): string;
  /** Re-render this facet after every write (not only after structural changes). */
  dependsOnValues?: boolean;
}

const F = (id: string, label: string, describe: (s: SpaceSource) => Iterable<string>): DescriptionFacet => ({ id, label, origin: 'supplied', describe });

function* chans(s: SpaceSource) { for (const app of Object.values(s.apparatus)) for (const c of app.channels) if (c.enabled !== false) yield { app, c, k: `${app.id}/${c.id}` }; }

export const DEFAULT_FACETS: DescriptionFacet[] = [
  F('configuration-dimension', 'configuration dimensions', (s) => Object.values(s.dims).map((d) => d.key)),
  F('dimension-resolution', 'dimension resolutions', (s) => Object.values(s.dims).filter((d) => d.resolution !== undefined).map((d) => `${d.key}@${d.resolution}`)),
  F('state-dimension', 'storage dimensions', (s) => Object.keys(s.state)),
  F('value-kind', 'value kinds present', (s) => new Set(Object.values(s.state).map(kindOf))),
  F('representation', 'non-scalar representations', (s) => Object.entries(s.state).filter(([, v]) => kindOf(v) !== 'scalar').map(([k, v]) => `${k}:${kindOf(v)}`)),
  F('relation-type', 'relation types (edge labels)', (s) => { const o = new Set<string>(); for (const [k, v] of Object.entries(s.state)) if (kindOf(v) === 'relation') for (const e of ((v as { edges?: unknown[][] }).edges ?? [])) o.add(`${k}:${(e[2] as string) ?? '∅'}`); return o; }),
  F('topology', 'coupling topology', (s) => Object.entries(s.couplings).filter(([, c]) => c.enabled !== false).map(([id, c]) => `${c.from}→${c.to}#${id}`)),
  F('channel', 'observation channels', (s) => [...chans(s)].map((x) => x.k)),
  F('channel-resolution', 'channel resolutions', (s) => [...chans(s)].map((x) => `${x.k}@${x.c.resolution ?? 0}`)),
  F('channel-scale', 'channel scale / construction', (s) => [...chans(s)].map((x) => `${x.k}:${x.c.construct ? x.c.construct.op + '(' + x.c.construct.of.join(',') + ')' : (x.c.aggregate ?? 'mean') + '[' + [...x.c.reads].sort().join(',') + ']'}`)),
  F('boundary', 'channel boundaries', (s) => [...chans(s)].filter((x) => x.c.boundary).map((x) => `${x.k}:${[...x.c.boundary!].sort().join(',')}`)),
  F('variable-system', 'variable systems', (s) => Object.values(s.apparatus).map((a) => `${a.id}:[${a.channels.filter((c) => c.enabled !== false).map((c) => c.id).sort().join(',')}]`)),
  F('transition-class', 'transition classes (enabled rules)', (s) => Object.entries(s.rules).filter(([, r]) => r.enabled).map(([id]) => id)),
  F('branch-mechanism', 'observed stochastic branch mechanisms', (s) => [...s.stochastic].filter((id) => s.rules[id]?.enabled)),
  F('operational-address', 'operational addresses', (s) => Object.values(s.opAddr).map((a) => `${a.id}:${a.status}`)),
  F('address-relation', 'address–domain and address–address relations', (s) => Object.values(s.opAddr).flatMap((a) => [...a.domains.map((d) => `${a.id}~${d}`), ...(a.relations ?? []).map((r) => `${a.id}-${r.type}->${r.to}`)])),
  F('re-ignition-route', 're-ignition routes', (s) => Object.values(s.opAddr).flatMap((a) => a.lineage.map((l) => `${l}⇒${a.id}`))),
];

/** Default facet ids (kept for compatibility; the set is open). */
export const SPACE_CATEGORIES = DEFAULT_FACETS.map((f) => f.id);
export type SpaceCategory = string;
export type Space = Record<string, Set<string>>;

export function describeSpace(e: SpaceSource, facets: DescriptionFacet[] = DEFAULT_FACETS): Space {
  const S: Space = {};
  for (const f of facets) {
    try { S[f.id] = new Set([...f.describe(e)].map(String)); } catch { S[f.id] = new Set(['⚠ facet-error']); }
  }
  return S;
}

export interface SpaceDiff {
  added: Record<string, string[]>; removed: Record<string, string[]>;
  /** Level D: facets that exist in b but not a / in a but not b. */
  facetsAdded: string[]; facetsRemoved: string[];
  empty: boolean;
}

export function diffSpace(a: Space, b: Space, facets?: DescriptionFacet[]): SpaceDiff {
  const added: Record<string, string[]> = {}, removed: Record<string, string[]> = {};
  const fa = Object.keys(a), fb = Object.keys(b);
  const facetsAdded = fb.filter((x) => !fa.includes(x)).sort(), facetsRemoved = fa.filter((x) => !fb.includes(x)).sort();
  for (const c of fb.filter((x) => fa.includes(x))) {
    const custom = facets?.find((f) => f.id === c)?.compare;
    const d = custom ? custom(a[c], b[c]) : { added: [...b[c]].filter((x) => !a[c].has(x)).sort(), removed: [...a[c]].filter((x) => !b[c].has(x)).sort() };
    if (d.added.length) added[c] = d.added;
    if (d.removed.length) removed[c] = d.removed;
  }
  return { added, removed, facetsAdded, facetsRemoved, empty: !Object.keys(added).length && !Object.keys(removed).length && !facetsAdded.length && !facetsRemoved.length };
}

export function spaceHash(s: Space): string {
  return hashOf(Object.fromEntries(Object.keys(s).sort().map((c) => [c, [...s[c]].sort()]))).slice(0, 16);
}

/** A compact grammar signature of a space change: which facets expand (+) or contract (−); ⊕/⊖ for facet (Level D) changes. */
export function changeSignature(d: SpaceDiff): string {
  return [...Object.keys(d.added).map((c) => '+' + c), ...Object.keys(d.removed).map((c) => '−' + c), ...d.facetsAdded.map((c) => '⊕facet:' + c), ...d.facetsRemoved.map((c) => '⊖facet:' + c)].sort().join(' ');
}

export function spaceSummary(s: Space): Record<string, number> {
  return Object.fromEntries(Object.keys(s).map((c) => [c, s[c].size]));
}
