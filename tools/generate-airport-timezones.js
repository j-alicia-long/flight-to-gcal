#!/usr/bin/env node
/**
 * Generates two data files from the OpenFlights airports database:
 *   - data/airport-timezones.js — IATA → IANA timezone map
 *   - data/airport-names.js — normalized airport/city name → IATA lookup
 *
 * This is a DEVELOPMENT-TIME script. The extension itself never makes
 * network calls; the generated files are committed to the repo.
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
const NAMES_OUT_PATH = path.join(__dirname, '..', 'data', 'airport-names.js');

// Airports missing or stale in OpenFlights (e.g. IST moved to the new
// Istanbul Airport in 2019; DOH has no tz row). Applied after parsing.
const OVERRIDES = {
  DOH: 'Asia/Qatar',
  IST: 'Europe/Istanbul',
  BER: 'Europe/Berlin'
};

// ─── Name-lookup generation ───────────────────────────────────────────────────

// Words stripped (repeatedly) from the end of airport names to form short keys:
// "Chicago O'Hare International Airport" → "Chicago O'Hare"
const NAME_SUFFIXES = [
  'AIRPORT', 'INTERNATIONAL', 'INTL', 'REGIONAL', 'MUNICIPAL', 'NATIONAL',
  'DOMESTIC', 'AIRFIELD', 'AIRBASE', 'AIR BASE', 'AIR FIELD', 'FIELD', 'STATION'
];

// Normalized keys never emitted — airline names and generic words that would
// cause false positives when scanning confirmation text ("DELTA 1642" must
// not match Delta Municipal Airport).
const KEY_BLOCKLIST = new Set([
  'DELTA', 'UNITED', 'AMERICAN', 'SOUTHWEST', 'JETBLUE', 'SPIRIT', 'FRONTIER',
  'ALASKA', 'HAWAIIAN', 'EMIRATES', 'QANTAS', 'SWISS', 'AUSTRIAN', 'VIRGIN',
  'IBERIA', 'FINNAIR', 'RYANAIR', 'EASYJET', 'AVIANCA', 'VOLARIS', 'ALLEGIANT',
  'BREEZE', 'NORSE', 'KOREAN', 'ETIHAD', 'QATAR', 'TURKISH', 'SINGAPORE',
  'CATHAY', 'LUFTHANSA', 'WESTJET', 'AEROMEXICO', 'LATAM', 'AIRFRANCE',
  'AIRCANADA', 'AIRINDIA', 'CENTRAL', 'NORTH', 'SOUTH', 'EAST', 'WEST',
  'ISLAND', 'BEACH', 'SPRINGS', 'JUNCTION', 'VALLEY', 'MOUNTAIN'
]);

// Well-known airport nicknames the OpenFlights names don't produce on their own.
const NAME_ALIASES = {
  OHARE: 'ORD', KENNEDY: 'JFK', LAGUARDIA: 'LGA', HEATHROW: 'LHR',
  GATWICK: 'LGW', STANSTED: 'STN', DULLES: 'IAD', REAGAN: 'DCA',
  REAGANNATIONAL: 'DCA', MIDWAY: 'MDW', HOBBY: 'HOU', LOVEFIELD: 'DAL',
  SEATAC: 'SEA', SKYHARBOR: 'PHX', LOGAN: 'BOS', HARTSFIELD: 'ATL',
  HANEDA: 'HND', NARITA: 'NRT', CHANGI: 'SIN', SCHIPHOL: 'AMS',
  DEGAULLE: 'CDG', CHARLESDEGAULLE: 'CDG', ORLY: 'ORY', PEARSON: 'YYZ',
  TRUDEAU: 'YUL', BARAJAS: 'MAD', ELPRAT: 'BCN', FIUMICINO: 'FCO',
  GUARULHOS: 'GRU', GALEAO: 'GIG', BENGURION: 'TLV', INCHEON: 'ICN',
  SUVARNABHUMI: 'BKK', INDIRAGANDHI: 'DEL', ATATURK: 'IST',
  // Major metros → primary airport (mirrors parser's CITY_TO_AIRPORT choices).
  // Genuinely ambiguous metros (NYC) are deliberately absent.
  LOSANGELES: 'LAX', CHICAGO: 'ORD', NEWYORK: 'JFK', WASHINGTON: 'DCA',
  DALLAS: 'DFW', HOUSTON: 'IAH', SEATTLE: 'SEA', ATLANTA: 'ATL',
  DENVER: 'DEN', MIAMI: 'MIA', ORLANDO: 'MCO', LASVEGAS: 'LAS',
  PHOENIX: 'PHX', MINNEAPOLIS: 'MSP', DETROIT: 'DTW', PHILADELPHIA: 'PHL',
  BALTIMORE: 'BWI', SALTLAKECITY: 'SLC', SANDIEGO: 'SAN', TAMPA: 'TPA',
  NASHVILLE: 'BNA', AUSTIN: 'AUS', STLOUIS: 'STL', SAINTLOUIS: 'STL',
  HONOLULU: 'HNL', OAKLAND: 'OAK', SANJOSE: 'SJC', KANSASCITY: 'MCI',
  CLEVELAND: 'CLE', SACRAMENTO: 'SMF', INDIANAPOLIS: 'IND',
  PITTSBURGH: 'PIT', COLUMBUS: 'CMH', SANANTONIO: 'SAT', PORTLAND: 'PDX',
  MILWAUKEE: 'MKE', RALEIGH: 'RDU', FORTLAUDERDALE: 'FLL',
  LONDON: 'LHR', PARIS: 'CDG', TOKYO: 'HND', TORONTO: 'YYZ',
  SYDNEY: 'SYD', MELBOURNE: 'MEL', ROMEITALY: 'FCO', MILAN: 'MXP',
  BEIJING: 'PEK', SHANGHAI: 'PVG', SAOPAULO: 'GRU', MEXICOCITY: 'MEX',
  MONTREAL: 'YUL', VANCOUVER: 'YVR', MADRID: 'MAD', BARCELONA: 'BCN',
  BERLIN: 'BER', MUNICH: 'MUC', FRANKFURT: 'FRA', AMSTERDAM: 'AMS',
  ZURICH: 'ZRH', VIENNA: 'VIE', ISTANBUL: 'IST', DUBAI: 'DXB',
  HONGKONG: 'HKG', BANGKOK: 'BKK', SEOUL: 'ICN', TAIPEI: 'TPE',
  MUMBAI: 'BOM', NEWDELHI: 'DEL', JOHANNESBURG: 'JNB',
  BUENOSAIRES: 'EZE', SANTIAGO: 'SCL', AUCKLAND: 'AKL'
};

const MIN_KEY_LENGTH = 5;

/** Uppercase, strip accents and everything non-alphanumeric. */
function normalizeKey(str) {
  return str
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** "Chicago O'Hare International Airport" → "Chicago O'Hare" */
function stripSuffixes(name) {
  let n = name.trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of NAME_SUFFIXES) {
      const re = new RegExp('\\s+' + suf.replace(' ', '\\s+') + '$', 'i');
      if (re.test(n)) { n = n.replace(re, ''); changed = true; }
    }
  }
  return n;
}

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

/**
 * Builds the normalized-name → IATA lookup.
 * Keys are emitted for: full airport name, suffix-stripped name, and
 * city+strippedName compound. Keys that collide across different airports
 * are dropped entirely (ambiguous). Curated aliases are applied last.
 */
function buildNameLookup(airports) {
  const lookup = {};
  const ambiguous = new Set();
  // City keys handled separately: only cities with exactly one airport qualify.
  const cityCandidates = {}; // normalized city → Set of IATA codes

  // Pass 1: collect city → airports so ambiguous city names (e.g. LONDON,
  // shared by Heathrow/Gatwick/London-Ontario) can block name-derived keys
  // like "London Airport" → LONDON → YXU.
  for (const { iata, city } of airports) {
    if (!city) continue;
    const cityKey = normalizeKey(city);
    if (cityKey.length >= MIN_KEY_LENGTH) {
      (cityCandidates[cityKey] ||= new Set()).add(iata);
    }
  }
  for (const [cityKey, codes] of Object.entries(cityCandidates)) {
    if (codes.size > 1) ambiguous.add(cityKey);
  }

  const addKey = (key, iata) => {
    if (key.length < MIN_KEY_LENGTH) return;
    if (KEY_BLOCKLIST.has(key)) return;
    if (ambiguous.has(key)) return;
    if (lookup[key] && lookup[key] !== iata) {
      delete lookup[key];
      ambiguous.add(key);
      return;
    }
    lookup[key] = iata;
  };

  for (const { iata, name, city } of airports) {
    const fullKey = normalizeKey(name);
    const stripped = stripSuffixes(name);
    const strippedKey = normalizeKey(stripped);
    addKey(fullKey, iata);
    addKey(strippedKey, iata);

    if (city) {
      const cityKey = normalizeKey(city);
      // "New York" + "La Guardia" → NEWYORKLAGUARDIA (matches "New York-LaGuardia")
      if (cityKey && !strippedKey.startsWith(cityKey)) {
        addKey(cityKey + strippedKey, iata);
      }
    }
  }

  // City name keys — only when the city unambiguously has one airport.
  for (const [cityKey, codes] of Object.entries(cityCandidates)) {
    if (codes.size === 1 && !ambiguous.has(cityKey) && !KEY_BLOCKLIST.has(cityKey) && !lookup[cityKey]) {
      lookup[cityKey] = codes.values().next().value;
    }
  }

  for (const [alias, code] of Object.entries(NAME_ALIASES)) {
    lookup[alias] = code;
  }

  return lookup;
}

async function main() {
  console.log(`Fetching ${SOURCE_URL} ...`);
  const csv = await fetch(SOURCE_URL);
  const map = {};
  const airports = [];
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
    const name = f[1].replace(/\\N/g, '').trim();
    const city = f[2].replace(/\\N/g, '').trim();
    if (name) airports.push({ iata, name, city });
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

  // Name lookup — only airports that made it into the timezone map.
  const lookup = buildNameLookup(airports.filter((a) => map[a.iata]));
  const nameKeys = Object.keys(lookup).sort();
  const nameLines = nameKeys.map((k) => `  "${k}": "${lookup[k]}"`);
  const namesOut = `/**
 * Normalized airport/city name → IATA code lookup.
 * Keys are uppercased with all non-alphanumerics stripped
 * (e.g. "Chicago O'Hare" → "CHICAGOOHARE").
 * GENERATED FILE — do not edit by hand.
 * Regenerate with: node tools/generate-airport-timezones.js
 * Source: OpenFlights airports database (https://openflights.org/data.php)
 */

const AIRPORT_NAMES = {
${nameLines.join(',\n')}
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AIRPORT_NAMES;
}
`;
  fs.writeFileSync(NAMES_OUT_PATH, namesOut);
  console.log(`Wrote ${nameKeys.length} name keys to ${NAMES_OUT_PATH}`);

  // Sanity checks for the user-reported Delta format.
  const checks = [
    ['CHICAGOOHARE', 'ORD'],
    ['LAGUARDIA', 'LGA'],
    ['HEATHROW', 'LHR'],
    ['LOSANGELES', 'LAX']
  ];
  for (const [key, expected] of checks) {
    const got = lookup[key];
    console.log(`  check ${key} → ${got} ${got === expected ? 'OK' : `EXPECTED ${expected}`}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
