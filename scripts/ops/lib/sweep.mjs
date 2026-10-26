// Orphan photo sweep: which R2 objects no DB row references.
import { isPhotoKey, keyForPhotoUrl } from './photo-keys.mjs';

export const DEFAULT_MIN_AGE_HOURS = 24;

/**
 * Every source of photo references. A table that does not exist yet (plant_photos before its migration)
 * is skipped; any other query error aborts the sweep, so a partial reference set never deletes anything.
 */
export const REFERENCE_SOURCES = Object.freeze([
  { table: 'plants', column: 'photo_url', kind: 'url' },
  { table: 'plant_photos', column: 'object_key', kind: 'key' },
  { table: 'plant_photos', column: 'url', kind: 'url' },
]);

/** Turns raw column values into the set of referenced R2 keys. */
export function referencedKeySet(rows, publicBaseUrl) {
  const keys = new Set();
  for (const { kind, value } of rows) {
    const key = kind === 'key' ? (isPhotoKey(value) ? value : null) : keyForPhotoUrl(value, publicBaseUrl);
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * Pure selection. An object is an orphan candidate when its key is an app photo key, no row references it,
 * and its LastModified is at least minAgeHours before now. Objects without LastModified are never selected.
 * @param {Array<{key: string, lastModified?: Date}>} objects
 * @param {Set<string>} referenced
 * @returns {string[]} sorted keys
 */
export function selectOrphans(objects, referenced, { now = new Date(), minAgeHours = DEFAULT_MIN_AGE_HOURS } = {}) {
  if (!Number.isFinite(minAgeHours) || minAgeHours < 0) throw new Error(`invalid minAgeHours: ${minAgeHours}`);
  const cutoff = now.getTime() - minAgeHours * 3600_000;
  return objects
    .filter((o) => isPhotoKey(o.key) && !referenced.has(o.key))
    .filter((o) => o.lastModified instanceof Date && !Number.isNaN(o.lastModified.getTime()) && o.lastModified.getTime() <= cutoff)
    .map((o) => o.key)
    .sort();
}

/** Reads every reference column with postgres-js. */
export async function loadReferenceRows(sql) {
  const rows = [];
  for (const { table, column, kind } of REFERENCE_SOURCES) {
    const [{ exists }] = await sql`select to_regclass(${'public.' + table}) is not null as exists`;
    if (!exists) continue;
    const values = await sql`select ${sql(column)} as value from ${sql(table)} where ${sql(column)} is not null and ${sql(column)} <> ''`;
    for (const r of values) rows.push({ kind, value: r.value });
  }
  return rows;
}

export function parseSweepArgs(argv) {
  const opts = { dryRun: false, minAgeHours: DEFAULT_MIN_AGE_HOURS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--min-age-hours' || a.startsWith('--min-age-hours=')) {
      const raw = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];
      const n = Number(raw);
      if (raw === undefined || raw === '' || !Number.isFinite(n) || n < 0) throw new Error(`--min-age-hours needs a number >= 0, got: ${raw}`);
      opts.minAgeHours = n;
    } else throw new Error(`unknown argument: ${a}`);
  }
  return opts;
}
