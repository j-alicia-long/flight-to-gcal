# ICS and Flights to Google Calendar — Chrome Extension

A Chrome extension that detects airline confirmation emails in Gmail, extracts flight details, and lets you:

1. **Add flights to Google Calendar** automatically
2. **Copy flight numbers** for quick entry into Flighty's free search bar

## Features

- Detects 40+ airlines (Delta, United, American, Southwest, JetBlue, etc.)
- Extracts flight number, date, airports, times, confirmation code, and passenger name
- Floating "Flight Detected" button appears on airline emails in Gmail
- Clean modal UI showing parsed flight details
- One-click Google Calendar event creation with reminders
- One-click copy of flight number for Flighty search

## Setup

### 1. Load the Extension in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `ics-and-flights-to-gcal` folder

### 2. Set Up Google Calendar Integration (Optional)

To enable the "Add to Google Calendar" feature, you need a Google Cloud OAuth2 client ID:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Enable the **Google Calendar API**:
   - Go to APIs & Services → Library
   - Search for "Google Calendar API" → Enable
4. Create OAuth2 credentials:
   - Go to APIs & Services → Credentials
   - Click **Create Credentials** → **OAuth client ID**
   - Application type: **Chrome Extension**
   - Extension ID: Copy from `chrome://extensions/` (shown under your loaded extension)
   - Click **Create**
5. Copy the **Client ID** (looks like `xxxx.apps.googleusercontent.com`)
6. Open `manifest.json` and replace `YOUR_CLIENT_ID.apps.googleusercontent.com` with your actual Client ID
7. Reload the extension in `chrome://extensions/`

### 3. Using the Extension

1. Open Gmail in Chrome
2. Open an airline confirmation email
3. A purple **"Flight Detected"** button appears in the bottom-right corner
4. Click it to see extracted flight details
5. Choose:
   - **Add to Google Calendar** — creates a calendar event with flight details + reminders
   - **Copy for Flighty** — copies the flight number to clipboard; paste into Flighty's search bar

## How to Add Flights to Flighty (Free)

Since Flighty's automated import features require Pro, here's the free workflow:

1. This extension extracts and copies the flight number for you
2. Open the Flighty app on your phone
3. Tap the **+** button or search bar
4. Enter the flight number (e.g., `DL 1234`) and date
5. Flighty will find and track the flight — **completely free**

## Supported Airlines

Delta, United, American, Southwest, JetBlue, Spirit, Frontier, Alaska, Hawaiian, Air Canada, WestJet, British Airways, Lufthansa, Emirates, Qatar Airways, Singapore Airlines, Cathay Pacific, Qantas, Ryanair, easyJet, Air France, KLM, Turkish Airlines, Etihad, Virgin Atlantic, Iberia, Swiss, Austrian, SAS, Finnair, TAP Portugal, Aeromexico, LATAM, Avianca, Copa, Volaris, Sun Country, Breeze, Allegiant, Norse Atlantic, Korean Air, ANA, JAL, Air India, and more.

## Project Structure

```
ics-and-flights-to-gcal/
├── manifest.json              # Chrome extension manifest
├── background/
│   └── service-worker.js      # Google Calendar API integration
├── content/
│   ├── parser.js              # Flight email parsing engine
│   ├── content.js             # Gmail content script (UI + detection)
│   └── content.css            # Styles for floating button + modal
├── popup/
│   ├── popup.html             # Extension popup UI
│   ├── popup.css              # Popup styles
│   └── popup.js               # Popup logic
└── README.md
```

## Notes

- The extension only runs on `mail.google.com` — it does not access any other sites
- No data is sent to any external server (except Google Calendar API when you click "Add to Calendar")
- Email parsing happens entirely in your browser
- Google Calendar auth uses Chrome's built-in identity API (secure OAuth2 flow)
