/**
 * ICS to Google Calendar — Popup Script
 * Parses .ics files using ical.js and generates Google Calendar template URLs.
 */

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('fileInput');
const preview = document.getElementById('event-preview');
const eventList = document.getElementById('event-list');
const statusEl = document.getElementById('status');

// Store parsed GCal URLs for "Open All"
let parsedUrls = [];

// Store file groups: [{ filename, events: [{ event, url }] }]
let fileGroups = [];

// ─── File Input ───────────────────────────────────────────────────────────────

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.ics'));
  if (files.length) {
    processFiles(files);
  } else {
    showStatus('Please drop valid .ics file(s).', 'error');
  }
});

fileInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files).filter(f => f.name.endsWith('.ics'));
  if (files.length) processFiles(files);
});

// ─── Loading State ───────────────────────────────────────────────────────────

function showLoading() {
  dropZone.classList.add('loading');
  dropZone.querySelector('p').innerHTML = 'Parsing events<span class="loading-dots"></span>';
}

function hideLoading() {
  dropZone.classList.remove('loading');
  dropZone.querySelector('p').innerHTML = 'Drop <strong>.ics</strong> file(s) here<br><span>or click to browse</span>';
}

// ─── File Processing ──────────────────────────────────────────────────────────

function processFiles(files) {
  let remaining = files.length;
  let errors = [];
  fileGroups = [];
  parsedUrls = [];
  showLoading();

  files.forEach((file) => {
    const reader = new FileReader();
    reader.onerror = () => {
      errors.push(file.name);
      remaining--;
      if (remaining === 0) finishProcessing(errors);
    };
    reader.onload = () => {
      try {
        const group = parseFile(file.name, reader.result);
        if (group) fileGroups.push(group);
      } catch (err) {
        console.error(`ICS parse error (${file.name}):`, err);
        errors.push(file.name);
      }
      remaining--;
      if (remaining === 0) finishProcessing(errors);
    };
    reader.readAsText(file);
  });
}

function parseFile(filename, icsText) {
  const jcalData = ICAL.parse(icsText);
  const comp = new ICAL.Component(jcalData);
  const vevents = comp.getAllSubcomponents('vevent');

  if (!vevents.length) return null;

  const events = vevents.map((ve) => {
    const event = new ICAL.Event(ve);
    const url = buildGCalUrl(event);
    parsedUrls.push(url);
    return { event, url };
  });

  return { filename, events };
}

function finishProcessing(errors) {
  hideLoading();

  if (!fileGroups.length) {
    showStatus(
      errors.length
        ? `Could not parse: ${errors.join(', ')}`
        : 'No events found in the uploaded file(s).',
      'error'
    );
    return;
  }

  renderEvents(fileGroups);
  if (errors.length) {
    showStatus(`Could not parse: ${errors.join(', ')}`, 'error');
  } else {
    hideStatus();
  }

  // Animate transition from drop zone to event list
  dropZone.classList.add('fade-out');
  setTimeout(() => {
    dropZone.style.display = 'none';
    dropZone.classList.remove('fade-out');
    preview.style.display = 'block';
    preview.classList.add('fade-in');
  }, 200);
}

// ─── Google Calendar URL Builder ──────────────────────────────────────────────

function isAllDay(icalDate) {
  return icalDate && icalDate.isDate;
}

function formatDateAllDay(icalDate) {
  // All-day format: YYYYMMDD (no time, no Z)
  if (!icalDate) return '';
  const y = String(icalDate.year).padStart(4, '0');
  const m = String(icalDate.month).padStart(2, '0');
  const d = String(icalDate.day).padStart(2, '0');
  return `${y}${m}${d}`;
}

function formatDateTimed(icalDate) {
  // Timed format: YYYYMMDDTHHMMSS (no Z — we pass ctz separately)
  if (!icalDate) return '';
  const y = String(icalDate.year).padStart(4, '0');
  const mo = String(icalDate.month).padStart(2, '0');
  const d = String(icalDate.day).padStart(2, '0');
  const h = String(icalDate.hour).padStart(2, '0');
  const mi = String(icalDate.minute).padStart(2, '0');
  const s = String(icalDate.second).padStart(2, '0');
  return `${y}${mo}${d}T${h}${mi}${s}`;
}

function buildGCalUrl(event) {
  const allDay = isAllDay(event.startDate);
  const formatDate = allDay ? formatDateAllDay : formatDateTimed;

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.summary || 'Untitled Event',
    dates: `${formatDate(event.startDate)}/${formatDate(event.endDate)}`,
    details: event.description || '',
    location: event.location || ''
  });

  // Preserve timezone for timed events
  if (!allDay && event.startDate && event.startDate.timezone) {
    const tz = event.startDate.timezone;
    // Skip floating/UTC — GCal handles those fine without ctz
    if (tz !== 'floating' && tz !== 'UTC' && tz !== 'Z') {
      params.set('ctz', tz);
    }
  }

  // Preserve recurrence rules
  const vevent = event.component;
  if (vevent) {
    const rruleProp = vevent.getFirstProperty('rrule');
    if (rruleProp) {
      params.set('recur', `RRULE:${rruleProp.getFirstValue().toString()}`);
    }
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderEvents(groups) {
  let html = '';
  const totalEvents = groups.reduce((sum, g) => sum + g.events.length, 0);
  const multiFile = groups.length > 1;

  if (totalEvents > 1) {
    html += `<p class="events-header">${totalEvents} events from ${groups.length} file${groups.length > 1 ? 's' : ''}</p>`;
    html += `<button class="btn-open-all" id="openAllBtn">Open All in Google Calendar</button>`;
  }

  let globalIndex = 0;
  groups.forEach(({ filename, events }) => {
    if (multiFile) {
      html += `<div class="file-group-label">${escapeHtml(filename)}</div>`;
    }

    html += events.map(({ event, url }) => {
      const allDay = isAllDay(event.startDate);
      const start = event.startDate ? event.startDate.toJSDate() : null;
      const end = event.endDate ? event.endDate.toJSDate() : null;
      let timeRange;
      if (!start) {
        timeRange = 'No date';
      } else if (allDay) {
        timeRange = formatDateOnly(start);
        if (end && !isSameDay(start, end) && !isSameDay(start, new Date(end - 86400000))) {
          // Multi-day all-day event: show end date (subtract 1 day since ICS end is exclusive)
          timeRange += ` — ${formatDateOnly(new Date(end - 86400000))}`;
        }
      } else if (end && !isSameDay(start, end)) {
        // Cross-day timed event: show full date+time for both
        timeRange = `${formatDateTime(start)} — ${formatDateTime(end)}`;
      } else {
        const dateStr = formatDateTime(start);
        const endStr = end ? formatTime(end) : '';
        timeRange = endStr ? `${dateStr} — ${endStr}` : dateStr;
      }
      const idx = globalIndex++;

      return `
        <div class="event-card">
          <div class="ev-title">${escapeHtml(event.summary || 'Untitled Event')}</div>
          <div class="ev-meta">
            <span>${timeRange}</span>
            ${event.location ? `<span>${escapeHtml(event.location)}</span>` : ''}
          </div>
          <div class="ev-actions">
            <button class="btn btn-gcal" data-index="${idx}">Open in Google Calendar</button>
          </div>
        </div>
      `;
    }).join('');
  });

  // "Upload another" link
  html += `<div class="reset-link-wrap">
    <a href="#" id="resetBtn" class="reset-link">Upload more files</a>
  </div>`;

  eventList.innerHTML = html;

  // Attach listeners
  eventList.querySelectorAll('.btn-gcal').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.dataset.index);
      chrome.tabs.create({ url: parsedUrls[idx] });
    });
  });

  const openAllBtn = document.getElementById('openAllBtn');
  if (openAllBtn) {
    openAllBtn.addEventListener('click', () => {
      // Stagger tab opens to avoid overwhelming the browser
      parsedUrls.forEach((url, i) => {
        setTimeout(() => chrome.tabs.create({ url, active: false }), i * 300);
      });
    });
  }

  document.getElementById('resetBtn').addEventListener('click', (e) => {
    e.preventDefault();
    resetUI();
  });
}

function resetUI() {
  preview.style.display = 'none';
  preview.classList.remove('fade-in');
  dropZone.style.display = '';
  dropZone.classList.remove('fade-out');
  eventList.innerHTML = '';
  fileInput.value = '';
  parsedUrls = [];
  fileGroups = [];
  hideStatus();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit'
  });
}

function formatDateOnly(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
  });
}

function formatTime(date) {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = `status status-${type}`;
  statusEl.style.display = 'block';
}

function hideStatus() {
  statusEl.style.display = 'none';
}
