// Pure retention selection for the greenthumb-backups bucket. No network, no env.

export const RETENTION_LIMITS = Object.freeze({
  'hourly/': 48,
  'daily/': 14,
  'pre-migration/': 10,
});

const COMPACT_TS = /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/;
const DASHED_TS = /(\d{4})-(\d{2})-(\d{2})T(\d{2})[-:](\d{2})[-:](\d{2})Z/;
const DATE_ONLY = /(?<!\d)(\d{4})(\d{2})(\d{2})(?![\dT])/;

/** UTC epoch ms encoded in a backup key, or null when the key carries no timestamp. */
export function keyTimestamp(key) {
  const m = COMPACT_TS.exec(key) ?? DASHED_TS.exec(key);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const d = DATE_ONLY.exec(key);
  if (d) return Date.UTC(+d[1], +d[2] - 1, +d[3]);
  return null;
}

function normalize(entry) {
  return typeof entry === 'string' ? { key: entry } : entry;
}

function objectTime(obj) {
  const fromKey = keyTimestamp(obj.key);
  if (fromKey !== null) return fromKey;
  const lm = obj.lastModified ? new Date(obj.lastModified).getTime() : NaN;
  return Number.isNaN(lm) ? 0 : lm;
}

/** Newest first; equal times are ordered by key so the result never depends on input order. */
function newestFirst(a, b) {
  const diff = objectTime(b) - objectTime(a);
  if (diff !== 0) return diff;
  return a.key < b.key ? 1 : a.key > b.key ? -1 : 0;
}

/**
 * @param {Array<string | {key: string, lastModified?: Date|string}>} objects
 * @param {Record<string, number>} limits prefix -> number of newest objects to keep
 * @returns {string[]} keys to delete, sorted. Keys outside the configured prefixes are never selected.
 */
export function selectForDeletion(objects, limits = RETENTION_LIMITS) {
  const all = objects.map(normalize);
  const doomed = [];
  for (const [prefix, keep] of Object.entries(limits)) {
    const group = all.filter((o) => o.key.startsWith(prefix)).sort(newestFirst);
    doomed.push(...group.slice(keep).map((o) => o.key));
  }
  return doomed.sort();
}

/** Newest key under a prefix, or null. */
export function newestKey(objects, prefix) {
  const group = objects.map(normalize).filter((o) => o.key.startsWith(prefix)).sort(newestFirst);
  return group.length ? group[0].key : null;
}
