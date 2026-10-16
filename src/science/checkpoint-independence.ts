// Policy evaluator for the claim "the external checkpoint is independent of the history it witnesses".
// The runtime cannot observe who administers a store, so it never returns a verified verdict: the strongest
// result is an operator declaration that remains unverified. Shared administrators or credentials are
// reported as NOT independent, so a report can never present same-administrator rewrite power as immutability.

export interface CheckpointIndependenceDeclaration {
  /** Principals able to modify or delete the local ledger and its witness file. */
  ledgerWriters: string[];
  /** Principals able to modify, delete or roll back the external head. */
  checkpointWriters: string[];
  /** What the external service itself enforces for retained heads. */
  checkpointRetention: 'append-only-enforced' | 'versioned-recoverable' | 'mutable' | 'unknown';
  /** True only if ledger writers cannot obtain the credential that writes the external head. */
  credentialSeparate: boolean;
  transport: 'https' | 'loopback-http-test';
}
export type CheckpointIndependenceStatus = 'not-independent' | 'not-established' | 'declared-independent-unverified';
export interface CheckpointIndependenceVerdict { status: CheckpointIndependenceStatus; reasons: string[]; verifiedByRuntime: false }

const principal = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const valid = (list: unknown): list is string[] => Array.isArray(list) && list.length > 0 && list.every((p) => principal(p).length > 0);

export function evaluateCheckpointIndependence(declaration: CheckpointIndependenceDeclaration): CheckpointIndependenceVerdict {
  const notIndependent: string[] = [], notEstablished: string[] = [];
  if (!valid(declaration?.ledgerWriters) || !valid(declaration?.checkpointWriters)) notEstablished.push('writers-unspecified');
  else {
    const ledger = new Set(declaration.ledgerWriters.map(principal));
    const wildcard = [...declaration.ledgerWriters, ...declaration.checkpointWriters].some((p) => principal(p) === '*');
    if (wildcard) notIndependent.push('wildcard-writer');
    if (declaration.checkpointWriters.some((p) => ledger.has(principal(p)))) notIndependent.push('shared-administrator');
  }
  if (declaration?.credentialSeparate !== true) notIndependent.push('credential-reachable-by-ledger-writers');
  if (declaration?.checkpointRetention === 'mutable') notEstablished.push('retention-mutable');
  else if (declaration?.checkpointRetention !== 'append-only-enforced' && declaration?.checkpointRetention !== 'versioned-recoverable') notEstablished.push('retention-unknown');
  if (declaration?.transport !== 'https') notEstablished.push('transport-not-production-https');
  const status: CheckpointIndependenceStatus = notIndependent.length ? 'not-independent' : notEstablished.length ? 'not-established' : 'declared-independent-unverified';
  return { status, reasons: [...notIndependent, ...notEstablished], verifiedByRuntime: false };
}
