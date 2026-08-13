/**
 * Flight to Google Calendar — on-device AI fallback
 *
 * Uses Chrome's built-in Prompt API (Gemini Nano, Chrome 138+) when the
 * regex parser can't fully read a confirmation. Everything runs ON DEVICE —
 * no network calls, nothing leaves the browser.
 *
 * The model only ever extracts strings it can see in the text (airline,
 * flight number, date, airport names, local clock times). Airport
 * resolution, timezone lookup, and all time math stay deterministic:
 * the model's output feeds the exact same pipeline as the regex parser.
 */

const FlightAI = (() => {

  // FlightParser is a global in the popup; require()d in Node tests.
  const FP = (() => {
    if (typeof FlightParser !== 'undefined') return FlightParser;
    if (typeof module !== 'undefined' && typeof require !== 'undefined') {
      try { return require('../content/parser.js'); } catch { /* optional */ }
    }
    return null;
  })();

  const SYSTEM_PROMPT =
    'You extract flight details from airline confirmation text. ' +
    'Report values EXACTLY as written in the text — do not guess, invent, ' +
    'convert, or reformat anything. Times are local clock times as printed. ' +
    'If a field is not present in the text, use an empty string. ' +
    'List every flight leg separately, in the order they appear.';

  const RESPONSE_SCHEMA = {
    type: 'object',
    required: ['flights'],
    additionalProperties: false,
    properties: {
      flights: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['airline', 'flightNumber', 'date', 'departureAirport',
                     'arrivalAirport', 'departureTime', 'arrivalTime'],
          properties: {
            airline: { type: 'string', description: 'Airline name or 2-letter code as written' },
            flightNumber: { type: 'string', description: 'Flight number as written, e.g. "DL 1642" or "1642"' },
            date: { type: 'string', description: 'Departure date exactly as written, e.g. "Mon, 28SEP"' },
            departureAirport: { type: 'string', description: 'Departure airport name, city, or code as written' },
            arrivalAirport: { type: 'string', description: 'Arrival airport name, city, or code as written' },
            departureTime: { type: 'string', description: 'Local departure time as written, e.g. "09:30AM"' },
            arrivalTime: { type: 'string', description: 'Local arrival time as written, e.g. "12:49PM"' }
          }
        }
      }
    }
  };

  // ─── Availability ───────────────────────────────────────────────────────────

  function isSupported() {
    return typeof LanguageModel !== 'undefined' &&
           typeof LanguageModel.availability === 'function';
  }

  /** 'available' | 'downloadable' | 'downloading' | 'unavailable' */
  async function availability() {
    if (!isSupported()) return 'unavailable';
    try {
      return await LanguageModel.availability();
    } catch {
      return 'unavailable';
    }
  }

  /** True when the regex parse missed something worth a second opinion. */
  function isIncomplete(segments) {
    if (!segments || !segments.length) return true;
    return segments.some((s) =>
      !s.departure || !s.arrival || !s.date || !s.departureTime);
  }

  // ─── Extraction ─────────────────────────────────────────────────────────────

  /**
   * Runs the on-device model on the pasted text and returns segments in the
   * same shape FlightParser.parseEmail produces, tagged source:'ai'.
   * onProgress(fraction 0–1) fires while the model downloads (first use).
   */
  async function extract(text, onProgress) {
    const session = await LanguageModel.create({
      initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          if (onProgress) onProgress(e.loaded);
        });
      }
    });
    try {
      const raw = await session.prompt(
        'Extract every flight from this confirmation text:\n\n' + text,
        { responseConstraint: RESPONSE_SCHEMA, omitResponseConstraintInput: true }
      );
      const parsed = JSON.parse(raw);
      return normalizeFlights(Array.isArray(parsed.flights) ? parsed.flights : []);
    } finally {
      if (session.destroy) session.destroy();
    }
  }

  // ─── Deterministic normalization (the model never touches timezones) ────────

  function normalizeFlights(flights) {
    const out = [];
    for (const f of flights) {
      const code = airlineCode(f.airline, f.flightNumber);
      const number = String(f.flightNumber || '').match(/(\d{1,4})/)?.[1] || '';
      const seg = {
        flightNumber: code && number ? `${code} ${number}` : (f.flightNumber || '').trim() || null,
        airlineCode: code,
        airlineName: code ? FP.AIRLINE_CODES[code] : (f.airline || '').trim() || null,
        number,
        date: FP.parseDateText(f.date),
        departure: FP.resolveAirport(f.departureAirport),
        arrival: FP.resolveAirport(f.arrivalAirport),
        departureTime: FP.normalizeTimeText(f.departureTime),
        arrivalTime: FP.normalizeTimeText(f.arrivalTime),
        passenger: null,
        confirmationCode: null,
        source: 'ai'
      };
      // Keep only legs the model actually found something for
      if (seg.departure || seg.arrival || seg.departureTime || seg.date) out.push(seg);
    }
    return out;
  }

  function airlineCode(airline, flightNumber) {
    // 2-letter code prefix on the flight number ("DL 1642")
    const fm = String(flightNumber || '').trim().match(/^([A-Z0-9]{2})\s*\d/i);
    if (fm && FP.AIRLINE_CODES[fm[1].toUpperCase()]) return fm[1].toUpperCase();
    const raw = String(airline || '').trim();
    if (!raw) return null;
    const up = raw.toUpperCase();
    if (FP.AIRLINE_CODES[up]) return up;
    const low = raw.toLowerCase();
    for (const [code, name] of Object.entries(FP.AIRLINE_CODES)) {
      const n = name.toLowerCase();
      if (n === low || n.startsWith(low + ' ') || low.startsWith(n) || low.includes(n)) return code;
    }
    return null;
  }

  return { isSupported, availability, isIncomplete, extract, normalizeFlights };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FlightAI;
}
