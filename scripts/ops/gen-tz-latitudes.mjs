#!/usr/bin/env node
// Generates shared/season/tz-latitudes.json (zone → latitude) from an IANA tzdata release.
//
//   node scripts/ops/gen-tz-latitudes.mjs --version 2026e [--out FILE]   download that release from IANA
//   node scripts/ops/gen-tz-latitudes.mjs --tzdata-dir DIR [--out FILE]  use an extracted tzdata tarball
//   node scripts/ops/gen-tz-latitudes.mjs                                 re-run with the version recorded
//                                                                         in the current output file
// The output records the tzdata version and has no timestamps, so a re-run with the same release is
// byte-identical. Copy the result byte-for-byte to the KMP app (architecture §2.9).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTzLatitudes, serializeTzLatitudes } from './lib/tz-latitudes.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_OUT = join(ROOT, 'shared', 'season', 'tz-latitudes.json');
const SOURCE_FILES = ['backward', 'africa', 'antarctica', 'asia', 'australasia', 'europe', 'northamerica', 'southamerica', 'etcetera'];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--version' || a === '--tzdata-dir' || a === '--out') {
      if (!argv[i + 1]) throw new Error(`${a} needs a value`);
      args[a.slice(2)] = argv[++i];
    } else if (a === '-h' || a === '--help') {
      args.help = true;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return args;
}

function download(version) {
  if (!/^\d{4}[a-z]$/.test(version)) throw new Error(`bad tzdata version: ${version}`);
  const dir = mkdtempSync(join(tmpdir(), 'gt-tzdata-'));
  const tarball = join(dir, 'tzdata.tar.gz');
  const url = `https://data.iana.org/time-zones/releases/tzdata${version}.tar.gz`;
  execFileSync('curl', ['-fsS', '--max-time', '120', '-o', tarball, url], { stdio: 'inherit' });
  execFileSync('tar', ['xzf', tarball, '-C', dir], { stdio: 'inherit' });
  return dir;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 10).join('\n'));
    return;
  }
  const out = resolve(args.out ?? DEFAULT_OUT);
  let version = args.version;
  if (!version && !args['tzdata-dir'] && existsSync(DEFAULT_OUT)) {
    version = JSON.parse(readFileSync(DEFAULT_OUT, 'utf8')).tzdataVersion;
  }
  let dir = args['tzdata-dir'] ? resolve(args['tzdata-dir']) : null;
  let tempDir = null;
  if (!dir) {
    if (!version) throw new Error('pass --version <release> or --tzdata-dir <dir>');
    tempDir = download(version);
    dir = tempDir;
  }
  try {
    const read = (name) => readFileSync(join(dir, name), 'utf8');
    const dirVersion = read('version').trim();
    if (version && version !== dirVersion) throw new Error(`tzdata dir is ${dirVersion}, expected ${version}`);
    const { data, unresolved } = buildTzLatitudes({
      version: dirVersion,
      zoneTab: read('zone.tab'),
      zone1970Tab: read('zone1970.tab'),
      sources: SOURCE_FILES.map(read),
    });
    if (unresolved.length) console.error(`gen-tz-latitudes: no location for ${unresolved.join(', ')}`);
    writeFileSync(out, serializeTzLatitudes(data));
    console.log(`gen-tz-latitudes: tzdata ${dirVersion}, ${Object.keys(data.zones).length} zones -> ${out}`);
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (err) {
  console.error(`gen-tz-latitudes FAILED: ${err?.message ?? err}`);
  process.exitCode = 1;
}
