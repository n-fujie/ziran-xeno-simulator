// Explicit safety profiles. One selector turns on the protections that are otherwise individually opt-in, and the
// strict profile refuses to construct (fail closed) if a prerequisite is missing, so a deployment cannot silently
// run with only some of them. 'compat' is exactly the behaviour of earlier versions.
import { Ledger } from './store.ts';
import type { VerificationMode } from './store.ts';
import { ScientificRuntime } from './runtime.ts';
import type { ExternalCheckpointBinding } from './checkpoint.ts';

export const SAFETY_PROFILES = ['compat', 'strict'] as const;
export type SafetyProfile = typeof SAFETY_PROFILES[number];
/** Segment size used by the strict profile unless the operator chooses another within the ledger's bounds. */
export const STRICT_SEGMENT_BYTES = 1024 * 1024;
export interface ProfileConfig { directory: string; checkpointFile?: string; external?: ExternalCheckpointBinding; maxSegmentBytes?: number; verification?: VerificationMode }

export function parseSafetyProfile(value: string | undefined): SafetyProfile {
  const profile = value === undefined || value === '' ? 'compat' : value;
  if (!(SAFETY_PROFILES as readonly string[]).includes(profile)) throw Error('unknown safety profile');
  return profile as SafetyProfile;
}

/**
 * compat: earlier behaviour (single ledger file unless a segment size is given, no resume-clearance requirement,
 *         external checkpoint optional).
 * strict: external checkpoint REQUIRED, segment rotation ON, resume clearance REQUIRED before new work follows an
 *         interruption. This is software run protection only; it verifies no device and recovers no hardware.
 */
export function createProfiledRuntime(profile: SafetyProfile, config: ProfileConfig): ScientificRuntime {
  // `verification` is an explicit, separate opt-in for both profiles (default 'full'): strict never turns it on by itself.
  const verification = config.verification === undefined ? {} : { verification: config.verification };
  if (profile === 'compat') return new ScientificRuntime(new Ledger(config.directory, config.checkpointFile, config.external, { ...(config.maxSegmentBytes === undefined ? {} : { maxSegmentBytes: config.maxSegmentBytes }), ...verification }));
  if (!config.external) throw Error('strict safety profile requires an external checkpoint binding');
  return new ScientificRuntime(new Ledger(config.directory, config.checkpointFile, config.external, { maxSegmentBytes: config.maxSegmentBytes ?? STRICT_SEGMENT_BYTES, ...verification }), { requireResumeClearance: true });
}
