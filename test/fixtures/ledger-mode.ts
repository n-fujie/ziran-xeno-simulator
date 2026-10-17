// Test support: a Ledger whose verification mode can be switched for a whole test run with
// LEDGER_TEST_VERIFICATION=section, so the existing fault-injection, SIGKILL, rotation, resume and audit suites also
// run against the opt-in mode. Anything a test passes explicitly still wins. Production code never reads this variable.
import { Ledger as BaseLedger } from '../../src/science/store.ts';
import type { LedgerOptions } from '../../src/science/store.ts';
import type { ExternalCheckpointBinding } from '../../src/science/checkpoint.ts';

export const TEST_VERIFICATION: 'full' | 'section' = process.env.LEDGER_TEST_VERIFICATION === 'section' ? 'section' : 'full';
export class Ledger extends BaseLedger {
  constructor(directory: string, checkpointPath?: string, external?: ExternalCheckpointBinding, options: LedgerOptions = {}) {
    super(directory, checkpointPath, external, { verification: TEST_VERIFICATION, ...options });
  }
}
