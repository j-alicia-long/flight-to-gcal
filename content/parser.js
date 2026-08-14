/**
 * Flight Email Parser
 * Extracts flight details from airline confirmation email HTML/text.
 * Optimized for Delta, United, American, Southwest, JetBlue, and others.
 *
 * Strategy: detect airline → find flight numbers with positions →
 * extract each segment as a cohesive unit from surrounding context.
 */

const FlightParser = (() => {

  // ─── Constants ──────────────────────────────────────────────────────────────
  const AIRLINE_KEYWORDS = [
    'delta', 'united', 'american airlines', 'southwest', 'jetblue',
    'spirit', 'frontier', 'alaska airlines', 'hawaiian airlines',
    'air canada', 'westjet', 'british airways', 'lufthansa',
    'emirates', 'qatar airways', 'singapore airlines', 'cathay pacific',
    'qantas', 'ryanair', 'easyjet', 'air france', 'klm',
    'turkish airlines', 'etihad', 'virgin atlantic', 'iberia',
    'swiss', 'austrian', 'sas', 'finnair', 'tap portugal',
    'aeromexico', 'latam', 'avianca', 'copa airlines', 'volaris',
    'sun country', 'breeze', 'allegiant', 'norse atlantic',
    'korean air', 'ana', 'jal', 'air india', 'interjet'
  ];

  const CONFIRMATION_SUBJECT_PATTERNS = [
    /confirmation/i, /itinerary/i, /e-?ticket/i, /reservation/i,
    /booking\s*(confirmation|confirmed|receipt)/i,
    /flight\s*(confirmation|receipt|booking)/i,
    /trip\s*(confirmation|details)/i,
    /your\s*(upcoming\s*)?trip/i,
    /travel\s*(confirmation|itinerary|details)/i,
    /receipt\s*for\s*(your\s*)?flight/i,
    /air\s*(confirmation|itinerary)/i
  ];

  const COMMON_AIRPORTS = new Set([
    'ATL','LAX','ORD','DFW','DEN','JFK','SFO','SEA','LAS','MCO',
    'EWR','MIA','PHX','IAH','BOS','MSP','FLL','DTW','PHL','LGA',
    'BWI','SLC','DCA','SAN','IAD','TPA','BNA','AUS','STL','HNL',
    'OAK','SJC','RDU','MCI','CLE','SMF','IND','PIT','CMH','SAT',
    'PDX','MKE','RSW','CVG','MSY','BDL','JAX','OGG','ABQ','BUF',
    'OMA','RIC','SNA','ONT','BUR','DAL','HOU','MDW','ISP','PBI',
    'CHS','MEM','SDF','BOI','GRR','TUS','ELP','LIT','DSM','FAT',
    'HSV','SYR','ROC','PVD','ORF','GSP','SAV','MYR','PWM','TYS',
    'LHR','CDG','FRA','AMS','MAD','BCN','FCO','MUC','ZRH','VIE',
    'CPH','OSL','ARN','HEL','LIS','DUB','BRU','MAN','EDI','GLA',
    'NRT','HND','ICN','PEK','PVG','HKG','SIN','BKK','KUL','DEL',
    'BOM','DXB','DOH','IST','JNB','CAI','SYD','MEL','AKL','YYZ',
    'YVR','YUL','MEX','GRU','EZE','BOG','SCL','LIM','PTY','CUN',
    'SJU','GIG','MBJ','NAS','PUJ'
  ]);

  const AIRLINE_CODES = {
    'DL':'Delta Air Lines','UA':'United Airlines','AA':'American Airlines',
    'WN':'Southwest Airlines','B6':'JetBlue Airways','NK':'Spirit Airlines',
    'F9':'Frontier Airlines','AS':'Alaska Airlines','HA':'Hawaiian Airlines',
    'AC':'Air Canada','WS':'WestJet','BA':'British Airways',
    'LH':'Lufthansa','EK':'Emirates','QR':'Qatar Airways',
    'SQ':'Singapore Airlines','CX':'Cathay Pacific','QF':'Qantas',
    'FR':'Ryanair','U2':'easyJet','AF':'Air France','KL':'KLM',
    'TK':'Turkish Airlines','EY':'Etihad Airways','VS':'Virgin Atlantic',
    'IB':'Iberia','LX':'Swiss','OS':'Austrian Airlines',
    'SK':'SAS','AY':'Finnair','TP':'TAP Portugal',
    'AM':'Aeromexico','LA':'LATAM','AV':'Avianca',
    'CM':'Copa Airlines','Y4':'Volaris','SY':'Sun Country',
    'MX':'Breeze Airways','G4':'Allegiant Air','Z0':'Norse Atlantic',
    'KE':'Korean Air','NH':'ANA','JL':'JAL','AI':'Air India'
  };

  const AIRLINE_NAME_TO_CODE = {
    'delta':'DL','united':'UA','american airlines':'AA','american':'AA',
    'southwest':'WN','jetblue':'B6','spirit':'NK',
    'frontier':'F9','alaska airlines':'AS','alaska':'AS',
    'hawaiian airlines':'HA','hawaiian':'HA',
    'air canada':'AC','westjet':'WS','british airways':'BA',
    'lufthansa':'LH','emirates':'EK','qatar airways':'QR',
    'singapore airlines':'SQ','cathay pacific':'CX','qantas':'QF',
    'ryanair':'FR','easyjet':'U2','air france':'AF','klm':'KL',
    'turkish airlines':'TK','etihad':'EY','virgin atlantic':'VS',
    'iberia':'IB','swiss':'LX','austrian':'OS',
    'sas':'SK','finnair':'AY','tap portugal':'TP',
    'aeromexico':'AM','latam':'LA','avianca':'AV',
    'copa airlines':'CM','volaris':'Y4','sun country':'SY',
    'breeze':'MX','allegiant':'G4','norse atlantic':'Z0',
    'korean air':'KE','ana':'NH','jal':'JL','air india':'AI'
  };

  const CITY_TO_AIRPORT = {
    'atlanta':'ATL','los angeles':'LAX','chicago':'ORD',
    'chicago (midway)':'MDW','chicago midway':'MDW',
    'dallas':'DFW','dallas (love field)':'DAL','dallas love field':'DAL',
    'denver':'DEN','new york':'JFK','new york (laguardia)':'LGA',
    'san francisco':'SFO','seattle':'SEA','seattle/tacoma':'SEA',
    'las vegas':'LAS','orlando':'MCO','newark':'EWR','miami':'MIA',
    'phoenix':'PHX','houston':'IAH','houston (hobby)':'HOU',
    'houston hobby':'HOU','boston':'BOS','minneapolis':'MSP',
    'fort lauderdale':'FLL','detroit':'DTW','philadelphia':'PHL',
    'baltimore':'BWI','baltimore/washington':'BWI','salt lake city':'SLC',
    'washington':'DCA','washington dc':'DCA','washington, dc':'DCA',
    'washington (reagan)':'DCA','washington (dulles)':'IAD',
    'reagan national':'DCA','ronald reagan':'DCA','dulles':'IAD',
    'san diego':'SAN','tampa':'TPA','nashville':'BNA',
    'austin':'AUS','st. louis':'STL','st louis':'STL','saint louis':'STL',
    'honolulu':'HNL','oakland':'OAK','san jose':'SJC',
    'raleigh':'RDU','raleigh/durham':'RDU',
    'kansas city':'MCI','cleveland':'CLE','sacramento':'SMF',
    'indianapolis':'IND','pittsburgh':'PIT','columbus':'CMH',
    'san antonio':'SAT','portland':'PDX','milwaukee':'MKE',
    'fort myers':'RSW','cincinnati':'CVG','new orleans':'MSY',
    'hartford':'BDL','jacksonville':'JAX','albuquerque':'ABQ',
    'buffalo':'BUF','omaha':'OMA','richmond':'RIC',
    'charleston':'CHS','memphis':'MEM','savannah':'SAV',
    'myrtle beach':'MYR','providence':'PVD','norfolk':'ORF',
    'london':'LHR','paris':'CDG','frankfurt':'FRA','amsterdam':'AMS',
    'madrid':'MAD','barcelona':'BCN','rome':'FCO','dubai':'DXB',
    'tokyo':'NRT','singapore':'SIN','hong kong':'HKG','sydney':'SYD',
    'toronto':'YYZ','vancouver':'YVR','cancun':'CUN','mexico city':'MEX'
  };

  // ─── Main Entry Point ───────────────────────────────────────────────────────

  function parseEmail(html, subject = '') {
    const cleanText = stripHtml(html);
    const airline = detectAirline(cleanText, subject);
    const segments = extractFlightSegments(cleanText, airline);
    const passenger = extractPassengerName(cleanText);
    const confirmationCode = extractConfirmationCode(cleanText, airline);

    for (const seg of segments) {
      if (!seg.passenger) seg.passenger = passenger;
      if (!seg.confirmationCode) seg.confirmationCode = confirmationCode;
      if (!seg.airlineName && airline.name) seg.airlineName = airline.name;
      if (!seg.airlineCode && airline.code) seg.airlineCode = airline.code;
    }
    if (segments.length > 0) return segments;
    return fallbackExtraction(cleanText, airline, passenger, confirmationCode);
  }

  // ─── Airline Detection ──────────────────────────────────────────────────────

  function detectAirline(text, subject) {
    const combined = (subject + ' ' + text).toLowerCase();
    const loyaltyMap = {
      'skymiles':'DL','delta.com':'DL',
      'mileageplus':'UA','united.com':'UA',
      'aadvantage':'AA','aa.com':'AA',
      'rapid rewards':'WN','wanna get away':'WN','earlybird':'WN','southwest.com':'WN',
      'trueblue':'B6','jetblue.com':'B6',
      'free spirit':'NK','spirit.com':'NK',
      'frontier miles':'F9','flyfrontier':'F9',
      'mileage plan':'AS','alaskaair.com':'AS',
      'hawaiianmiles':'HA'
    };
    for (const [kw, code] of Object.entries(loyaltyMap)) {
      if (combined.includes(kw)) return { code, name: AIRLINE_CODES[code], keyword: kw };
    }
    const sorted = Object.entries(AIRLINE_NAME_TO_CODE).sort((a, b) => b[0].length - a[0].length);
    for (const [name, code] of sorted) {
      if (combined.includes(name)) return { code, name: AIRLINE_CODES[code] || name, keyword: name };
    }
    const cm = text.match(/\b([A-Z]{2})\s*\d{1,4}\b/);
    if (cm && AIRLINE_CODES[cm[1]]) return { code: cm[1], name: AIRLINE_CODES[cm[1]], keyword: null };
    return { code: null, name: null, keyword: null };
  }

  // ─── Segment-Based Extraction ───────────────────────────────────────────────

  function extractFlightSegments(text, airline) {
    const positions = findFlightPositions(text, airline);
    if (!positions.length) return [];
    const segments = [];
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      const start = Math.max(0, pos.index - 200);
      const end = positions[i + 1] ? positions[i + 1].index : Math.min(pos.index + 800, text.length);
      const seg = buildSegment(text.substring(start, end), pos, airline);
      if (seg) segments.push(seg);
    }
    return segments;
  }

  function findFlightPositions(text, airline) {
    const positions = [];
    const seen = new Set();
    let m;
    // Standard: DL 1234, UA1234, AA 567
    const std = /\b([A-Z]{2})\s*(\d{1,4})\b/g;
    while ((m = std.exec(text)) !== null) {
      if (AIRLINE_CODES[m[1]]) {
        const k = m[1] + m[2];
        if (!seen.has(k)) { seen.add(k); positions.push({ index: m.index, airline: m[1], number: m[2], full: m[1]+' '+m[2] }); }
      }
    }
    // Context: "Flight 1234", "Flt #1234"
    if (!positions.length || airline.code === 'WN') {
      const ctx = /(?:flight|flt)\s*#?\s*(\d{1,4})\b/gi;
      while ((m = ctx.exec(text)) !== null) {
        const code = airline.code || 'WN';
        const k = code + m[1];
        if (!seen.has(k) && parseInt(m[1]) > 0) { seen.add(k); positions.push({ index: m.index, airline: code, number: m[1], full: code+' '+m[1] }); }
      }
    }
    // Airline name prefix: "Delta 1234", "United 567"
    if (!positions.length && airline.keyword) {
      const np = new RegExp('(?:' + airline.keyword + ')\\s+(\\d{1,4})\\b', 'gi');
      while ((m = np.exec(text)) !== null) {
        const k = airline.code + m[1];
        if (!seen.has(k)) { seen.add(k); positions.push({ index: m.index, airline: airline.code, number: m[1], full: airline.code+' '+m[1] }); }
      }
    }
    positions.sort((a, b) => a.index - b.index);
    return positions;
  }

  function buildSegment(segText, info, airline) {
    const dates = extractDatesFromSegment(segText);
    const airports = extractAirportsFromSegment(segText);
    const times = extractTimesFromSegment(segText);
    return {
      flightNumber: info.full,
      airlineCode: info.airline,
      airlineName: AIRLINE_CODES[info.airline] || airline.name || info.airline,
      number: info.number,
      date: dates[0] || null,
      departure: airports[0] || null,
      arrival: airports[1] || null,
      departureTime: times.departure || times.all[0] || null,
      arrivalTime: times.arrival || times.all[1] || null,
      passenger: null,
      confirmationCode: null
    };
  }

  // ─── Segment-Level Extractors ───────────────────────────────────────────────

  function extractDatesFromSegment(text) {
    const all = [];
    const pats = [
      { r: /(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+)?(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})\b/gi,
        p: m => normalizeDate(m[1], m[2], m[3]) },
      { r: /\b(\d{1,2})(?:st|nd|rd|th)?\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?),?\s*(\d{4})\b/gi,
        p: m => normalizeDate(m[2], m[1], m[3]) },
      { r: /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g,
        p: m => `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` },
      { r: /\b(\d{4})-(\d{2})-(\d{2})\b/g,
        p: m => `${m[1]}-${m[2]}-${m[3]}` }
    ];
    for (const { r, p } of pats) {
      let m;
      while ((m = r.exec(text)) !== null) {
        const d = p(m);
        if (isPlausibleFlightDate(d)) all.push({ date: d, index: m.index });
      }
    }
    const kw = /(?:depart|arrive|travel|flight|board|itinerary|trip|schedule|gate)/i;
    const ctx = [], other = [];
    for (const e of all) {
      const before = text.substring(Math.max(0, e.index - 200), e.index);
      (kw.test(before) ? ctx : other).push(e.date);
    }
    return [...new Set(ctx.length ? ctx : other)];
  }

  function extractAirportsFromSegment(text) {
    const found = [], seen = new Set();
    let m;
    // Route patterns
    const routes = [
      /\(([A-Z]{3})\)\s*(?:to|→|->|—|–)\s*\(([A-Z]{3})\)/,
      /\b([A-Z]{3})\s*(?:→|->|—|–)\s*([A-Z]{3})\b/
    ];
    for (const r of routes) {
      m = text.match(r);
      if (m && COMMON_AIRPORTS.has(m[1]) && COMMON_AIRPORTS.has(m[2])) return [m[1], m[2]];
    }
    // Parenthesized codes
    const pp = /\(([A-Z]{3})\)/g;
    while ((m = pp.exec(text)) !== null) {
      if (COMMON_AIRPORTS.has(m[1]) && !seen.has(m[1])) { found.push(m[1]); seen.add(m[1]); }
    }
    if (found.length >= 2) return found.slice(0, 2);
    // Labeled
    const dm = text.match(/(?:depart|from|origin|leaving)[^]*?\b([A-Z]{3})\b/i);
    const am = text.match(/(?:arriv|destination|landing)[^]*?\b([A-Z]{3})\b/i);
    if (dm && COMMON_AIRPORTS.has(dm[1].toUpperCase()) && !seen.has(dm[1].toUpperCase())) { found.push(dm[1].toUpperCase()); seen.add(dm[1].toUpperCase()); }
    if (am && COMMON_AIRPORTS.has(am[1].toUpperCase()) && !seen.has(am[1].toUpperCase())) { found.push(am[1].toUpperCase()); seen.add(am[1].toUpperCase()); }
    if (found.length >= 2) return found.slice(0, 2);
    // Standalone known codes
    const cp = /\b([A-Z]{3})\b/g;
    while ((m = cp.exec(text)) !== null) {
      if (COMMON_AIRPORTS.has(m[1]) && !seen.has(m[1])) { found.push(m[1]); seen.add(m[1]); if (found.length >= 2) return found; }
    }
    // City names (longest first)
    if (found.length < 2) {
      const low = text.toLowerCase();
      const sorted = Object.entries(CITY_TO_AIRPORT).sort((a, b) => b[0].length - a[0].length);
      for (const [city, code] of sorted) {
        if (low.includes(city) && !seen.has(code)) { found.push(code); seen.add(code); if (found.length >= 2) break; }
      }
    }
    return found;
  }

  function extractTimesFromSegment(text) {
    const res = { departure: null, arrival: null, all: [] };
    const dp = [
      /(?:depart(?:s|ure|ing)?|leave[s]?)\s*:?\s*(\d{1,2}:\d{2})\s*(AM|PM|am|pm|a\.m\.|p\.m\.)?/i,
      /(?:depart(?:s|ure|ing)?|leave[s]?)\s+(?:at\s+)?(\d{1,2}:\d{2})\s*(AM|PM|am|pm|a\.m\.|p\.m\.)?/i
    ];
    const ap = [
      /(?:arriv(?:e[s]?|al|ing)?|land[s]?)\s*:?\s*(\d{1,2}:\d{2})\s*(AM|PM|am|pm|a\.m\.|p\.m\.)?/i,
      /(?:arriv(?:e[s]?|al|ing)?|land[s]?)\s+(?:at\s+)?(\d{1,2}:\d{2})\s*(AM|PM|am|pm|a\.m\.|p\.m\.)?/i
    ];
    for (const p of dp) { const m = text.match(p); if (m) { res.departure = normalizeTime(m[1], m[2]); break; } }
    for (const p of ap) { const m = text.match(p); if (m) { res.arrival = normalizeTime(m[1], m[2]); break; } }
    const tp = /\b(\d{1,2}):(\d{2})\s*(AM|PM|am|pm|a\.m\.|p\.m\.)?\b/g;
    let m;
    while ((m = tp.exec(text)) !== null) {
      const t = normalizeTime(m[1]+':'+m[2], m[3]);
      if (t && !res.all.includes(t)) res.all.push(t);
    }
    return res;
  }

  // ─── Fallback ───────────────────────────────────────────────────────────────

  function fallbackExtraction(text, airline, passenger, confirmationCode) {
    const airports = extractAirportsFromSegment(text);
    const dates = extractDatesFromSegment(text);
    const times = extractTimesFromSegment(text);
    if (airports.length >= 2 || dates.length > 0) {
      return [{
        flightNumber: airline.code ? `${airline.code} (unknown)` : 'Unknown',
        airlineCode: airline.code || '',
        airlineName: airline.name || detectAirlineFromText(text),
        number: '',
        date: dates[0] || null,
        departure: airports[0] || null,
        arrival: airports[1] || null,
        departureTime: times.departure || times.all[0] || null,
        arrivalTime: times.arrival || times.all[1] || null,
        passenger, confirmationCode
      }];
    }
    return [];
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  }

  function normalizeDate(month, day, year) {
    const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
    const m = months[month.substring(0, 3).toLowerCase()];
    return `${year}-${m}-${day.padStart(2, '0')}`;
  }

  function isPlausibleFlightDate(dateStr) {
    try {
      const d = new Date(dateStr + 'T00:00:00');
      if (isNaN(d.getTime())) return false;
      const now = new Date();
      const past = new Date(now); past.setFullYear(now.getFullYear() - 1);
      const future = new Date(now); future.setFullYear(now.getFullYear() + 2);
      return d >= past && d <= future;
    } catch { return false; }
  }

  function normalizeTime(timeStr, ampm) {
    if (!timeStr) return null;
    const parts = timeStr.match(/(\d{1,2}):(\d{2})/);
    if (!parts) return null;
    let h = parseInt(parts[1]);
    const min = parts[2];
    if (ampm) {
      const ap = ampm.replace(/\./g, '').toLowerCase();
      if (ap === 'pm' && h !== 12) h += 12;
      if (ap === 'am' && h === 12) h = 0;
    }
    return `${h.toString().padStart(2, '0')}:${min}`;
  }

  function extractPassengerName(text) {
    const patterns = [
      /(?:passenger|traveler|guest)\s*(?:name)?\s*:?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/i,
      /(?:name)\s*:?\s*([A-Z][a-z]+\s+[A-Z][a-z]+)/i,
      /(?:dear|hello|hi)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
      // ALL-CAPS: "LASTNAME/FIRSTNAME"
      /\b([A-Z]{2,})\s*\/\s*([A-Z]{2,})\b/
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) {
        // Handle LASTNAME/FIRSTNAME format
        if (m[2] && /^[A-Z]+$/.test(m[1]) && /^[A-Z]+$/.test(m[2])) {
          const fn = m[2].charAt(0) + m[2].slice(1).toLowerCase();
          const ln = m[1].charAt(0) + m[1].slice(1).toLowerCase();
          return `${fn} ${ln}`;
        }
        return m[1].trim();
      }
    }
    return null;
  }

  function extractConfirmationCode(text, airline) {
    // Airline-specific confirmation patterns
    const airlinePatterns = {
      'DL': [/(?:confirmation|conf)\s*(?:code|number|#|no\.?)?\s*:?\s*([FGHJ][A-Z0-9]{5})\b/i],
      'AA': [/(?:record\s*locator|confirmation|conf)\s*:?\s*([A-Z]{6})\b/i],
      'WN': [/(?:confirmation|conf)\s*(?:#|number|code)?\s*:?\s*([A-Z0-9]{6})\b/i],
      'UA': [/(?:confirmation|conf)\s*(?:#|number|code)?\s*:?\s*([A-Z0-9]{6})\b/i],
      'B6': [/(?:confirmation|conf)\s*(?:#|number|code)?\s*:?\s*([A-Z0-9]{6})\b/i]
    };

    // Try airline-specific patterns first
    if (airline && airline.code && airlinePatterns[airline.code]) {
      for (const p of airlinePatterns[airline.code]) {
        const m = text.match(p);
        if (m) return m[1].toUpperCase();
      }
    }

    // Generic patterns
    const generic = [
      /(?:confirmation|booking|record\s*locator|pnr|reference)\s*(?:code|number|#|no\.?)?\s*:?\s*([A-Z0-9]{5,8})\b/i,
      /(?:confirmation|booking|record\s*locator|pnr|reference)\s*(?:code|number|#|no\.?)?\s*:?\s*\n?\s*([A-Z0-9]{5,8})\b/i
    ];
    for (const p of generic) {
      const m = text.match(p);
      if (m) return m[1].toUpperCase();
    }
    return null;
  }

  function detectAirlineFromText(text) {
    const lower = text.toLowerCase();
    for (const keyword of AIRLINE_KEYWORDS) {
      if (lower.includes(keyword)) {
        return keyword.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      }
    }
    return 'Unknown Airline';
  }

  // ─── Flight Confirmation Detection ──────────────────────────────────────────

  function isFlightConfirmation(subject, bodyText = '') {
    const subjectMatch = CONFIRMATION_SUBJECT_PATTERNS.some(p => p.test(subject));
    const lower = (subject + ' ' + bodyText).toLowerCase();
    const hasAirline = AIRLINE_KEYWORDS.some(k => lower.includes(k));

    // Also check loyalty program keywords
    const loyaltyKw = ['skymiles','mileageplus','aadvantage','rapid rewards','trueblue','free spirit','mileage plan'];
    const hasLoyalty = loyaltyKw.some(k => lower.includes(k));

    const hasFlightNum = /\b[A-Z]{2}\s*\d{1,4}\b/.test(bodyText) || /\b[A-Z]{2}\s*\d{1,4}\b/.test(subject);
    const hasBareFlightNum = /(?:flight|flt)\s*#?\s*\d{1,4}/i.test(bodyText);

    return (subjectMatch && (hasAirline || hasLoyalty)) ||
           (subjectMatch && (hasFlightNum || hasBareFlightNum)) ||
           ((hasAirline || hasLoyalty) && (hasFlightNum || hasBareFlightNum));
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  return {
    parseEmail,
    isFlightConfirmation,
    AIRLINE_CODES,
    COMMON_AIRPORTS
  };
})();
