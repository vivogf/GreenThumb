import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CRON = join(import.meta.dirname, '..', '..', 'deploy', 'cron', 'greenthumb.cron');

test('the push cron logs only a timestamp and the HTTP status, never the response body', () => {
  const lines = readFileSync(CRON, 'utf8').split('\n').filter((l) => l.includes('/api/push/check-plants'));
  assert.equal(lines.length, 1);
  const line = lines[0];
  assert.match(line, /-o \/dev\/null/, 'the response body must be discarded');
  assert.match(line, /%\{http_code\}/, 'the HTTP status must be written');
  assert.match(line, /date /, 'each log line needs a timestamp');
  assert.match(line, />> \/var\/log\/greenthumb-push\.log 2>&1$/);
  assert.doesNotMatch(line, /-w '\\n'/, 'the old body-plus-newline form must be gone');
  // cron turns an unescaped % into a newline and cuts the command there.
  assert.doesNotMatch(line, /(^|[^\\])%/, 'every % must be written as \\%');
});
