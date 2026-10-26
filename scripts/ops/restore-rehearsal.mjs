#!/usr/bin/env node
// Restore rehearsal: newest hourly/ dump -> temporary DB greenthumb_restore_check -> compare row counts with the
// live DB -> drop the temporary DB. Runs on the VPS as root; Postgres tools run as OS user `postgres` (peer auth),
// so no password is ever passed. Never uses `pg_restore --create`.
import { spawn } from 'node:child_process';
import { createReadStream, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { childEnv, loadEnvFile, log, pgEnvFromUrl, requireEnv } from './lib/env.mjs';
import { backupsBucket, downloadObject, listObjects, r2Client } from './lib/r2.mjs';
import { newestKey } from './lib/retention.mjs';

const TEMP_DB = 'greenthumb_restore_check';
const DRIFT_OK = new Set(['session']);
const COUNT_SQL_GEN = "select string_agg(format('select %L, count(*) from public.%I', tablename, tablename), ' union all ' order by tablename) from pg_tables where schemaname = 'public'";

function asPostgres(cmd, args, { stdinFile } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-u', 'postgres', '--', cmd, ...args], {
      env: childEnv(),
      cwd: '/',
      stdio: [stdinFile ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err = (err + c).slice(-2000); });
    if (stdinFile) {
      const src = createReadStream(stdinFile);
      src.on('error', reject);
      child.stdin.on('error', () => {});
      src.pipe(child.stdin);
    }
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} exited ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`));
    });
  });
}

async function tableCounts(db) {
  const sql = (await asPostgres('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', COUNT_SQL_GEN])).trim();
  const counts = new Map();
  if (!sql) return counts;
  const rows = await asPostgres('psql', ['-X', '-A', '-t', '-F', ' ', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', sql]);
  for (const line of rows.trim().split('\n').filter(Boolean)) {
    const [name, n] = line.split(' ');
    counts.set(name, Number(n));
  }
  return counts;
}

async function main() {
  loadEnvFile();
  requireEnv('DATABASE_URL');
  const { PGDATABASE: liveDb, PGUSER: owner } = pgEnvFromUrl(process.env.DATABASE_URL);
  const client = r2Client();
  const bucket = backupsBucket();
  const work = mkdtempSync('/tmp/gt-restore-');
  let createdDb = false;
  let ok = false;
  try {
    const key = newestKey(await listObjects(client, bucket, 'hourly/'), 'hourly/');
    if (!key) throw new Error('no hourly/ backup found');
    log(`rehearsal key=${key}`);
    const file = join(work, 'backup.dump');
    await downloadObject(client, bucket, key, file);

    await asPostgres('dropdb', ['--if-exists', TEMP_DB]);
    await asPostgres('createdb', ['-O', owner, TEMP_DB]);
    createdDb = true;
    const t0 = Date.now();
    await asPostgres('pg_restore', [
      '--no-owner', '--no-acl', `--role=${owner}`, '--exit-on-error', '--single-transaction', '-d', TEMP_DB,
    ], { stdinFile: file });
    log(`restored into ${TEMP_DB} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

    const restored = await tableCounts(TEMP_DB);
    const live = await tableCounts(liveDb);
    const names = [...new Set([...restored.keys(), ...live.keys()])].sort();
    const mismatches = [];
    console.log(`${'table'.padEnd(28)} ${'restored'.padStart(9)} ${'live'.padStart(9)}  result`);
    for (const name of names) {
      const r = restored.get(name);
      const l = live.get(name);
      const same = r === l;
      const verdict = same ? 'equal' : DRIFT_OK.has(name) ? 'drift ok' : 'MISMATCH';
      if (!same && !DRIFT_OK.has(name)) mismatches.push(name);
      console.log(`${name.padEnd(28)} ${String(r ?? '-').padStart(9)} ${String(l ?? '-').padStart(9)}  ${verdict}`);
    }
    if (mismatches.length) throw new Error(`row counts differ: ${mismatches.join(', ')}`);
    ok = true;
  } finally {
    if (createdDb) {
      try {
        await asPostgres('dropdb', ['--if-exists', TEMP_DB]);
        log(`dropped ${TEMP_DB}`);
      } catch (err) {
        log(`could not drop ${TEMP_DB}: ${err.message}`);
        ok = false;
      }
    }
    rmSync(work, { recursive: true, force: true });
    client.destroy();
  }
  return ok;
}

try {
  const ok = await main();
  log(ok ? 'rehearsal ok' : 'rehearsal FAILED');
  if (!ok) process.exitCode = 1;
} catch (err) {
  log(`rehearsal FAILED: ${err?.message ?? err}`);
  process.exitCode = 1;
}
