// Validate downloaded PR #1 v1 receipts with the exact committed v1 fingerprint implementation.
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import { hashOf, sha256 } from '../src/core/hash.ts';
const args = process.argv.slice(2);
const flag = (name: string) => args[args.indexOf(name) + 1];
if (!args.includes('--artifact') || !args.includes('--reproduction') || !args.includes('--out')) throw Error('required: --artifact <downloaded-dir> --reproduction <v1-report> --out <validation.json>');
const commit = 'ff45ab0d0b509f9e8a7e31f7c325650e3c2ac8d5';
const original = JSON.parse(execFileSync('git', ['show', `${commit}:results/scientific-cycle/v1-comparison.json`], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }));
const source = execFileSync('git', ['show', `${commit}:src/science/runtime.ts`], { encoding: 'utf8' });
const functionSource = source.slice(source.indexOf('export function scientificFingerprint')).replace('export function', 'function');
const fingerprint = new Function('hashOf', stripTypeScriptTypes(functionSource) + '; return scientificFingerprint;')(hashOf) as (value: unknown) => string;
const report = JSON.parse(readFileSync(join(flag('--artifact'), 'scientific-comparison.json'), 'utf8'));
const reproduction = JSON.parse(readFileSync(flag('--reproduction'), 'utf8'));
for (const [file, digest] of Object.entries(original.environment.sourceSha256)) if (sha256(execFileSync('git', ['show', `${commit}:${file}`], { encoding: 'utf8' })) !== digest) throw Error('baseline source mismatch');
if (report.rows.length !== 504 || reproduction.rows.length !== 504 || original.rows.length !== 504) throw Error('incomplete run');
for (let i = 0; i < 504; i++) if (report.rows[i].fingerprint !== original.rows[i].fingerprint || reproduction.rows[i].fingerprint !== original.rows[i].fingerprint) throw Error(`v1 fingerprint mismatch ${i}`);
const evidence = join(flag('--artifact'), 'scientific-evidence');
const expected = new Set<string>(report.rows.map((r: { fingerprint: string }) => r.fingerprint));
const seen = new Set<string>();
let receipts = 0, chains = 0;
const digests: Record<string, string> = {};
for (const dir of readdirSync(evidence)) {
  const path = join(evidence, dir, 'ledger.json'), raw = readFileSync(path, 'utf8');
  let previous = '';
  const entries = JSON.parse(raw);
  for (const [sequence, entry] of entries.entries()) {
    const { hash, ...payload } = entry;
    if (entry.sequence !== sequence || entry.previous !== previous || hash !== sha256(JSON.stringify(payload))) throw Error('artifact chain corrupt');
    previous = hash;
    if (entry.kind !== 'prepared') { const fp = fingerprint(entry.data); if (!expected.has(fp) || seen.has(fp)) throw Error('artifact receipt missing, duplicated or does not match report'); seen.add(fp); receipts++; }
  }
  chains++; digests[dir] = sha256(raw);
}
if (receipts !== 504 || chains !== 252) throw Error('missing artifact receipts');
const temporary = mkdtempSync(join(tmpdir(), 'scientific-v1-counterexample-'));
let baselineCounterexamples;
try {
  // Exact baseline modules; only module locations change. No application implementation is forked.
  for (const name of ['store', 'protocol']) {
    let text = execFileSync('git', ['show', `${commit}:src/science/${name}.ts`], { encoding: 'utf8' });
    text = text.replace(/'\.\.\/(core|ziran)\/([^']+)'/g, (_match, group: string, file: string) => JSON.stringify(fileURLToPath(new URL(`../src/${group}/${file}`, import.meta.url))));
    writeFileSync(join(temporary, `${name}.ts`), text);
  }
  const { Ledger: OriginalLedger } = await import(pathToFileURL(join(temporary, 'store.ts')).href);
  const { relation: originalRelation } = await import(pathToFileURL(join(temporary, 'protocol.ts')).href);
  const ledger = new OriginalLedger(join(temporary, 'ledger'));
  ledger.exclusive(() => { ledger.append('prepared', 'original-operation', {}); ledger.append('completed', 'original-operation', {}); });
  const entries = ledger.read(); writeFileSync(join(ledger.directory, 'ledger.json'), JSON.stringify(entries.slice(0, 1)));
  baselineCounterexamples = { validPrefixDeletionAccepted: ledger.read().length === 1, emptyReadingsClassifiedAsNoDifference: originalRelation([], []) === 'no-difference-in-measured-channels' };
  if (!baselineCounterexamples.validPrefixDeletionAccepted || !baselineCounterexamples.emptyReadingsClassifiedAsNoDifference) throw Error('baseline counterexample did not reproduce');
} finally { rmSync(temporary, { recursive: true, force: true }); }
writeFileSync(flag('--out'), JSON.stringify({ commit, originalSourceHashesVerified: true, originalRuns: 504, localReproductionMatches: 504, hostedReportMatches: 504, hostedReceiptMatches: receipts, hostedChainsVerified: chains, protocol: original.protocol, baselineCounterexamples, artifactLedgerSha256: digests, limitation: 'v1 chain hashes do not detect valid-prefix deletion; this audit validates complete downloaded receipts against the independently retained report' }, null, 2) + '\n');
console.log('v1: 504 local reproductions, 504 hosted results and 252 hosted receipt chains verified');
