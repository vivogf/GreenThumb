// Environment helpers for ops scripts. Secrets stay in process memory; nothing here prints values.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Parses KEY=value lines. Values already present in process.env win, so a caller can override the file. */
export function loadEnvFile(file = join(APP_ROOT, '.env')) {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === '"' || value[0] === "'")) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function requireEnv(...names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) throw new Error(`missing env: ${missing.join(', ')}`);
}

/** libpq variables for a postgres:// URL, so pg_dump/psql never receive credentials in argv. */
export function pgEnvFromUrl(url) {
  const u = new URL(url);
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') throw new Error('DATABASE_URL is not a postgres URL');
  const env = {
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, '')),
  };
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  const sslmode = u.searchParams.get('sslmode');
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

/** Minimal child environment: PATH/locale plus the given extras; never the parent's R2 keys or DATABASE_URL. */
export function childEnv(extra = {}) {
  return { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8', ...extra };
}

const SECRET_NAMES = ['DATABASE_URL', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];

/** Replaces any known secret value (and the DATABASE_URL password) in a message. */
export function redact(message, env = process.env) {
  let out = String(message);
  const values = SECRET_NAMES.map((n) => env[n]).filter(Boolean);
  try {
    if (env.DATABASE_URL) {
      const u = new URL(env.DATABASE_URL);
      if (u.password) values.push(u.password, decodeURIComponent(u.password));
    }
  } catch { /* not a URL; nothing extra to hide */ }
  for (const v of values.sort((a, b) => b.length - a.length)) {
    if (v.length >= 4) out = out.split(v).join('[redacted]');
  }
  return out.replace(/postgres(?:ql)?:\/\/\S+/g, 'postgres://[redacted]');
}

export function log(message) {
  console.log(`${new Date().toISOString()} ${redact(message)}`);
}
