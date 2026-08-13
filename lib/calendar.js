/**
 * Flight → calendar event builders.
 *
 * Takes a parsed flight segment (from FlightParser) plus the airport
 * timezone map, and produces:
 *  - a normalized event object with true UTC instants
 *  - a Google Calendar template URL (no auth, no API — just a prefilled form)
 *  - an .ics file string (TZID-tagged, for any calendar app)
 *
 * Depends on FlightTz (lib/timezone.js) and AIRPORT_TIMEZONES (data/).
 */

const FlightCalendar = (() => {

  const DEFAULT_DURATION_MS = 3 * 60 * 60 * 1000; // fallback when arrival time unknown

  function deps() {
    // Support both browser globals and Node requires (for tests)
    const tz = typeof FlightTz !== 'undefined' ? FlightTz : require('./timezone.js');
    const airports = typeof AIRPORT_TIMEZONES !== 'undefined'
      ? AIRPORT_TIMEZONES
      : require('../data/airport-timezones.js');
    return { tz, airports };
  }

  /**
   * Builds a normalized event from a parsed segment.
   *
   * @param {object} seg - { flightNumber, airlineName, date "YYYY-MM-DD",
   *   departure/arrival (IATA), departureTime/arrivalTime "HH:MM",
   *   passenger, confirmationCode }
   * @returns {{ ok: true, event: object } | { ok: false, error: string }}
   */
  function flightToEvent(seg) {
    const { tz, airports } = deps();

    if (!seg.date) return { ok: false, error: 'Missing flight date' };
    if (!seg.departure || !seg.arrival) return { ok: false, error: 'Missing departure or arrival airport' };
    if (!seg.departureTime) return { ok: false, error: 'Missing departure time' };

    const depTz = airports[seg.departure];
    const arrTz = airports[seg.arrival];
    if (!depTz) return { ok: false, error: `Unknown airport code: ${seg.departure}` };
    if (!arrTz) return { ok: false, error: `Unknown airport code: ${seg.arrival}` };

    const startUtc = tz.zonedTimeToUtc(seg.date, seg.departureTime, depTz);

    let endUtc;
    let arrivalEstimated = false;
    let arrivalDate = seg.date;
    if (seg.arrivalTime) {
      endUtc = tz.zonedTimeToUtc(arrivalDate, seg.arrivalTime, arrTz);
      // Overnight flight: arrival wall time is on the next calendar day
      if (endUtc.getTime() <= startUtc.getTime()) {
        arrivalDate = addDays(seg.date, 1);
        endUtc = tz.zonedTimeToUtc(arrivalDate, seg.arrivalTime, arrTz);
      }
    } else {
      endUtc = new Date(startUtc.getTime() + DEFAULT_DURATION_MS);
      arrivalEstimated = true;
    }

    const title = `Flight ${seg.flightNumber || ''}: ${seg.departure} → ${seg.arrival}`.replace(/\s+/g, ' ').trim();

    const detailLines = [];
    if (seg.airlineName) detailLines.push(`Airline: ${seg.airlineName}`);
    if (seg.flightNumber) detailLines.push(`Flight: ${seg.flightNumber}`);
    detailLines.push(`Route: ${seg.departure} → ${seg.arrival}`);
    if (seg.confirmationCode) detailLines.push(`Confirmation: ${seg.confirmationCode}`);
    if (seg.passenger) detailLines.push(`Passenger: ${seg.passenger}`);
    if (arrivalEstimated) detailLines.push('Arrival time estimated (3h default) — no arrival time found.');

    return {
      ok: true,
      event: {
        title,
        location: `${seg.departure} Airport`,
        description: detailLines.join('\n'),
        startUtc,
        endUtc,
        depTz,
        arrTz,
        depDate: seg.date,
        depTime: seg.departureTime,
        arrDate: arrivalDate,
        arrTime: seg.arrivalTime || null,
        arrivalEstimated
      }
    };
  }

  /** Google Calendar prefilled-event URL. UTC (Z) times ⇒ correct in any calendar timezone. */
  function buildGCalUrl(event) {
    const { tz } = deps();
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: event.title,
      dates: `${tz.toGCalUtc(event.startUtc)}/${tz.toGCalUtc(event.endUtc)}`,
      details: event.description,
      location: event.location
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  /** One VEVENT per event, with IANA TZIDs on start/end. */
  function buildIcs(events) {
    const { tz } = deps();
    const now = tz.toGCalUtc(new Date());
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//flight-to-gcal//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH'
    ];
    events.forEach((event, i) => {
      const dtStart = tz.toIcsLocal(event.depDate, event.depTime);
      // For estimated arrivals we only have a UTC end; emit it as UTC.
      const dtEnd = event.arrTime
        ? `DTEND;TZID=${event.arrTz}:${tz.toIcsLocal(event.arrDate, event.arrTime)}`
        : `DTEND:${tz.toGCalUtc(event.endUtc)}`;
      lines.push(
        'BEGIN:VEVENT',
        `UID:${now}-${i}@flight-to-gcal`,
        `DTSTAMP:${now}`,
        `DTSTART;TZID=${event.depTz}:${dtStart}`,
        dtEnd,
        `SUMMARY:${escapeIcs(event.title)}`,
        `DESCRIPTION:${escapeIcs(event.description)}`,
        `LOCATION:${escapeIcs(event.location)}`,
        'END:VEVENT'
      );
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function addDays(dateStr, days) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    return dt.toISOString().slice(0, 10);
  }

  function escapeIcs(text) {
    return String(text)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n');
  }

  return { flightToEvent, buildGCalUrl, buildIcs, DEFAULT_DURATION_MS };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FlightCalendar;
}
