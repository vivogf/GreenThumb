// pg_dump -Fc streamed into R2. The upload only completes after pg_dump exited 0.
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { Upload } from '@aws-sdk/lib-storage';
import { childEnv, log, pgEnvFromUrl, redact, requireEnv } from './env.mjs';
import { backupsBucket, copyObject, deleteKeys, listObjects, objectExists, r2Client } from './r2.mjs';
import { selectForDeletion } from './retention.mjs';

export const TAGS = Object.freeze(['hourly', 'pre-migration']);
const DUMP_DEADLINE_MS = 15 * 60 * 1000;

const pad = (n) => String(n).padStart(2, '0');
export function utcDate(d) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}
export function backupKey(tag, d) {
  return `${tag}/greenthumb-${utcDate(d)}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z.dump`;
}
export function dailyKey(d) {
  return `daily/greenthumb-${utcDate(d)}.dump`;
}

function startDump() {
  requireEnv('DATABASE_URL');
  const dump = spawn('pg_dump', ['-Fc', '--no-password'], {
    env: childEnv(pgEnvFromUrl(process.env.DATABASE_URL)),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  dump.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-2000); });
  const closed = new Promise((resolve) => {
    dump.once('error', (error) => resolve({ code: null, signal: null, error }));
    dump.once('close', (code, signal) => resolve({ code, signal }));
  });
  const deadline = setTimeout(() => {
    dump.kill('SIGTERM');
    setTimeout(() => dump.kill('SIGKILL'), 10_000).unref();
  }, DUMP_DEADLINE_MS);
  closed.then(() => clearTimeout(deadline));

  const counter = { bytes: 0 };
  async function* checkedOutput() {
    for await (const chunk of dump.stdout) {
      counter.bytes += chunk.length;
      yield chunk;
    }
    const result = await closed;
    if (result.error || result.code !== 0) {
      const why = result.error ? result.error.message : `exit ${result.code}${result.signal ? `/${result.signal}` : ''}`;
      throw new Error(`pg_dump failed (${why}): ${redact(stderr.trim().split('\n').slice(-3).join(' | '))}`);
    }
  }
  return { dump, closed, counter, body: Readable.from(checkedOutput(), { objectMode: false }) };
}

/**
 * One backup run: dump -> upload -> (hourly) daily copy -> retention.
 * @param {{tag?: 'hourly'|'pre-migration'}} opts
 */
export async function runBackup({ tag = 'hourly' } = {}) {
  if (!TAGS.includes(tag)) throw new Error(`unknown backup tag: ${tag}`);
  const started = new Date();
  const key = backupKey(tag, started);
  const client = r2Client();
  const bucket = backupsBucket();
  log(`backup start key=${key}`);
  try {
    return await backupTo(client, bucket, key, tag, started);
  } finally {
    client.destroy();
  }
}

async function backupTo(client, bucket, key, tag, started) {
  const { dump, closed, counter, body } = startDump();
  const upload = new Upload({
    client,
    params: { Bucket: bucket, Key: key, Body: body, ContentType: 'application/octet-stream' },
    queueSize: 1,
    partSize: 5 * 1024 * 1024,
    leavePartsOnError: false,
  });
  try {
    await upload.done();
  } catch (err) {
    dump.kill('SIGTERM');
    body.destroy();
    await upload.abort().catch(() => {});
    await closed;
    throw err;
  }
  const seconds = ((Date.now() - started.getTime()) / 1000).toFixed(1);
  log(`uploaded key=${key} bytes=${counter.bytes} seconds=${seconds}`);

  if (tag === 'hourly') {
    const daily = dailyKey(started);
    if (await objectExists(client, bucket, daily)) {
      log(`daily copy exists key=${daily}`);
    } else {
      await copyObject(client, bucket, key, daily);
      log(`daily copy created key=${daily} from=${key}`);
    }
  }

  const doomed = selectForDeletion(await listObjects(client, bucket));
  await deleteKeys(client, bucket, doomed);
  log(`retention deleted=${doomed.length}${doomed.length ? ` keys=${doomed.join(',')}` : ''}`);
  return { key, bytes: counter.bytes, seconds: Number(seconds) };
}
