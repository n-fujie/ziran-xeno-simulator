// TraceSchemaSensitivity — do analysis results survive a change of trace schema?
// Given one run and several schemas, compare discovered bundles, later-label correspondence, responsibility
// localization, reachability interpretation and fragility localization. A result that appears under only
// one narrow schema is reported as schema-narrow, not as robustly emergent.
import type { WorldSpec } from '../core/types.ts';
import type { Trace } from '../core/trace.ts';
import { projectTrace, TRACE_SCHEMAS, type TraceSchema } from './trace-schema.ts';
import { discoverBundles, compareLabels } from '../analysis/emergence.ts';
import { responsibilityPoints } from '../analysis/responsibility.ts';
import { fragilityProfile, type Region } from '../analysis/fragility.ts';

export interface SchemaResult {
  schema: string; events: number; droppedEvents: number; droppedCauseEdges: number;
  bundles: string[][]; labels: { label: string; isolates: boolean; jaccard: number }[];
  responsibilityLoci: string[] | null; reachability: { available: boolean; signatures: string[] }; fragilityLead: string | null;
}

export interface SchemaSensitivity {
  schemas: SchemaResult[];
  bundleAgreement: number;
  labelStability: Record<string, { isolatingSchemas: string[]; verdict: string }>;
  responsibilityStable: boolean | null;
  reachabilityStable: boolean;
  fragilityStable: boolean | null;
  schemaNarrow: string[][];
  statement: string;
}

const jacc = (a: string[], b: string[]) => { const B = new Set(b); const i = a.filter((x) => B.has(x)).length; return i / (a.length + b.length - i || 1); };

export function traceSchemaSensitivity(tr: Trace, o: { schemas?: TraceSchema[]; label?: (rule: string) => string | null; spec?: WorldSpec; regions?: Region[]; responsibility?: boolean } = {}): SchemaSensitivity {
  const schemas = o.schemas ?? TRACE_SCHEMAS;
  const res: SchemaResult[] = schemas.map((sc) => {
    const p = projectTrace(tr, sc);
    const em = discoverBundles(p, { stability: false });
    const bundles = em.bundles.map((b) => b.members.map((m) => em.key[m]).sort());
    const labels = o.label ? compareLabels(em, p, o.label).map((l) => ({ label: l.label, isolates: l.isolatesBundle, jaccard: l.jaccard })) : [];
    let loci: string[] | null = null;
    if (o.spec && o.responsibility !== false) loci = responsibilityPoints(o.spec, tr, { project: (t) => projectTrace(t, sc) }).filter((r) => r.nonRedundant).map((r) => r.rule).sort();
    const reach = { available: p.probeRelativeReachability.length > 0 || p.events.some((e) => String(e.kind).startsWith('reachability')), signatures: [...new Set(p.probeRelativeReachability.flatMap((r: any) => r.signatures))].sort() as string[] };
    let lead: string | null = null;
    if (o.regions?.length) { const P = fragilityProfile(p, o.regions); const r = Object.entries(P).sort((a, b) => b[1].failures - a[1].failures || b[1].variance - a[1].variance)[0]; lead = r && (r[1].failures || r[1].variance) ? r[0] : null; }
    return { schema: sc.id, events: p.events.length, droppedEvents: p.dropped.events, droppedCauseEdges: p.dropped.causeEdges, bundles, labels, responsibilityLoci: loci, reachability: reach, fragilityLead: lead };
  });
  // agreement: mean over schema pairs of the fraction of bundles with a Jaccard ≥ 0.8 partner
  let agree = 0, pairs = 0;
  for (let i = 0; i < res.length; i++) for (let j = i + 1; j < res.length; j++) {
    const a = res[i].bundles, b = res[j].bundles; if (!a.length || !b.length) continue;
    agree += (a.filter((x) => b.some((y) => jacc(x, y) >= 0.8)).length + b.filter((x) => a.some((y) => jacc(x, y) >= 0.8)).length) / (a.length + b.length); pairs++;
  }
  const labelStability: SchemaSensitivity['labelStability'] = {};
  for (const l of new Set(res.flatMap((r) => r.labels.map((x) => x.label)))) {
    const iso = res.filter((r) => r.labels.find((x) => x.label === l)?.isolates).map((r) => r.schema);
    labelStability[l] = { isolatingSchemas: iso, verdict: iso.length === 0 ? 'no corresponding bundle under any schema' : iso.length === res.length ? 'corresponds to a bundle under every schema' : iso.length === 1 ? `schema-narrow: corresponds only under ${iso[0]}` : `schema-dependent: corresponds under ${iso.join(', ')}` };
  }
  const narrow: string[][] = [];
  for (const r of res) for (const b of r.bundles) if (b.length > 1 && res.filter((x) => x.bundles.some((y) => jacc(y, b) >= 0.8)).length === 1 && !narrow.some((n) => jacc(n, b) >= 0.8)) narrow.push(b);
  const lociSets = res.map((r) => r.responsibilityLoci).filter((x): x is string[] => x !== null);
  const responsibilityStable = lociSets.length ? lociSets.every((l) => JSON.stringify(l) === JSON.stringify(lociSets[0])) : null;
  const reachabilityStable = res.every((r) => r.reachability.available === res[0].reachability.available);
  const fr = res.map((r) => r.fragilityLead);
  const fragilityStable = o.regions?.length ? fr.every((x) => x === fr[0]) : null;
  const agreement = pairs ? agree / pairs : 1;
  return { schemas: res, bundleAgreement: agreement, labelStability, responsibilityStable, reachabilityStable, fragilityStable, schemaNarrow: narrow,
    statement: `under trace-schema perturbation (${schemas.map((s) => s.id).join(', ')}), bundle agreement was ${agreement.toFixed(2)}; responsibility localization was ${responsibilityStable === null ? 'not assessed' : responsibilityStable ? 'stable' : 'not stable'}; reachability interpretation was ${reachabilityStable ? 'stable' : 'not stable'}` };
}
