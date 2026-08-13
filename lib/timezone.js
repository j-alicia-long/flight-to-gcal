/**
 * Timezone conversion helpers — no libraries, no network.
 *
 * The core problem: "2026-03-15 08:00 at JFK" is a *wall-clock* time in
 * America/New_York. JavaScript Dates only understand UTC and the browser's
 * local zone, so we use Intl.DateTimeFormat (which knows the full IANA tz
 * database, DST rules included) to find the UTC instant that displays as
 * the desired wall time in the target zone.
 */

const FlightTz = (() => {

  /**
   * Returns the wall-clock time (as ms since epoch, pretending the wall
   * time were UTC) that `utcMs` displays as in `timeZone`.
   */
  function wallTimeInZone(utcMs, timeZone) {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    });
    const parts = {};
    for (const p of dtf.formatToParts(new Date(utcMs))) {
      if (p.type !== 'literal') parts[p.type] = p.value;
    }
    // hour12:false can yield "24" for midnight
    const hour = parts.hour === '24' ? '00' : parts.hour;
    return Date.UTC(
      parseInt(parts.year), parseInt(parts.month) - 1, parseInt(parts.day),
      parseInt(hour), parseInt(parts.minute), parseInt(parts.second)
    );
  }

  /**
   * Converts a wall-clock date+time in an IANA zone to a UTC Date.
   *
   * @param {string} dateStr - "YYYY-MM-DD"
   * @param {string} timeStr - "HH:MM" (24-hour)
   * @param {string} timeZone - IANA zone, e.g. "America/New_York"
   * @returns {Date} the UTC instant
   *
   * Technique: start by guessing the wall time *is* UTC, see what that
   * instant displays as in the zone, and shift by the difference. Two
   * iterations converge even across DST transitions.
   */
  function zonedTimeToUtc(dateStr, timeStr, timeZone) {
    const [y, mo, d] = dateStr.split('-').map(Number);
    const [h, mi] = timeStr.split(':').map(Number);
    const desiredWall = Date.UTC(y, mo - 1, d, h, mi, 0);

    let utcMs = desiredWall;
    for (let i = 0; i < 3; i++) {
      const actualWall = wallTimeInZone(utcMs, timeZone);
      const diff = desiredWall - actualWall;
      if (diff === 0) break;
      utcMs += diff;
    }
    return new Date(utcMs);
  }

  /** Formats a Date as a Google Calendar UTC timestamp: YYYYMMDDTHHMMSSZ */
  function toGCalUtc(date) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }

  /** Formats wall-clock date+time strings as an ICS local timestamp: YYYYMMDDTHHMMSS */
  function toIcsLocal(dateStr, timeStr) {
    return dateStr.replace(/-/g, '') + 'T' + timeStr.replace(':', '') + '00';
  }

  /** Short zone label for display, e.g. "EDT" or "GMT+9". */
  function zoneAbbreviation(date, timeZone) {
    try {
      const dtf = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' });
      const part = dtf.formatToParts(date).find(p => p.type === 'timeZoneName');
      return part ? part.value : timeZone;
    } catch {
      return timeZone;
    }
  }

  /** True if Intl recognizes the IANA zone name. */
  function isValidZone(timeZone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone });
      return true;
    } catch {
      return false;
    }
  }

  return { zonedTimeToUtc, toGCalUtc, toIcsLocal, zoneAbbreviation, isValidZone };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FlightTz;
}
