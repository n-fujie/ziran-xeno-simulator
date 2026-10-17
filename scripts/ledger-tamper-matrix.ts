// Runs every tamper/race scenario against both verification modes and prints the observed outcomes as JSON.
//   node scripts/ledger-tamper-matrix.ts [--out file]
// Observations only: `accepted` for an attack is reported as such (see docs/incremental-ledger-verification.md).
import { writeFileSync } from 'node:fs';
import { SCENARIOS, run } from '../test/fixtures/tamper-scenarios.ts';

const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : undefined;
const rows = [];
for (const s of SCENARIOS) {
  for (const external of s.external === 'both' ? [false, true] : [s.external]) {
    const full = run(s, 'full', external), section = run(s, 'section', external);
    rows.push({ id: s.id, title: s.title, externalAnchor: external, full: full.outcome, section: section.outcome, fullMessage: full.message, sectionMessage: section.message });
  }
}
const text = JSON.stringify({ node: process.version, platform: process.platform, rows }, null, 2);
if (out) writeFileSync(out, text + '\n');
console.log(['id', 'ext', 'full', 'section', 'title'].join('\t'));
for (const r of rows) console.log([r.id, r.externalAnchor ? 'ext' : '-', r.full, r.section, r.title].join('\t'));
