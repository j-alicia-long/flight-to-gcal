# Flight to Google Calendar — Chrome Extension

Paste your flight confirmation email text into a popup, get timezone-correct Google Calendar events. Also handles plain `.ics` file uploads.

**Everything runs locally in your browser.** No servers, no cloud APIs, no accounts, no permissions — even the AI fallback is Chrome's built-in on-device model. The only thing that ever leaves the extension is the Google Calendar tab it opens for you.

## Features

### Paste flight mode (primary)
- Paste confirmation text from any airline email (Delta, United, American, Southwest, JetBlue, and 40+ more)
- Extracts flight number, airline, date, airports, departure/arrival times, confirmation code, passenger name
- Understands **airport and city names**, not just codes — `CHICAGO-OHARE`, `NYC-LaGuardia`, `Heathrow` all resolve to the right airport via a bundled name lookup (14,000+ entries)
- **Timezone-correct**: departure time uses the departure airport's timezone, arrival uses the arrival airport's — DST handled automatically via a bundled map of 5,500+ airports
- **On-device AI fallback**: if pattern matching can't read a confirmation, Chrome's built-in Gemini Nano (Chrome 138+) extracts the fields — entirely on your machine, nothing sent anywhere
- Editable preview: fix any field the parser got wrong before adding — a badge shows whether each leg came from pattern matching or on-device AI
- Multi-leg trips become one event per leg ("Add all" opens a tab per leg)
- Overnight flights roll the arrival to the next day automatically
- One-click **Add to Google Calendar** (prefilled event form — no sign-in to the extension itself)
- **Download .ics** fallback with proper `TZID`s, importable into any calendar app

### Upload .ics mode
- Drop one or more `.ics` files, preview the events, open each in Google Calendar
- Preserves timezones and recurrence rules

## Install (load unpacked)

1. Clone or download this repo
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (toggle, top-right)
4. Click **Load unpacked** and select the repo folder
5. Pin the extension and click its icon to open the popup

## Usage

1. Open a flight confirmation email, select all the text, copy
2. Click the extension icon → paste into the **Paste flight** tab → **Find flights**
3. Check the parsed legs (each shows resolved timezones, e.g. `8:00 AM EDT → 11:15 AM PDT · 6.25h`), edit anything that's off
4. Click **Add to Google Calendar** — a prefilled event opens in a new tab; hit Save there
5. Or click **Download .ics** and import it anywhere

## Privacy

- **Zero extension permissions** (`"permissions": []` in the manifest)
- No network requests at runtime — the airport timezone and name databases are bundled with the extension
- The AI fallback uses Chrome's **built-in, on-device** model (Gemini Nano) — no cloud AI APIs, your text never leaves the browser
- No analytics, no tracking, nothing stored
- Your text is parsed in the popup and discarded when it closes

## How parsing works (hybrid)

1. **Pattern matching first.** A regex engine tuned for 40+ airlines extracts flight number, date, airports, and times. Airport references are resolved whether they're codes (`ORD`), names (`CHICAGO-OHARE`), or cities (`Los Angeles`) via a generated name→IATA lookup. Compact airline dates like `28SEP` get their year inferred (next year if the date already passed).
2. **On-device AI fallback.** If the pattern pass misses fields (no airports, no times, no date), the popup asks Chrome's built-in Prompt API (Gemini Nano) to extract the raw strings — airline, flight number, date, airport names, local times — constrained to a strict JSON schema. The model **only reports what's written in the text**; it never produces timezones or does time math.
3. **Same deterministic pipeline either way.** Whatever the source, airport names go through the same lookup, timezones come from the same bundled map, and UTC conversion uses the same `Intl`-based math. Each preview card shows which parser produced it, and every field stays editable.

**AI fallback requirements** (degrades gracefully without them): Chrome 138+, ~22 GB free disk for the one-time model download, 4 GB+ GPU VRAM or 16 GB+ RAM. If unavailable, you get a clear message and can still fix fields by hand.

## How timezone conversion works

Airline emails give *local wall-clock* times ("Depart 8:00 AM") with no timezone. The extension:

1. Maps each IATA airport code to its IANA timezone (`JFK` → `America/New_York`) using a table generated from the [OpenFlights](https://openflights.org/data.php) database (`data/airport-timezones.js` and the name lookup `data/airport-names.js`, regenerate both with `node tools/generate-airport-timezones.js`)
2. Converts each local time to UTC with the browser's built-in `Intl` API, which knows all DST rules — no timezone libraries
3. Puts UTC (`Z`-suffixed) times in the Google Calendar URL, so the event lands at the correct instant no matter what timezone your calendar displays

## Supported airlines

Delta, United, American, Southwest, JetBlue, Spirit, Frontier, Alaska, Hawaiian, Air Canada, WestJet, British Airways, Lufthansa, Emirates, Qatar Airways, Singapore Airlines, Cathay Pacific, Qantas, Ryanair, easyJet, Air France, KLM, Turkish Airlines, Etihad, Virgin Atlantic, Iberia, Swiss, Austrian, SAS, Finnair, TAP Portugal, Aeromexico, LATAM, Avianca, Copa, Volaris, Sun Country, Breeze, Allegiant, Norse Atlantic, Korean Air, ANA, JAL, Air India, and more.

The parser is regex-based with an on-device AI fallback — unusual layouts that both miss can still be fixed in the editable preview.

## Project structure

```
flight-to-gcal/
├── manifest.json                       # MV3, zero permissions
├── content/
│   └── parser.js                       # Flight text parsing engine (regex, 40+ airlines)
├── data/
│   ├── airport-timezones.js            # Generated IATA → IANA map (5,500+ airports)
│   └── airport-names.js                # Generated name/city → IATA lookup (14,000+ keys)
├── lib/
│   ├── timezone.js                     # Local-time → UTC conversion via Intl (DST-safe)
│   └── calendar.js                     # Event building, GCal URLs, .ics generation
├── popup/
│   ├── popup.html                      # Tabbed popup UI
│   ├── popup.css
│   ├── popup.js                        # .ics upload flow
│   ├── paste.js                        # Paste-flight flow
│   ├── ai-fallback.js                  # Chrome built-in Prompt API (Gemini Nano) fallback
│   └── ical.min.js                     # Bundled ical.js (for .ics uploads)
├── tools/
│   └── generate-airport-timezones.js   # Dev-time dataset generator (not shipped logic)
└── test/
    ├── run.js                          # node test/run.js — 97 assertions, no deps
    └── samples/                        # Realistic airline confirmation texts
```

## Development

```sh
node test/run.js                            # parser + timezone + event + AI-normalization tests
node tools/generate-airport-timezones.js    # refresh both airport datasets (network, dev-only)
```

The AI fallback can't run under Node — its normalization logic is covered by `test/run.js`, and the full popup flow (including a stubbed `LanguageModel`) is exercised with a Playwright browser test. To test the real model manually: use Chrome 138+, parse a confirmation the regexes can't read (e.g. reworded prose), and confirm the leg card shows the purple **on-device AI** badge with correct airports and timezones.

## Limitations

- Pattern matching + on-device AI, not cloud ML — works best on standard US-carrier confirmation emails
- The AI fallback needs Chrome 138+ and a one-time Gemini Nano download; without it you'll get a clear message instead
- Arrival times missing from the email default to departure + 3 hours (flagged in the event description)
- No Gmail integration (by design — no host permissions); copy/paste is the flow
