/**
 * Flight to Google Calendar — Paste-mode script
 * Textarea → FlightParser → editable leg cards → GCal URL / .ics download.
 * Everything runs locally; the only navigation is to calendar.google.com.
 */

(() => {
  const textarea = document.getElementById('flightText');
  const parseBtn = document.getElementById('parseBtn');
  const flightPreview = document.getElementById('flight-preview');
  const flightList = document.getElementById('flight-list');
  const pasteStatus = document.getElementById('paste-status');
  const pasteZone = document.querySelector('.paste-zone');

  let segments = []; // parsed + user-edited flight segments

  // ─── Tabs ─────────────────────────────────────────────────────────────────

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.tab-pane').forEach(p =>
        p.classList.toggle('active', p.id === `tab-${tab.dataset.tab}`));
    });
  });

  // ─── Parse ────────────────────────────────────────────────────────────────

  parseBtn.addEventListener('click', () => {
    const text = textarea.value.trim();
    if (!text) {
      showPasteStatus('Paste your flight confirmation text first.', 'error');
      return;
    }
    hidePasteStatus();

    segments = FlightParser.parseEmail(text);
    if (!segments.length) {
      showPasteStatus('No flights found. Make sure the text includes a flight number, airports, and times.', 'error');
      return;
    }
    renderFlights();
    pasteZone.classList.add('collapsed');
    flightPreview.style.display = 'block';
    requestAnimationFrame(() => flightPreview.classList.add('fade-in'));
  });

  // ─── Render editable cards ────────────────────────────────────────────────

  function renderFlights() {
    let html = '';
    if (segments.length > 1) {
      html += `<p class="events-header">${segments.length} flight legs found — check each, then add</p>`;
      html += `<button class="btn-open-all" id="addAllBtn">Add all to Google Calendar</button>`;
    }

    html += segments.map((seg, i) => {
      const title = [seg.airlineName || seg.airlineCode, seg.flightNumber].filter(Boolean).join(' — ') || 'Flight';
      return `
        <div class="event-card flight-card" data-index="${i}">
          <div class="ev-title">${escapeHtml(title)}</div>
          ${seg.confirmationCode ? `<div class="ev-meta"><span>Confirmation: ${escapeHtml(seg.confirmationCode)}</span></div>` : ''}
          <div class="flight-fields">
            <label>Date
              <input type="date" data-field="date" value="${escapeAttr(seg.date || '')}">
            </label>
            <label>From
              <input type="text" data-field="departure" maxlength="3" placeholder="JFK" value="${escapeAttr(seg.departure || '')}">
            </label>
            <label>To
              <input type="text" data-field="arrival" maxlength="3" placeholder="LAX" value="${escapeAttr(seg.arrival || '')}">
            </label>
            <label>Departs
              <input type="time" data-field="departureTime" value="${escapeAttr(seg.departureTime || '')}">
            </label>
            <label>Arrives
              <input type="time" data-field="arrivalTime" value="${escapeAttr(seg.arrivalTime || '')}">
            </label>
          </div>
          <div class="tz-summary" data-tz-summary></div>
          <div class="field-error" data-error style="display:none;"></div>
          <div class="ev-actions">
            <button class="btn btn-gcal" data-action="gcal">Add to Google Calendar</button>
          </div>
        </div>
      `;
    }).join('');

    html += `
      <div class="ev-actions ics-download-wrap">
        <button class="btn btn-outline" id="downloadIcsBtn">Download .ics${segments.length > 1 ? ' (all legs)' : ''}</button>
      </div>
      <div class="reset-link-wrap">
        <a href="#" id="pasteResetBtn" class="reset-link">Parse different text</a>
      </div>`;

    flightList.innerHTML = html;

    // Live-update segment data + timezone summary on edit
    flightList.querySelectorAll('.flight-card').forEach((card) => {
      card.querySelectorAll('input').forEach((input) => {
        input.addEventListener('input', () => {
          const i = parseInt(card.dataset.index);
          const field = input.dataset.field;
          let val = input.value.trim();
          if (field === 'departure' || field === 'arrival') val = val.toUpperCase();
          segments[i][field] = val || null;
          updateTzSummary(card, segments[i]);
        });
      });
      card.querySelector('[data-action="gcal"]').addEventListener('click', () => {
        addToCalendar(card, segments[parseInt(card.dataset.index)]);
      });
      updateTzSummary(card, segments[parseInt(card.dataset.index)]);
    });

    const addAllBtn = document.getElementById('addAllBtn');
    if (addAllBtn) {
      addAllBtn.addEventListener('click', () => {
        const cards = [...flightList.querySelectorAll('.flight-card')];
        const results = cards.map((card, i) => ({ card, res: FlightCalendar.flightToEvent(segments[i]) }));
        const bad = results.find(r => !r.res.ok);
        if (bad) {
          showCardError(bad.card, bad.res.error);
          return;
        }
        results.forEach(({ res }, i) => {
          setTimeout(() => chrome.tabs.create({ url: FlightCalendar.buildGCalUrl(res.event), active: false }), i * 300);
        });
      });
    }

    document.getElementById('downloadIcsBtn').addEventListener('click', downloadIcs);
    document.getElementById('pasteResetBtn').addEventListener('click', (e) => {
      e.preventDefault();
      resetPasteUI();
    });
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  function addToCalendar(card, seg) {
    const res = FlightCalendar.flightToEvent(seg);
    if (!res.ok) {
      showCardError(card, res.error);
      return;
    }
    hideCardError(card);
    chrome.tabs.create({ url: FlightCalendar.buildGCalUrl(res.event) });
  }

  function downloadIcs() {
    const events = [];
    const cards = [...flightList.querySelectorAll('.flight-card')];
    for (let i = 0; i < segments.length; i++) {
      const res = FlightCalendar.flightToEvent(segments[i]);
      if (!res.ok) {
        showCardError(cards[i], res.error);
        return;
      }
      events.push(res.event);
    }
    const blob = new Blob([FlightCalendar.buildIcs(events)], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'flights.ics';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── Timezone summary line ("8:00 AM EDT → 11:15 AM PDT") ─────────────────

  function updateTzSummary(card, seg) {
    const el = card.querySelector('[data-tz-summary]');
    hideCardError(card);
    const res = FlightCalendar.flightToEvent(seg);
    if (!res.ok) {
      el.textContent = '';
      return;
    }
    const ev = res.event;
    const dep = `${fmtTime(seg.departureTime)} ${FlightTz.zoneAbbreviation(ev.startUtc, ev.depTz)}`;
    const arr = seg.arrivalTime
      ? `${fmtTime(seg.arrivalTime)} ${FlightTz.zoneAbbreviation(ev.endUtc, ev.arrTz)}${ev.arrDate !== seg.date ? ' (+1 day)' : ''}`
      : 'arrival estimated (+3h)';
    const hrs = ((ev.endUtc - ev.startUtc) / 3600000).toFixed(1).replace(/\.0$/, '');
    el.textContent = `${dep} → ${arr} · ${hrs}h`;
  }

  function fmtTime(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const ap = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ap}`;
  }

  // ─── UI helpers ───────────────────────────────────────────────────────────

  function showCardError(card, msg) {
    const el = card.querySelector('[data-error]');
    el.textContent = msg;
    el.style.display = 'block';
  }

  function hideCardError(card) {
    const el = card.querySelector('[data-error]');
    el.style.display = 'none';
  }

  function resetPasteUI() {
    flightPreview.style.display = 'none';
    flightPreview.classList.remove('fade-in');
    flightList.innerHTML = '';
    pasteZone.classList.remove('collapsed');
    segments = [];
    hidePasteStatus();
  }

  function showPasteStatus(msg, type) {
    pasteStatus.textContent = msg;
    pasteStatus.className = `status status-${type}`;
    pasteStatus.style.display = 'block';
  }

  function hidePasteStatus() {
    pasteStatus.style.display = 'none';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
})();
