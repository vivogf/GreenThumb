import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

// The server keeps no logs that can name a user or a device (owner's decision, M9).
const ROOT = join(import.meta.dirname, '..', '..');
const NGINX = join(ROOT, 'deploy', 'nginx', 'greenthumb.conf');
const LOGROTATE = join(ROOT, 'deploy', 'logrotate', 'greenthumb');

/** Top-level `server { ... }` blocks of an nginx file, comments stripped. */
function serverBlocks(text) {
  const src = text.replace(/#.*$/gm, '');
  const blocks = [];
  const re = /(^|[\s;}])server\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
    }
    blocks.push(src.slice(start, i - 1));
    re.lastIndex = i;
  }
  return blocks;
}

/** Directives at depth 0 of a block body (not inside a location). */
function topLevel(body) {
  let depth = 0;
  let out = '';
  for (const ch of body) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (depth === 0) out += ch;
  }
  return out;
}

test('pm2 sends the app stdout and stderr to /dev/null', () => {
  const require = createRequire(import.meta.url);
  const app = require(join(ROOT, 'ecosystem.config.cjs')).apps.find((a) => a.name === 'greenthumb');
  assert.ok(app, 'the greenthumb app must exist');
  assert.equal(app.out_file, '/dev/null');
  assert.equal(app.error_file, '/dev/null');
  assert.equal(app.time, undefined, 'no log file, so no timestamp option');
});

test('every nginx server block turns off the access log and sends the error log to /dev/null', () => {
  const text = readFileSync(NGINX, 'utf8');
  const blocks = serverBlocks(text);
  assert.equal(blocks.length, 2, 'the port-80 redirect block and the 443 block');
  for (const body of blocks) {
    const top = topLevel(body);
    assert.match(top, /^\s*access_log\s+off\s*;/m);
    assert.match(top, /^\s*error_log\s+\/dev\/null\s*;/m);
  }
  const src = text.replace(/#.*$/gm, '');
  const access = src.match(/^\s*access_log\b[^;]*;/gm) ?? [];
  const errors = src.match(/^\s*error_log\b[^;]*;/gm) ?? [];
  assert.ok(access.every((d) => /access_log\s+off\s*;/.test(d)), 'no location may turn the access log back on');
  assert.ok(errors.every((d) => /error_log\s+\/dev\/null\s*;/.test(d)), 'no location may write an error log');
});

test('logrotate keeps the cron ops logs and drops the pm2 logs', () => {
  const text = readFileSync(LOGROTATE, 'utf8');
  assert.match(text, /^\/var\/log\/greenthumb-\*\.log \{/m);
  assert.doesNotMatch(text, /\.pm2/);
});
