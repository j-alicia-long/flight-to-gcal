#!/usr/bin/env node
/**
 * Generates data/airport-timezones.js — an IATA → IANA timezone map —
 * from the OpenFlights airports database.
 *
 * This is a DEVELOPMENT-TIME script. The extension itself never makes
 * network calls; the generated file is committed to the repo.
 *
 * Usage:
 *   node tools/generate-airport-timezones.js
 *
 * Data source:
 *   https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat
 *   Columns: id, name, city, country, IATA, ICAO, lat, lon, alt,
 *            utc_offset, dst, tz_database_time_zone, type, source
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const SOURCE_URL = 'https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat';
const OUT_PATH = path.join(__dirname, '..', 'data', 'airport-timezones.js');

// Airports missing or stale in OpenFlights (e.g. IST moved to the new
// Istanbul Airport in 2019; DOH has no tz row). Applied after parsing.
const OVERRIDES = {
  DOH: 'Asia/Qatar',
  IST: 'Europe/Istanbul'
};

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

// Minimal CSV line parser that handles quoted fields with embedded commas.
function parseCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(cur);
      cur = '';
    } else cur += ch;
  }
  fields.push(cur);
  return fields;
}

async function main() {
  console.log(`Fetching ${SOURCE_URL} ...`);
  const csv = await fetch(SOURCE_URL);
  const map = {};
  let rows = 0;

  for (const line of csv.split('\n')) {
    if (!line.trim()) continue;
    const f = parseCsvLine(line);
    if (f.length < 12) continue;
    const iata = f[4].replace(/\\N|"/g, '').trim();
    const tz = f[11].replace(/\\N|"/g, '').trim();
    // Keep only 3-letter IATA codes with a real IANA zone (contains '/')
    if (!/^[A-Z]{3}$/.test(iata)) continue;
    if (!tz.includes('/')) continue;
    map[iata] = tz;
    rows++;
  }

  Object.assign(map, OVERRIDES);

  const sorted = Object.keys(map).sort();
  const lines = sorted.map((k) => `  "${k}": "${map[k]}"`);
  const out = `/**
 * IATA airport code → IANA timezone map.
 * GENERATED FILE — do not edit by hand.
 * Regenerate with: node tools/generate-airport-timezones.js
 * Source: OpenFlights airports database (https://openflights.org/data.php)
 */

const AIRPORT_TIMEZONES = {
${lines.join(',\n')}
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AIRPORT_TIMEZONES;
}
`;

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, out);
  console.log(`Wrote ${sorted.length} airports (${rows} rows matched) to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
