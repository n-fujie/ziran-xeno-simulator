// Counts entry kinds across every chain under a receipts directory (each verified in full by Ledger.read()).
//   node scripts/ledger-kind-counts.ts <receipts-directory>
// Used to show that the stored record structure of the 504-cycle comparison does not depend on the storage layout.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Ledger } from '../src/science/store.ts';

const root = process.argv[2];
if (!root) throw Error('usage: node scripts/ledger-kind-counts.ts <receipts-directory>');
const chains = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const kinds: Record<string, number> = {}; let entries = 0, segments = 0;
for (const name of chains) {
  const dir = join(root, name), ledger = new Ledger(dir);
  for (const e of ledger.read()) { kinds[e.kind] = (kinds[e.kind] ?? 0) + 1; entries++; }
  segments += ledger.layout().sealed.length;
}
console.log(JSON.stringify({ chains: chains.length, entries, kinds, sealedSegments: segments }));
