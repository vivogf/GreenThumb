// Builds shared/season/tz-latitudes.json from IANA tzdata text (architecture §2.9). Pure functions; the CLI
// in ../gen-tz-latitudes.mjs reads the files and writes the result.

// Fixed-offset and POSIX-rule names carry no location; the season rule treats them as unknown.
const NON_GEOGRAPHIC = /^(Etc\/.*|GMT.*|UTC|UCT|Universal|Zulu|Greenwich|Factory|EST|MST|HST|EST5EDT|CST6CDT|MST7MDT|PST8PDT|WET|CET|MET|EET)$/;

export function isNonGeographic(id) {
  return NON_GEOGRAPHIC.test(id);
}

/** Latitude in decimal degrees (4 places) from an ISO 6709 `±DDMM±DDDMM` or `±DDMMSS±DDDMMSS` pair. */
export function parseLatitude(coord) {
  const m = /^([+-])(\d{2})(\d{2})(\d{2})?[+-]\d{5}(\d{2})?$/.exec(coord);
  if (!m) throw new Error(`bad coordinates: ${coord}`);
  const value = Number(m[2]) + Number(m[3]) / 60 + (m[4] ? Number(m[4]) / 3600 : 0);
  const rounded = Number(value.toFixed(4));
  return m[1] === '-' ? -rounded : rounded;
}

function dataLines(text) {
  return text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim() && !l.startsWith('#'));
}

/** zone.tab / zone1970.tab: columns country code(s), coordinates, TZ id, optional comment. */
export function parseZoneTable(text) {
  const out = new Map();
  for (const line of dataLines(text)) {
    const cols = line.split('\t');
    if (cols.length < 3) throw new Error(`bad table line: ${line}`);
    out.set(cols[2], parseLatitude(cols[1]));
  }
  return out;
}

/** `Link TARGET NAME [#= GEOGRAPHIC_TARGET]` lines (commented-out links are ignored). */
export function parseLinks(text) {
  const out = new Map();
  for (const line of text.split('\n')) {
    const m = /^Link\s+(\S+)\s+(\S+)(?:\s+#=\s*(\S+))?/.exec(line);
    if (m) out.set(m[2], { target: m[1], geo: m[3] ?? null });
  }
  return out;
}

export function parseZoneNames(text) {
  const out = new Set();
  for (const line of text.split('\n')) {
    const m = /^Zone\s+(\S+)/.exec(line);
    if (m) out.add(m[1]);
  }
  return out;
}

/**
 * Exact zone.tab coordinates win (they keep each place's own location), then zone1970.tab, then the
 * `#=` geographic link target, then the plain link target. zone1970 alone would merge places with equal
 * clocks: Antarctica/Syowa would get Riyadh (other hemisphere), Iceland would get Abidjan (tropics).
 */
export function resolveLatitude(id, { zoneTab, zone1970Tab, links }, seen = new Set()) {
  if (seen.has(id)) return undefined;
  seen.add(id);
  if (zoneTab.has(id)) return zoneTab.get(id);
  if (zone1970Tab.has(id)) return zone1970Tab.get(id);
  const link = links.get(id);
  if (!link) return undefined;
  for (const next of [link.geo, link.target]) {
    if (!next) continue;
    const lat = resolveLatitude(next, { zoneTab, zone1970Tab, links }, new Set(seen));
    if (lat !== undefined) return lat;
  }
  return undefined;
}

/**
 * @param {{version: string, zoneTab: string, zone1970Tab: string, sources: string[]}} input
 *   `sources` are the backward and regional files (Link and Zone lines).
 * @returns {{data: object, unresolved: string[]}}
 */
export function buildTzLatitudes({ version, zoneTab, zone1970Tab, sources }) {
  const tables = {
    zoneTab: parseZoneTable(zoneTab),
    zone1970Tab: parseZoneTable(zone1970Tab),
    links: new Map(),
  };
  const ids = new Set([...tables.zoneTab.keys(), ...tables.zone1970Tab.keys()]);
  for (const text of sources) {
    for (const [name, link] of parseLinks(text)) {
      tables.links.set(name, link);
      ids.add(name);
    }
    for (const name of parseZoneNames(text)) ids.add(name);
  }
  const zones = {};
  const unresolved = [];
  const sorted = [...ids].filter((id) => !isNonGeographic(id)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const id of sorted) {
    const lat = resolveLatitude(id, tables);
    if (lat === undefined) unresolved.push(id);
    else zones[id] = lat;
  }
  return {
    data: {
      tzdataVersion: version,
      source: 'IANA tzdata zone.tab, zone1970.tab and Link lines (backward + regional files)',
      generator: 'scripts/ops/gen-tz-latitudes.mjs',
      zones,
    },
    unresolved,
  };
}

export function serializeTzLatitudes(data) {
  return `${JSON.stringify(data, null, 2)}\n`;
}
