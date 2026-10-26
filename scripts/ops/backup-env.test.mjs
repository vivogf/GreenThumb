import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pgEnvFromUrl, redact, childEnv } from './lib/env.mjs';
import { backupKey, dailyKey } from './lib/backup-job.mjs';

test('pgEnvFromUrl maps a URL to libpq variables', () => {
  assert.deepEqual(pgEnvFromUrl('postgres://app:p%40ss@127.0.0.1:5432/greenthumb'), {
    PGHOST: '127.0.0.1', PGPORT: '5432', PGUSER: 'app', PGPASSWORD: 'p@ss', PGDATABASE: 'greenthumb',
  });
  assert.equal(pgEnvFromUrl('postgresql://u:x@h/db?sslmode=require').PGSSLMODE, 'require');
  assert.throws(() => pgEnvFromUrl('mysql://u:x@h/db'));
});

test('redact hides the URL, its password and R2 keys', () => {
  const env = {
    DATABASE_URL: 'postgres://app:sup3rsecret@127.0.0.1:5432/greenthumb',
    R2_ACCESS_KEY_ID: 'AKIDEXAMPLE123',
    R2_SECRET_ACCESS_KEY: 'shhhhhhhh',
  };
  const msg = redact('failed sup3rsecret AKIDEXAMPLE123 shhhhhhhh postgres://other:pw@x/y', env);
  for (const s of ['sup3rsecret', 'AKIDEXAMPLE123', 'shhhhhhhh', 'other:pw']) assert.ok(!msg.includes(s), s);
});

test('childEnv never inherits secrets', () => {
  const env = childEnv({ PGDATABASE: 'x' });
  assert.deepEqual(Object.keys(env).sort(), ['LANG', 'PATH', 'PGDATABASE']);
});

test('backup keys use compact UTC timestamps', () => {
  const d = new Date(Date.UTC(2026, 9, 26, 7, 17, 3));
  assert.equal(backupKey('hourly', d), 'hourly/greenthumb-20261026T071703Z.dump');
  assert.equal(backupKey('pre-migration', d), 'pre-migration/greenthumb-20261026T071703Z.dump');
  assert.equal(dailyKey(d), 'daily/greenthumb-20261026.dump');
  assert.match(backupKey('hourly', d), /^hourly\/greenthumb-\d{8}T\d{6}Z\.dump$/);
});
