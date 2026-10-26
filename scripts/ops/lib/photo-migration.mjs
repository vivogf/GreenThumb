// Legacy base64 photo migration: plants.photo_url `data:...` -> R2 object + https URL.
import { createHash } from 'node:crypto';
import { parsePhotoDataUrl } from './photo-data-url.mjs';
import { newPhotoLocation } from './photo-keys.mjs';

const md5 = (s) => createHash('md5').update(s).digest('hex');

/** Database access used by the migration, over postgres-js. Rows are read one at a time to bound memory. */
export function plantsRepo(sql) {
  return {
    async profile() {
      const [r] = await sql`select
        count(*)::int as total,
        count(*) filter (where photo_url like 'data:%')::int as data,
        count(*) filter (where photo_url like 'https://greenthumb.xmpp.site/photos/%')::int as r2,
        count(*) filter (where photo_url = '')::int as empty,
        count(*) filter (where photo_url is null)::int as null,
        count(*) filter (where photo_url <> '' and photo_url not like 'data:%'
          and photo_url not like 'https://greenthumb.xmpp.site/photos/%')::int as other
        from plants`;
      return r;
    },
    async dataUrlIds() {
      return (await sql`select id from plants where photo_url like 'data:%' order by id`).map((r) => String(r.id));
    },
    async photoUrl(id) {
      const [r] = await sql`select photo_url from plants where id = ${id}`;
      return r ? r.photo_url : undefined;
    },
    /** Compare-and-set on the md5 of the old value, so a concurrent user edit is never overwritten. */
    async replace(id, oldValue, newValue) {
      const res = await sql`update plants set photo_url = ${newValue} where id = ${id} and md5(photo_url) = ${md5(oldValue)}`;
      return res.count === 1;
    },
  };
}

/**
 * @param {{repo: ReturnType<typeof plantsRepo>, store?: {put(key, bytes, mime): Promise<void>, delete(key): Promise<void>},
 *          publicBaseUrl: string, dryRun: boolean, log: (msg: string) => void, beforeWrite?: () => Promise<void>}} deps
 */
export async function runPhotoMigration({ repo, store, publicBaseUrl, dryRun, log, beforeWrite }) {
  const before = await repo.profile();
  const ids = await repo.dataUrlIds();
  const result = { before, toMigrate: 0, migrated: 0, invalid: [], changedConcurrently: [], skipped: before.total - before.data };

  const plan = [];
  for (const id of ids) {
    const value = await repo.photoUrl(id);
    if (typeof value !== 'string' || !value.startsWith('data:')) continue;
    const parsed = parsePhotoDataUrl(value);
    if (parsed) result.toMigrate += 1;
    else result.invalid.push(id);
    plan.push(id);
  }
  log(`photo profile before: total=${before.total} data=${before.data} r2=${before.r2} empty=${before.empty} null=${before.null} other=${before.other}`);
  log(`plan: to_migrate=${result.toMigrate} invalid=${result.invalid.length}${result.invalid.length ? ` invalid_ids=${result.invalid.join(',')}` : ''} skipped_non_data=${result.skipped}`);
  if (dryRun) {
    log('dry run: nothing changed');
    return result;
  }
  if (plan.length && beforeWrite) await beforeWrite();

  result.invalid = [];
  for (const id of plan) {
    const value = await repo.photoUrl(id);
    if (typeof value !== 'string' || !value.startsWith('data:')) continue;
    const parsed = parsePhotoDataUrl(value);
    if (!parsed) {
      if (await repo.replace(id, value, '')) {
        result.invalid.push(id);
        log(`invalid data URL cleared plant=${id}`);
      } else result.changedConcurrently.push(id);
      continue;
    }
    const { key, url } = newPhotoLocation(parsed.ext, publicBaseUrl);
    await store.put(key, parsed.bytes, parsed.mime);
    if (await repo.replace(id, value, url)) {
      result.migrated += 1;
      log(`migrated plant=${id} key=${key} bytes=${parsed.bytes.length}`);
    } else {
      await store.delete(key);
      result.changedConcurrently.push(id);
      log(`plant=${id} changed during migration; uploaded object ${key} removed`);
    }
  }
  result.after = await repo.profile();
  const a = result.after;
  log(`done: migrated=${result.migrated} invalid_cleared=${result.invalid.length}${result.invalid.length ? ` invalid_ids=${result.invalid.join(',')}` : ''} changed_concurrently=${result.changedConcurrently.length}`);
  log(`photo profile after: total=${a.total} data=${a.data} r2=${a.r2} empty=${a.empty} null=${a.null} other=${a.other}`);
  return result;
}
