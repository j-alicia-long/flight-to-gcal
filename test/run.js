#!/usr/bin/env node
/**
 * Test runner — no dependencies. Run with: node test/run.js
 *
 * Covers:
 *  1. Parser extraction on realistic airline confirmation samples
 *  2. Timezone conversion math (DST summer/winter, spring-forward, non-DST zones)
 *  3. Event building: durations, overnight rollover, estimated arrivals
 *  4. Google Calendar URL and .ics output formats
 *  5. Airport timezone dataset coverage
 */

const fs = require('fs');
const path = require('path');

const FlightParser = require('../content/parser.js');
const FlightTz = require('../lib/timezone.js');
const FlightCalendar = require('../lib/calendar.js');
const FlightAI = require('../popup/ai-fallback.js');
const AIRPORT_TIMEZONES = require('../data/airport-timezones.js');
const AIRPORT_NAMES = require('../data/airport-names.js');

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}`);
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      actual:   ${JSON.stringify(actual)}`);
  }
}

function sample(name) {
  return fs.readFileSync(path.join(__dirname, 'samples', name), 'utf8');
}

// ─── 1. Parser: airline samples ───────────────────────────────────────────────

console.log('\nParser: Delta sample');
{
  const segs = FlightParser.parseEmail(sample('delta.txt'), 'Your Flight Receipt');
  check('one leg', segs.length, 1);
  const s = segs[0] || {};
  check('flight number', s.flightNumber, 'DL 423');
  check('airline', s.airlineName, 'Delta Air Lines');
  check('date', s.date, '2026-06-15');
  check('route', [s.departure, s.arrival], ['JFK', 'LAX']);
  check('times', [s.departureTime, s.arrivalTime], ['08:00', '11:15']);
  check('confirmation', s.confirmationCode, 'GKXR4T');
}

console.log('\nParser: United multi-leg sample');
{
  const segs = FlightParser.parseEmail(sample('united.txt'), 'eTicket Itinerary and Receipt');
  check('two legs', segs.length, 2);
  const [a, b] = segs;
  check('leg 1 flight', a && a.flightNumber, 'UA 1989');
  check('leg 1 route', a && [a.departure, a.arrival], ['ORD', 'DEN']);
  check('leg 1 times', a && [a.departureTime, a.arrivalTime], ['06:45', '09:12']);
  check('leg 1 date', a && a.date, '2026-09-08');
  check('leg 2 flight', b && b.flightNumber, 'UA 522');
  check('leg 2 route', b && [b.departure, b.arrival], ['DEN', 'SFO']);
  check('leg 2 times', b && [b.departureTime, b.arrivalTime], ['10:30', '12:05']);
  check('confirmation', a && a.confirmationCode, 'KX9P2L');
}

console.log('\nParser: American sample');
{
  const segs = FlightParser.parseEmail(sample('american.txt'), 'Your trip confirmation');
  check('one leg', segs.length, 1);
  const s = segs[0] || {};
  check('flight number', s.flightNumber, 'AA 1402');
  check('date', s.date, '2026-11-20');
  check('route', [s.departure, s.arrival], ['MIA', 'BOS']);
  check('times (PM)', [s.departureTime, s.arrivalTime], ['17:37', '21:04']);
  check('record locator', s.confirmationCode, 'HTWBNZ');
}

console.log('\nParser: Southwest sample (bare flight number)');
{
  const segs = FlightParser.parseEmail(sample('southwest.txt'), "You're all set! Flight reservation");
  check('one leg', segs.length, 1);
  const s = segs[0] || {};
  check('flight number', s.flightNumber, 'WN 2210');
  check('date', s.date, '2026-10-17');
  check('route', [s.departure, s.arrival], ['BWI', 'HOU']);
  check('times', [s.departureTime, s.arrivalTime], ['07:20', '09:55']);
}

console.log('\nParser: flight confirmation detection');
{
  check('delta detected', FlightParser.isFlightConfirmation('Your Flight Receipt', sample('delta.txt')), true);
  check('unrelated not detected', FlightParser.isFlightConfirmation('Lunch tomorrow?', 'See you at noon at the corner cafe.'), false);
}

console.log('\nParser: Delta columnar sample (real-world, airport names not codes)');
{
  // Verbatim paste that originally failed: city/airport NAMES, tab-separated
  // columns, compact "28SEP" date with no year.
  const segs = FlightParser.parseEmail(sample('delta-columnar.txt'));
  check('one leg', segs.length, 1);
  const s = segs[0] || {};
  check('flight number', s.flightNumber, 'DL 1642');
  check('airline', s.airlineName, 'Delta Air Lines');
  check('route resolved from names', [s.departure, s.arrival], ['ORD', 'LGA']);
  check('times', [s.departureTime, s.arrivalTime], ['09:30', '12:49']);
  // Year is inferred: current year, or next year if Sep 28 is >2 days past.
  const now = new Date();
  const expYear = new Date(now.getFullYear(), 8, 28) < new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2)
    ? now.getFullYear() + 1 : now.getFullYear();
  check('date with inferred year', s.date, `${expYear}-09-28`);

  // The point of the fix: correct timezones on both ends.
  const res = FlightCalendar.flightToEvent(s);
  check('event ok', res.ok, true);
  check('dep tz America/Chicago', res.event.depTz, 'America/Chicago');
  check('arr tz America/New_York', res.event.arrTz, 'America/New_York');
  // 09:30 CDT = 14:30Z, 12:49 EDT = 16:49Z → 2h19m in the air.
  check('duration 2h19m', Math.round((res.event.endUtc - res.event.startUtc) / 60000), 139);
}

console.log('\nParser: airport name → IATA resolution');
{
  check('CHICAGO-OHARE', FlightParser.resolveAirport('CHICAGO-OHARE'), 'ORD');
  check('NYC-LAGUARDIA', FlightParser.resolveAirport('NYC-LAGUARDIA'), 'LGA');
  check('Heathrow', FlightParser.resolveAirport('Heathrow'), 'LHR');
  check("Chicago O'Hare International Airport", FlightParser.resolveAirport("Chicago O'Hare International Airport"), 'ORD');
  check('bare IATA code passes through', FlightParser.resolveAirport('jfk'), 'JFK');
  check('city alias Los Angeles', FlightParser.resolveAirport('Los Angeles'), 'LAX');
  check('unknown gibberish → null', FlightParser.resolveAirport('Not An Airport Anywhere'), null);
  check('lookup only contains airports with timezones',
    Object.values(AIRPORT_NAMES).filter(code => !AIRPORT_TIMEZONES[code]), []);
}

console.log('\nParser: loose date/time helpers');
{
  const now = new Date();
  const expYear = new Date(now.getFullYear(), 8, 28) < new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2)
    ? now.getFullYear() + 1 : now.getFullYear();
  check('28SEP infers year', FlightParser.parseDateText('28SEP'), `${expYear}-09-28`);
  check('28SEP26 explicit short year', FlightParser.parseDateText('28SEP26'), '2026-09-28');
  check('full date still works', FlightParser.parseDateText('June 15, 2026'), '2026-06-15');
  check('12:49PM no space', FlightParser.normalizeTimeText('12:49PM'), '12:49');
  check('9:05 am', FlightParser.normalizeTimeText('9:05 am'), '09:05');
  check('12:15 AM → 00:15', FlightParser.normalizeTimeText('12:15 AM'), '00:15');
  check('24h passthrough', FlightParser.normalizeTimeText('18:40'), '18:40');
}

console.log('\nAI fallback: deterministic normalization of model output');
{
  // Simulates what Gemini Nano returns (strings as written in the email);
  // normalizeFlights must resolve names/dates/times with the SAME pipeline
  // as the regex parser — the model never produces timezones or UTC.
  const segs = FlightAI.normalizeFlights([{
    airline: 'Delta', flightNumber: '1642', date: 'Mon, 28SEP',
    departureAirport: 'CHICAGO-OHARE', arrivalAirport: 'NYC-LAGUARDIA',
    departureTime: '09:30AM', arrivalTime: '12:49PM'
  }]);
  check('one flight', segs.length, 1);
  const s = segs[0] || {};
  check('airline code from name', s.airlineCode, 'DL');
  check('flight number assembled', s.flightNumber, 'DL 1642');
  check('airports resolved', [s.departure, s.arrival], ['ORD', 'LGA']);
  check('times normalized', [s.departureTime, s.arrivalTime], ['09:30', '12:49']);
  check('tagged as AI', s.source, 'ai');

  check('empty fields tolerated',
    FlightAI.normalizeFlights([{ airline: '', flightNumber: '', date: '', departureAirport: '', arrivalAirport: '', departureTime: '', arrivalTime: '' }]),
    []);
}

console.log('\nAI fallback: trigger conditions');
{
  check('empty parse triggers', FlightAI.isIncomplete([]), true);
  check('missing airports triggers',
    FlightAI.isIncomplete([{ departure: null, arrival: 'LGA', date: '2026-09-28', departureTime: '09:30' }]), true);
  check('missing date triggers',
    FlightAI.isIncomplete([{ departure: 'ORD', arrival: 'LGA', date: null, departureTime: '09:30' }]), true);
  check('complete parse does not trigger',
    FlightAI.isIncomplete([{ departure: 'ORD', arrival: 'LGA', date: '2026-09-28', departureTime: '09:30', arrivalTime: '12:49' }]), false);
}

// ─── 2. Timezone conversion ───────────────────────────────────────────────────

console.log('\nTimezone: zonedTimeToUtc');
{
  check('JFK summer (EDT, UTC-4)',
    FlightTz.zonedTimeToUtc('2026-06-15', '08:00', 'America/New_York').toISOString(),
    '2026-06-15T12:00:00.000Z');
  check('JFK winter (EST, UTC-5)',
    FlightTz.zonedTimeToUtc('2026-01-15', '08:00', 'America/New_York').toISOString(),
    '2026-01-15T13:00:00.000Z');
  check('LAX summer (PDT, UTC-7)',
    FlightTz.zonedTimeToUtc('2026-06-15', '11:15', 'America/Los_Angeles').toISOString(),
    '2026-06-15T18:15:00.000Z');
  check('Tokyo (JST, UTC+9, no DST)',
    FlightTz.zonedTimeToUtc('2026-06-15', '14:00', 'Asia/Tokyo').toISOString(),
    '2026-06-15T05:00:00.000Z');
  check('London summer (BST, UTC+1)',
    FlightTz.zonedTimeToUtc('2026-07-01', '09:30', 'Europe/London').toISOString(),
    '2026-07-01T08:30:00.000Z');
  // 2:30 AM on US spring-forward day (2026-03-08) does not exist; conversion
  // must still return a stable, sane instant rather than looping or crashing.
  const gap = FlightTz.zonedTimeToUtc('2026-03-08', '02:30', 'America/New_York');
  check('DST gap does not crash', gap instanceof Date && !isNaN(gap.getTime()), true);
}

console.log('\nTimezone: formatters');
{
  check('toGCalUtc', FlightTz.toGCalUtc(new Date('2026-06-15T12:00:00Z')), '20260615T120000Z');
  check('toIcsLocal', FlightTz.toIcsLocal('2026-06-15', '08:00'), '20260615T080000');
  check('valid zone', FlightTz.isValidZone('America/New_York'), true);
  check('invalid zone', FlightTz.isValidZone('Nope/Nope'), false);
}

// ─── 3. Event building ────────────────────────────────────────────────────────

console.log('\nEvents: JFK→LAX known flight');
{
  // 8:00 AM EDT departure, 11:15 AM PDT arrival: ~6h15m in the air,
  // 3h15m wall-clock difference (LAX clocks are 3h behind JFK).
  const res = FlightCalendar.flightToEvent({
    flightNumber: 'DL 423', airlineName: 'Delta Air Lines', date: '2026-06-15',
    departure: 'JFK', arrival: 'LAX', departureTime: '08:00', arrivalTime: '11:15',
    confirmationCode: 'GKXR4T', passenger: 'Jennifer Long'
  });
  check('ok', res.ok, true);
  check('start UTC', res.event.startUtc.toISOString(), '2026-06-15T12:00:00.000Z');
  check('end UTC', res.event.endUtc.toISOString(), '2026-06-15T18:15:00.000Z');
  check('duration 6.25h', (res.event.endUtc - res.event.startUtc) / 3600000, 6.25);
  check('dep tz', res.event.depTz, 'America/New_York');
  check('arr tz', res.event.arrTz, 'America/Los_Angeles');
}

console.log('\nEvents: overnight red-eye LAX→JFK');
{
  // Departs 10:00 PM PDT, lands 6:10 AM EDT the NEXT day.
  const res = FlightCalendar.flightToEvent({
    flightNumber: 'B6 424', date: '2026-06-15',
    departure: 'LAX', arrival: 'JFK', departureTime: '22:00', arrivalTime: '06:10'
  });
  check('ok', res.ok, true);
  check('start UTC', res.event.startUtc.toISOString(), '2026-06-16T05:00:00.000Z');
  check('end UTC (next day)', res.event.endUtc.toISOString(), '2026-06-16T10:10:00.000Z');
  check('arrival date rolled', res.event.arrDate, '2026-06-16');
  check('duration 5.17h', Math.round((res.event.endUtc - res.event.startUtc) / 60000), 310);
}

console.log('\nEvents: edge cases');
{
  const est = FlightCalendar.flightToEvent({
    flightNumber: 'UA 5', date: '2026-06-15',
    departure: 'ORD', arrival: 'DEN', departureTime: '09:00', arrivalTime: null
  });
  check('missing arrival → estimated', est.event.arrivalEstimated, true);
  check('estimated duration 3h', (est.event.endUtc - est.event.startUtc) / 3600000, 3);

  check('unknown airport rejected',
    FlightCalendar.flightToEvent({ date: '2026-06-15', departure: 'XXQ', arrival: 'LAX', departureTime: '08:00' }).error,
    'Unknown airport code: XXQ');
  check('missing date rejected',
    FlightCalendar.flightToEvent({ departure: 'JFK', arrival: 'LAX', departureTime: '08:00' }).error,
    'Missing flight date');
}

// ─── 4. Output formats ────────────────────────────────────────────────────────

console.log('\nOutput: GCal URL and .ics');
{
  const { event } = FlightCalendar.flightToEvent({
    flightNumber: 'DL 423', airlineName: 'Delta Air Lines', date: '2026-06-15',
    departure: 'JFK', arrival: 'LAX', departureTime: '08:00', arrivalTime: '11:15'
  });
  const url = FlightCalendar.buildGCalUrl(event);
  check('template action', url.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE'), true);
  check('UTC Z dates in URL', url.includes('20260615T120000Z%2F20260615T181500Z'), true);

  const ics = FlightCalendar.buildIcs([event]);
  check('DTSTART TZID', ics.includes('DTSTART;TZID=America/New_York:20260615T080000'), true);
  check('DTEND TZID', ics.includes('DTEND;TZID=America/Los_Angeles:20260615T111500'), true);
  check('valid calendar wrapper',
    ics.startsWith('BEGIN:VCALENDAR') && ics.trim().endsWith('END:VCALENDAR'), true);
}

console.log('\nParser: Greek island itinerary (non-US codes, spaced slash date)');
{
  // Verbatim paste that originally failed. Two independent bugs: the date
  // "09 / 11 / 2026" (spaces around the slashes) parsed to null, and ATH/JNX
  // sit outside the curated COMMON_AIRPORTS list even though their timezones
  // ship in data/. No flight number at all, so this goes through the fallback.
  const segs = FlightParser.parseEmail(sample('aegean-greek-islands.txt'));
  check('one leg', segs.length, 1);
  const s = segs[0] || {};
  check('route', [s.departure, s.arrival], ['ATH', 'JNX']);
  check('spaced slash date', s.date, '2026-09-11');
  check('times', [s.departureTime, s.arrivalTime], ['07:45', '08:25']);

  // The whole point: a usable calendar event, in Athens time, not an error.
  const res = FlightCalendar.flightToEvent(s);
  check('event ok', res.ok, true);
  check('dep tz', res.event.depTz, 'Europe/Athens');
  check('arr tz', res.event.arrTz, 'Europe/Athens');
  check('40 minute hop', Math.round((res.event.endUtc - res.event.startUtc) / 60000), 40);
  check('start UTC (EEST = +3)', res.event.startUtc.toISOString(), '2026-09-11T04:45:00.000Z');
}

console.log('\nParser: non-US airport codes resolve');
{
  // Codes outside COMMON_AIRPORTS, only reachable now that the parser falls
  // back to the full shipped dataset for syntactically-marked tokens.
  const cases = [
    ['ATH', 'Europe/Athens'], ['JNX', 'Europe/Athens'], ['JTR', 'Europe/Athens'],
    ['JMK', 'Europe/Athens'], ['VCE', 'Europe/Rome'], ['FLR', 'Europe/Rome'],
    ['AGP', 'Europe/Madrid'], ['OPO', 'Europe/Lisbon'], ['KRK', 'Europe/Warsaw'],
    ['SPU', 'Europe/Zagreb'], ['KEF', 'Atlantic/Reykjavik'], ['AYT', 'Europe/Istanbul'],
    ['KIX', 'Asia/Tokyo'], ['CTS', 'Asia/Tokyo'], ['PUS', 'Asia/Seoul'],
    ['CAN', 'Asia/Shanghai'], ['SGN', 'Asia/Ho_Chi_Minh'], ['HKT', 'Asia/Bangkok'],
    ['DPS', 'Asia/Makassar'], ['MAA', 'Asia/Kolkata'], ['HYD', 'Asia/Kolkata'],
    ['CMB', 'Asia/Colombo'], ['ISB', 'Asia/Karachi'], ['NQZ', 'Asia/Almaty']
  ];
  check('all resolve via resolveAirport',
    cases.filter(([code]) => FlightParser.resolveAirport(code) !== code).map(([c]) => c), []);
  // Compared by resulting UTC instant, not string: the dataset ships legacy
  // IANA aliases (Asia/Saigon, Asia/Calcutta) that are correct but not canonical.
  const sameZone = (a, b) => a === b ||
    FlightTz.zonedTimeToUtc('2026-09-11', '07:45', a).getTime() ===
    FlightTz.zonedTimeToUtc('2026-09-11', '07:45', b).getTime();
  check('all have the expected timezone',
    cases.filter(([code, tz]) => !AIRPORT_TIMEZONES[code] || !sameZone(AIRPORT_TIMEZONES[code], tz))
         .map(([c, tz]) => `${c}: expected ${tz}, got ${AIRPORT_TIMEZONES[c]}`), []);

  // Parenthesized and arrow routes pull non-US codes out of prose.
  const paren = FlightParser.parseEmail('Flight A3 352\nSat, 14 March 2026\nAthens (ATH) to Santorini (JTR)\nDeparts 10:15\nArrives 11:00');
  check('paren route non-US', [paren[0].departure, paren[0].arrival], ['ATH', 'JTR']);
  const arrow = FlightParser.parseEmail('TK 1846\n3 April 2026\nIST → ATH\nDepart 08:00 Arrive 09:20');
  check('arrow route non-US', [arrow[0].departure, arrow[0].arrival], ['IST', 'ATH']);
}

console.log('\nParser: European city and airport names → IATA');
{
  const cases = [
    ['Eleftherios Venizelos', 'ATH'], ['Naxos Airport', 'JNX'],
    ['Athens', 'ATH'], ['Santorini', 'JTR'], ['Mykonos', 'JMK'],
    ['Heraklion', 'HER'], ['Rhodes', 'RHO'], ['Corfu', 'CFU'],
    ['Venice', 'VCE'], ['Florence', 'FLR'], ['Naples', 'NAP'],
    ['Prague', 'PRG'], ['Budapest', 'BUD'], ['Krakow', 'KRK'],
    ['Split', 'SPU'], ['Dubrovnik', 'DBV'], ['Reykjavik', 'KEF'],
    ['Osaka', 'KIX'], ['Bali', 'DPS'], ['Phuket', 'HKT'],
    ['Hanoi', 'HAN'], ['Ho Chi Minh City', 'SGN'], ['Bengaluru', 'BLR'],
    ['Kathmandu', 'KTM'], ['Colombo', 'CMB'], ['Male', 'MLE']
  ];
  const wrong = cases
    .map(([name, code]) => [name, code, FlightParser.resolveAirport(name)])
    .filter(([, code, got]) => got !== code)
    .map(([name, code, got]) => `${name}: expected ${code}, got ${got}`);
  check('all resolve to the primary airport', wrong, []);
}

console.log('\nParser: date formats (incl. day-first disambiguation)');
{
  check('spaced slashes', FlightParser.parseDateText('09 / 11 / 2026'), '2026-09-11');
  check('2-digit year', FlightParser.parseDateText('09/11/26'), '2026-09-11');
  // Dot and dash separators are the European written norm, so an ambiguous
  // pair reads day-first: 11.09.2026 is 11 September, not 9 November.
  check('dotted European is day-first', FlightParser.parseDateText('11.09.2026'), '2026-09-11');
  check('dashed is day-first', FlightParser.parseDateText('09-11-2026'), '2026-11-09');
  check('ISO untouched', FlightParser.parseDateText('2026-09-11'), '2026-09-11');
  // >12 in the first slot can only be a day, so MM/DD is impossible.
  check('day-first when unambiguous', FlightParser.parseDateText('25 / 12 / 2026'), '2026-12-25');
  check('day-first dotted', FlightParser.parseDateText('25.12.2026'), '2026-12-25');
  // A weekday in the text settles a genuinely ambiguous date. 2026-09-11 is a
  // Friday; 2026-11-09 is a Monday. Same digits, different reading.
  check('weekday picks MM/DD', FlightParser.parseDateText('Fri 09 / 11 / 2026'), '2026-09-11');
  check('weekday picks DD/MM', FlightParser.parseDateText('Mon 09 / 11 / 2026'), '2026-11-09');
  check('weekday spelled out', FlightParser.parseDateText('Monday 09/11/2026'), '2026-11-09');
  check('no weekday defaults to MM/DD', FlightParser.parseDateText('09 / 11 / 2026'), '2026-09-11');
}

console.log('\nParser: airport-code false positives');
{
  // Widening beyond COMMON_AIRPORTS must not turn fare-table jargon, month
  // abbreviations, or currency codes into airports. Each string below is a
  // real IATA code AND a word that shows up in confirmation emails.
  const noise = [
    'Total USD 342.00', 'TAX 41.20', 'Fare basis: ADT', '1 BAG included',
    'PNR ABC123', 'Departs 09:30 EST', 'Arrives 12:49 PDT', 'VAT included',
    'Mon 28 SEP', 'Booked NOV 2026', 'GBP 210.00', 'ETA 11:40'
  ];
  const leaked = noise.filter((t) => {
    const segs = FlightParser.parseEmail(t);
    return segs.length && (segs[0].departure || segs[0].arrival);
  });
  check('no airports invented from jargon', leaked, []);

  // Bare 3-letter words still require the curated list, so an obscure code
  // mentioned in passing does not become a route.
  check('bare obscure code ignored',
    FlightParser.parseEmail('Your bag tag reads NQZ and the seat is 14A').length, 0);
}

// ─── 5. Dataset coverage ──────────────────────────────────────────────────────

console.log('\nDataset: airport timezone coverage');
{
  const missing = [...FlightParser.COMMON_AIRPORTS].filter(c => !AIRPORT_TIMEZONES[c]);
  check('all parser airports have timezones', missing, []);
  const badZones = Object.entries(AIRPORT_TIMEZONES)
    .filter(([, tz]) => !FlightTz.isValidZone(tz))
    .map(([code, tz]) => `${code}:${tz}`);
  check('all zones are valid IANA names', badZones, []);
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
