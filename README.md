# Flight to Google Calendar — Chrome Extension

Paste your flight confirmation email text into a popup, get timezone-correct Google Calendar events. Also handles plain `.ics` file uploads.

**Everything runs locally in your browser.** No servers, no APIs, no accounts, no permissions. The only thing that ever leaves the extension is the Google Calendar tab it opens for you.

## Features

### Paste flight mode (primary)
- Paste confirmation text from any airline email (Delta, United, American, Southwest, JetBlue, and 40+ more)
- Extracts flight number, airline, date, airports, departure/arrival times, confirmation code, passenger name
- **Timezone-correct**: departure time uses the departure airport's timezone, arrival uses the arrival airport's — DST handled automatically via a bundled map of 5,500+ airports
- Editable preview: fix any field the parser got wrong before adding
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
- No network requests at runtime — the airport timezone database is bundled with the extension
- No analytics, no tracking, nothing stored
- Your text is parsed in the popup and discarded when it closes

## How timezone conversion works

Airline emails give *local wall-clock* times ("Depart 8:00 AM") with no timezone. The extension:

1. Maps each IATA airport code to its IANA timezone (`JFK` → `America/New_York`) using a table generated from the [OpenFlights](https://openflights.org/data.php) database (`data/airport-timezones.js`, regenerate with `node tools/generate-airport-timezones.js`)
2. Converts each local time to UTC with the browser's built-in `Intl` API, which knows all DST rules — no timezone libraries
3. Puts UTC (`Z`-suffixed) times in the Google Calendar URL, so the event lands at the correct instant no matter what timezone your calendar displays

## Supported airlines

Delta, United, American, Southwest, JetBlue, Spirit, Frontier, Alaska, Hawaiian, Air Canada, WestJet, British Airways, Lufthansa, Emirates, Qatar Airways, Singapore Airlines, Cathay Pacific, Qantas, Ryanair, easyJet, Air France, KLM, Turkish Airlines, Etihad, Virgin Atlantic, Iberia, Swiss, Austrian, SAS, Finnair, TAP Portugal, Aeromexico, LATAM, Avianca, Copa, Volaris, Sun Country, Breeze, Allegiant, Norse Atlantic, Korean Air, ANA, JAL, Air India, and more.

The parser is regex-based, so unusual email layouts can miss fields — that's what the editable preview is for.

## Project structure

```
flight-to-gcal/
├── manifest.json                       # MV3, zero permissions
├── content/
│   └── parser.js                       # Flight text parsing engine (regex, 40+ airlines)
├── data/
│   └── airport-timezones.js            # Generated IATA → IANA map (5,500+ airports)
├── lib/
│   ├── timezone.js                     # Local-time → UTC conversion via Intl (DST-safe)
│   └── calendar.js                     # Event building, GCal URLs, .ics generation
├── popup/
│   ├── popup.html                      # Tabbed popup UI
│   ├── popup.css
│   ├── popup.js                        # .ics upload flow
│   ├── paste.js                        # Paste-flight flow
│   └── ical.min.js                     # Bundled ical.js (for .ics uploads)
├── tools/
│   └── generate-airport-timezones.js   # Dev-time dataset generator (not shipped logic)
└── test/
    ├── run.js                          # node test/run.js — 61 assertions, no deps
    └── samples/                        # Realistic airline confirmation texts
```

## Development

```sh
node test/run.js                            # parser + timezone + event tests
node tools/generate-airport-timezones.js    # refresh the airport dataset (network, dev-only)
```

## Limitations

- Regex parsing, not ML — works best on standard US-carrier confirmation emails
- Arrival times missing from the email default to departure + 3 hours (flagged in the event description)
- No Gmail integration (by design — no host permissions); copy/paste is the flow
