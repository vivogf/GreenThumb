import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTzLatitudes,
  isNonGeographic,
  parseLatitude,
  parseLinks,
  serializeTzLatitudes,
} from './lib/tz-latitudes.mjs';

const ZONE_TAB = [
  '# comment',
  'IS\t+6409-02151\tAtlantic/Reykjavik',
  'AQ\t-690022+0393524\tAntarctica/Syowa\tSyowa',
  'SA\t+2438+04643\tAsia/Riyadh',
  'CI\t+0519-00402\tAfrica/Abidjan',
  'IN\t+2232+08822\tAsia/Kolkata',
].join('\n');
const ZONE1970 = [
  'SA,AQ,KW,YE\t+2438+04643\tAsia/Riyadh\tSyowa',
  'CI,IS\t+0519-00402\tAfrica/Abidjan',
  'IN\t+2232+08822\tAsia/Kolkata',
].join('\n');
const BACKWARD = [
  'Link\tAfrica/Abidjan\t\tIceland\t#= Atlantic/Reykjavik',
  'Link\tAfrica/Abidjan\t\tAtlantic/Reykjavik',
  'Link\tAsia/Riyadh\t\tAntarctica/Syowa',
  'Link\tAsia/Kolkata\t\tAsia/Calcutta',
  'Link\tEtc/UTC\t\tUTC',
  'Link\tEtc/GMT\t\tGMT',
  '#Link\tGMT\t\tEtc/GMT0',
  'Link\tAmerica/Panama\t\tEST',
].join('\n');
const ETC = ['Zone\tEtc/UTC\t0\t-\tUTC', 'Zone\tEtc/GMT+5\t-5\t-\t-05'].join('\n');

const build = () => buildTzLatitudes({ version: '2099z', zoneTab: ZONE_TAB, zone1970Tab: ZONE1970, sources: [BACKWARD, ETC] });

test('parseLatitude reads DDMM and DDMMSS forms with sign', () => {
  assert.equal(parseLatitude('+6409-02151'), 64.15);
  assert.equal(parseLatitude('-690022+0393524'), -69.0061);
  assert.equal(parseLatitude('+0519-00402'), 5.3167);
  assert.throws(() => parseLatitude('64.15'));
});

test('parseLinks ignores commented links and keeps the #= target', () => {
  const links = parseLinks(BACKWARD);
  assert.deepEqual(links.get('Iceland'), { target: 'Africa/Abidjan', geo: 'Atlantic/Reykjavik' });
  assert.equal(links.has('Etc/GMT0'), false);
});

test('exact zone.tab coordinates win over links', () => {
  const { zones } = build().data;
  assert.equal(zones['Antarctica/Syowa'], -69.0061);
  assert.equal(zones['Atlantic/Reykjavik'], 64.15);
});

test('#= geographic target wins over the clock link', () => {
  assert.equal(build().data.zones.Iceland, 64.15);
});

test('plain aliases resolve through their link', () => {
  assert.equal(build().data.zones['Asia/Calcutta'], 22.5333);
});

test('fixed and abbreviation zones are left out', () => {
  const { zones } = build().data;
  for (const id of ['UTC', 'GMT', 'Etc/UTC', 'Etc/GMT+5', 'EST']) assert.equal(id in zones, false, id);
  assert.equal(isNonGeographic('Etc/GMT-14'), true);
  assert.equal(isNonGeographic('Europe/Moscow'), false);
  assert.equal(isNonGeographic('Singapore'), false);
});

test('output is sorted, versioned and stable', () => {
  const a = serializeTzLatitudes(build().data);
  const b = serializeTzLatitudes(build().data);
  assert.equal(a, b);
  const parsed = JSON.parse(a);
  assert.equal(parsed.tzdataVersion, '2099z');
  const keys = Object.keys(parsed.zones);
  assert.deepEqual(keys, [...keys].sort());
  assert.ok(a.endsWith('}\n'));
});
