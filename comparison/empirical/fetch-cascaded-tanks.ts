// Downloads the Cascaded Tanks benchmark from its primary source (4TU.ResearchData, DOI 10.4121/12960104) into
// data/external/cascaded-tanks/raw/, verifies the publisher-supplied MD5 of each file, and records SHA-256 hashes.
// Existing files are never overwritten; a file already present is only re-hashed and checked.
// Raw data are not committed (see .gitignore); this script reproduces the acquisition.
// Usage: node comparison/empirical/fetch-cascaded-tanks.ts
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = 'https://data.4tu.nl/v2/articles/12960104';
const RAW = fileURLToPath(new URL('../../data/external/cascaded-tanks/raw/', import.meta.url));
const WANT = ['CascadedTanksFiles.zip', 'TanksBenchmark.pdf'];

const meta = await (await fetch(API)).json() as { title: string; doi: string; version: number; published_date: string; license: { name: string; url: string }; authors?: { full_name: string }[]; files: { name: string; size: number; download_url: string; supplied_md5?: string; computed_md5?: string }[] };
mkdirSync(RAW, { recursive: true });
const record: Record<string, unknown>[] = [];
for (const f of meta.files.filter((x) => WANT.includes(x.name))) {
  const path = RAW + f.name;
  if (!existsSync(path)) { const buf = Buffer.from(await (await fetch(f.download_url)).arrayBuffer()); writeFileSync(path, buf, { flag: 'wx' }); }
  const buf = readFileSync(path);
  const md5 = createHash('md5').update(buf).digest('hex'), sha256 = createHash('sha256').update(buf).digest('hex');
  const expected = f.supplied_md5 ?? f.computed_md5;
  if (expected && md5 !== expected) throw new Error(`${f.name}: MD5 ${md5} ≠ publisher ${expected}`);
  if (buf.length !== f.size) throw new Error(`${f.name}: size ${buf.length} ≠ publisher ${f.size}`);
  record.push({ file: f.name, bytes: buf.length, sha256, md5, publisherMd5: expected, md5Verified: md5 === expected, sourceUrl: f.download_url });
}
const out = { source: '4TU.ResearchData', api: API, title: meta.title, doi: meta.doi, version: meta.version, published: meta.published_date, license: meta.license, authors: meta.authors?.map((a) => a.full_name) ?? null, downloadDate: new Date().toISOString().slice(0, 10), files: record };
writeFileSync(RAW + 'ACQUISITION.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
