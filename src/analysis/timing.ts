// Speed and too-late correction.
// A correction may be epistemically valid yet operationally ineffective when
// correction time > environmental reconfiguration time.
import type { Trace } from '../core/trace.ts';

export interface CorrectionReport {
  rule: string; ignition: number;
  /** correct | incorrect | undetermined — about the premise at the time of ignition. */
  epistemic: string;
  /** in-time | too-late | not-executed | undetermined | n/a — about the premise when the effect lands. */
  operational: string;
  label: string;
  originT: number | null;
  latency: { detection: number | null; ignition: number | null; intervention: number; correction: number | null; feedback: number | null };
  reconfiguration: number | null;
  tooSlow: boolean;
}

export function corrections(tr: Trace): CorrectionReport[] {
  const ev = tr.events;
  const out: CorrectionReport[] = [];
  const feedbackBy: Record<number, number> = {};
  for (const e of ev) if (e.kind === 'feedback') feedbackBy[e.origin] = Math.min(feedbackBy[e.origin] ?? Infinity, e.latency);
  for (const c of ev) {
    if (c.kind !== 'correction') continue;
    const ign = ev[c.ignition];
    const dets = (ign.cause as number[]).map((s) => ev[s]).filter((x) => x?.kind === 'detection');
    const effs = [...dets.flatMap((d) => (d.cause as number[]).map((s) => ev[s])), ...(ign.cause as number[]).map((s) => ev[s]).filter((x) => x?.kind === 'effect')];
    const originT = effs.length ? Math.min(...effs.map((x) => x.t)) : null;
    const detT = dets.length ? Math.min(...dets.map((d) => d.t)) : null;
    const reconf = c.reconfigT === null || originT === null ? (c.reconfigT === null ? null : c.reconfigT - ign.t) : c.reconfigT - originT;
    const corrLat = originT === null ? c.effectT - ign.t : c.effectT - originT;
    out.push({
      rule: c.rule, ignition: c.ignition, epistemic: c.epistemic, operational: c.operational, label: c.label, originT,
      latency: {
        detection: originT !== null && detT !== null ? detT - originT : null,
        ignition: detT !== null ? ign.t - detT : null,
        intervention: c.effectT - ign.t,
        correction: corrLat,
        feedback: Number.isFinite(feedbackBy[c.ignition]) ? feedbackBy[c.ignition] : null,
      },
      reconfiguration: reconf,
      tooSlow: reconf !== null && corrLat > reconf,
    });
  }
  return out;
}

export function correctionSummary(tr: Trace): Record<string, number> {
  const s: Record<string, number> = {};
  for (const c of corrections(tr)) s[c.label] = (s[c.label] ?? 0) + 1;
  return s;
}

/** Latency distributions of detection by apparatus/channel. */
export function detectionLatencies(tr: Trace): Record<string, { n: number; mean: number; max: number }> {
  const acc: Record<string, number[]> = {};
  for (const e of tr.events) if (e.kind === 'detection' && e.latency) (acc[e.apparatus + '/' + e.channel] ??= []).push(...e.latency);
  return Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, { n: v.length, mean: v.reduce((a, b) => a + b, 0) / v.length, max: Math.max(...v) }]));
}
