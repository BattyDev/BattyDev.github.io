import { activities, activitySuggestionLimit, cleanDraft, cleanResponse, communityActivityId, dates, emptyResponse, participation, presets, statuses, validateWindows } from './survey.js?v=3';
import { publishableKey, submissionUrl } from './config.js?v=2';

const draftKey = 'adcock-holiday-2026';
const resumeKey = draftKey + '-resume';
const catalogKey = draftKey + '-activity-ideas';
const stepPanel = document.querySelector('#step');
const form = document.querySelector('#survey-form');
const navigation = document.querySelector('#navigation');
const error = document.querySelector('#form-error');
const progress = document.querySelector('#progress');
const draftStatus = document.querySelector('#draft-status');
const dateLabel = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const fullDateLabel = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
const timeLabel = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
const dateObject = (iso) => {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
};
const displayTime = (time) => timeLabel.format(new Date('2026-12-19T' + time + ':00Z')).replace(':00', '').toLowerCase();
const escape = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const activityPages = [activities.slice(0, 4), activities.slice(4, 8), activities.slice(8)];

function readCache(key) {
  for (const storage of ['localStorage', 'sessionStorage']) {
    try {
      const value = window[storage].getItem(key);
      if (value) return JSON.parse(value);
    } catch { /* Some private browsing contexts block browser storage. */ }
  }
  return null;
}

function loadDraft(saved) {
  try {
    return cleanDraft({
      ...saved,
      step: saved?.step || (saved?.sent ? 'done' : saved?.response?.name ? 'days' : 'name'),
      revision: saved?.revision ?? 0,
    });
  } catch { return null; }
}

const cached = readCache(draftKey);
const saved = loadDraft(cached);
let community = readCache(catalogKey) || [];
let state = saved?.response || emptyResponse();
let token = cached?.token || readCache(resumeKey) || '';
let sent = saved?.sent || false;
let step = saved?.step || 'name';
let busy = false;
let template = saved?.template || [];
let revision = saved?.revision || 0;
let syncedRevision = 0;
let writingRevision = 0;
let syncTimer;
let cachedHere = Boolean(saved);

const snapshot = () => ({ response: state, sent, step, template, revision });

function writeCache() {
  const data = JSON.stringify({ ...snapshot(), token });
  for (const storage of ['localStorage', 'sessionStorage']) {
    try {
      window[storage].setItem(resumeKey, JSON.stringify(token));
      window[storage].setItem(draftKey, data);
      return true;
    } catch { /* Fall back to storage that lasts for the current tab. */ }
  }
  return false;
}

function showDraftStatus(message) {
  draftStatus.textContent = message;
  draftStatus.hidden = !message || step === 'done';
}

function sendToSurvey(payload, keepalive = false) {
  return fetch(submissionUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: publishableKey },
    body: JSON.stringify({ ...payload, token }),
    signal: AbortSignal.timeout(20000),
    keepalive,
  });
}

async function loadCommunity() {
  if (!submissionUrl) return;
  try {
    const result = await sendToSurvey({ action: 'list_activities' });
    if (!result.ok) return;
    const { activities: ideas } = await result.json();
    community = ideas.filter(({ id, label }) => communityActivityId.test('community-' + id) &&
      typeof label === 'string' && label.length > 0 && label.length <= activitySuggestionLimit)
      .map(({ id, label }) => ['community-' + id, label, '💡']);
    try { window.localStorage.setItem(catalogKey, JSON.stringify(community)); } catch { /* An online list still works. */ }
  } catch { /* Keep the last loaded list when offline. */ }
}

async function syncDraft() {
  clearTimeout(syncTimer);
  if (!submissionUrl || !token || revision <= Math.max(syncedRevision, writingRevision)) return;
  const sentRevision = revision;
  writingRevision = sentRevision;
  try {
    const result = await sendToSurvey({ action: 'save_draft', draft: snapshot() }, true);
    if (!result.ok) throw Error('Could not sync draft.');
    syncedRevision = Math.max(syncedRevision, sentRevision);
    if (revision === sentRevision) showDraftStatus('Draft saved.');
  } catch {
    if (revision === sentRevision) showDraftStatus(cachedHere ? 'Saved on this device. Waiting to sync.' : 'Draft could not be saved yet.');
  } finally {
    if (writingRevision === sentRevision) writingRevision = 0;
  }
}

function save(syncNow = false) {
  token ||= crypto.randomUUID();
  revision = Math.max(Date.now(), revision + 1);
  cachedHere = writeCache();
  showDraftStatus(cachedHere ? 'Saved on this device.' : 'Saving draft…');
  clearTimeout(syncTimer);
  if (syncNow) void syncDraft();
  else syncTimer = setTimeout(syncDraft, 500);
}

async function restoreCloudDraft() {
  if (!submissionUrl || !token) return;
  const startingRevision = revision;
  try {
    const result = await sendToSurvey({ action: 'load_draft' });
    if (!result.ok) return;
    const { draft } = await result.json();
    if (revision !== startingRevision) return;
    if (draft && draft.revision > revision) {
      // A refresh can race the previous tab’s final write. Only restore until local editing resumes.
      const remote = cleanDraft(draft);
      ({ response: state, sent, step, template, revision } = remote);
      cachedHere = writeCache();
      syncedRevision = revision;
      render();
      showDraftStatus('Draft saved.');
    } else if (draft?.revision === revision) {
      syncedRevision = revision;
      showDraftStatus('Draft saved.');
    } else {
      void syncDraft();
    }
  } catch { /* The cached draft still works offline. */ }
}

const selectedDates = () => dates.filter((iso) => state.days[iso]?.status);
const daysPerPage = 4;
const timePageCount = () => Math.ceil(selectedDates().length / daysPerPage);
const datesOnPage = (index) => selectedDates().slice(index * daysPerPage, (index + 1) * daysPerPage);
const ideasPerPage = 4;
const steps = () => [
  ['name', 'First name'], ['days', 'Days'],
  ...Array.from({ length: timePageCount() }, (_, index) => ['times-' + index, 'Times']),
  ['activity-0', 'Activities'], ['activity-1', 'Activities'], ['activity-2', 'Activities'],
  ...Array.from({ length: Math.ceil(community.length / ideasPerPage) }, (_, index) => ['suggested-' + index, 'Family ideas']),
  ['food', 'Food'], ['review', 'Review'],
];

const heading = (title, description = '') =>
  '<h1 id="step-heading" tabindex="-1">' + title + '</h1>' + (description ? '<p class="intro">' + description + '</p>' : '');
const button = (label, action, attrs = '', css = 'quiet') =>
  '<button type="button" class="' + css + '" data-action="' + action + '" ' + attrs + '>' + label + '</button>';
const iconMarks = ['–', '?', '✓'];

function calendar() {
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const offset = dateObject(dates[0]).getDay();
  const days = dates.map((iso) => {
    const status = state.days[iso]?.status || 0;
    return '<button type="button" class="day day-' + status + '" data-action="day" data-date="' + iso + '" aria-label="' +
      fullDateLabel.format(dateObject(iso)) + ', ' + statuses[status] + '. Tap to change.">' +
      '<span class="day-month">' + (iso.startsWith('2026') ? 'Dec' : 'Jan') + '</span><strong>' +
      dateObject(iso).getDate() + '</strong><span aria-hidden="true">' + iconMarks[status] + '</span></button>';
  }).join('');
  return heading('Which days work?', 'Tap a date once for “Could make it” or twice for “Definitely available.” A third tap clears it.') +
    '<div class="legend">' + statuses.map((label, index) => '<span><b class="day-' + index + '" aria-hidden="true">' + iconMarks[index] + '</b>' + label + '</span>').join('') + '</div>' +
    '<div class="calendar">' + weekdays.map((label) => '<span class="weekday">' + label + '</span>').join('') +
    '<span aria-hidden="true"></span>'.repeat(offset) + days + '</div>' +
    '<p class="help" role="status">' + selectedDates().length + ' of 14 days selected</p>';
}

function presetButtons(iso, windows) {
  return '<div class="presets" aria-label="Quick time windows">' + presets.map(([label, start, end], index) => {
    const pressed = windows.length === 1 && windows[0][0] === start && windows[0][1] === end;
    return button(label, 'preset', 'data-date="' + iso + '" data-index="' + index + '" aria-pressed="' + pressed + '"');
  }).join('') + '</div>';
}

function timeFields(iso, windows) {
  return windows.map(([start, end], index) => '<div class="window">' +
    '<label>Start<input type="time" min="09:00" max="21:00" data-date="' + iso + '" data-index="' + index + '" data-end="0" value="' + escape(start) + '"></label>' +
    '<label>End<input type="time" min="09:00" max="21:00" data-date="' + iso + '" data-index="' + index + '" data-end="1" value="' + escape(end) + '"></label>' +
    (windows.length > 1 ? button('<span aria-hidden="true">×</span>', 'remove-window', 'data-date="' + iso + '" data-index="' + index + '" aria-label="Remove window ' + (index + 1) + '"', 'quiet remove') : '') +
    '</div>').join('');
}

function timePage(index) {
  const count = timePageCount();
  const description = index === 0 ? 'Choose the full window you’re open. We’ll use it to find a time that works for the most people. All times are Mountain Time.' : 'Check your time windows for these dates. All times are Mountain Time.';
  return heading('When are you free?', description) +
    (count > 1 ? '<p class="help">Times ' + (index + 1) + ' of ' + count + '</p>' : '') +
    (index === 0 && selectedDates().length > 1 ? '<div class="template subcard"><h2>Same hours on several days?</h2>' +
      presetButtons('template', template) + timeFields('template', template.length ? template : [['', '']]) +
      button('Apply to days without times', 'apply-template') + '</div>' : '') +
    datesOnPage(index).map((iso) => {
      const day = state.days[iso];
      const windows = day.windows.length ? day.windows : [['', '']];
      const dateAttributes = 'data-date="' + iso + '"';
      return '<section class="subcard time-card" data-day="' + iso + '"><div class="time-title"><h2>' +
        dateLabel.format(dateObject(iso)) + '</h2><span class="badge day-' + day.status + '">' + statuses[day.status] + '</span></div>' +
        presetButtons(iso, windows) + timeFields(iso, windows) + '<div class="time-actions">' +
        (windows.length < 6 ? button('+ Add another window', 'add-window', dateAttributes) : '') +
        button('Clear times', 'clear-times', dateAttributes) +
        button('Mark unavailable', 'mark-unavailable', dateAttributes) + '</div>' +
        '<details ' + (day.note ? 'open' : '') + '><summary>Add a note for this day</summary><label class="sr-only" for="note-' + iso + '">Anything we should know about ' + dateLabel.format(dateObject(iso)) + '?</label>' +
        '<textarea id="note-' + iso + '" data-date="' + iso + '" maxlength="500" rows="2" placeholder="Anything we should know about this day?">' + escape(day.note) + '</textarea></details></section>';
    }).join('');
}

function activityCards(items) {
  return items.map(([id, label, emoji, location]) => '<fieldset class="subcard activity"><legend><span class="activity-name"><span class="activity-icon" aria-hidden="true"><span>' +
      emoji + '</span>' + (communityActivityId.test(id) ? '' : '<img src="assets/activities/' + id + '.png" width="44" height="44" alt="">') + '</span><span class="activity-label">' + escape(label) +
      (location ? '<small>' + location + '</small>' : '') + '</span></span></legend><div class="choices">' +
      participation.map(([value, choice]) => '<label><input type="radio" name="' + id + '" value="' + value + '" ' +
        (state.activities[id] === value ? 'checked' : '') + '><span>' + choice + '</span></label>').join('') +
      '</div>' + (state.activities[id] ? button('Clear choice', 'clear-activity', 'data-id="' + id + '"') : '') + '</fieldset>').join('');
}

function activityPage(index) {
  const writeIn = '<label class="field">Suggest another activity <span class="optional">Optional</span>' +
    '<input type="text" name="activitySuggestion" maxlength="' + activitySuggestionLimit + '" aria-describedby="activity-suggestion-help" value="' +
    escape(state.activitySuggestion) + '"></label>' +
    '<p class="help suggestion-help" id="activity-suggestion-help">After you submit, others can vote on your idea. They’ll see the activity title only.</p>';
  return heading('What sounds fun?', 'Activities ' + (index + 1) + ' of 3. Choose how you’d like to join in, or skip any item.') +
    activityCards(activityPages[index]) + (index === activityPages.length - 1 ? writeIn : '');
}

function suggestedPage(index) {
  const start = index * ideasPerPage;
  return heading('Family activity ideas', 'These ideas were suggested by other respondents. Vote on any that sound fun.') +
    activityCards(community.slice(start, start + ideasPerPage));
}

function foodPage() {
  return heading('What sounds good to eat?', 'Share any dishes, restaurants, or dietary needs you’d like us to consider.') +
    '<label class="field">Food ideas or requests <span class="optional">Optional</span>' +
    '<textarea name="foodNote" rows="4" maxlength="1000" placeholder="Pizza from a favorite spot, a taco night, gluten-free options…">' +
    escape(state.foodNote) + '</textarea></label>';
}

function reviewPage() {
  const dayRows = selectedDates().map((iso) => {
    const day = state.days[iso];
    const times = validateWindows(day.windows) ? day.windows.map(([start, end]) => displayTime(start) + '–' + displayTime(end)).join(', ') : 'Time window incomplete';
    return '<li><strong>' + dateLabel.format(dateObject(iso)) + '</strong> <span class="badge day-' + day.status + '">' +
      statuses[day.status] + '</span><br>' + times +
      (day.note ? '<br><span class="help">' + escape(day.note) + '</span>' : '') + '</li>';
  }).join('');
  const activityRows = [...activities, ...community].filter(([id]) => state.activities[id]).map(([id, label]) => '<li>' + escape(label) + ' <span class="help">· ' +
    participation.find(([value]) => value === state.activities[id])[1] + '</span></li>').join('');
  return heading('Ready to send?', 'Take a quick look before you share your response.') +
    '<div class="review-section"><h2>First name</h2>' + button('Edit first name', 'jump', 'data-step="name"') + '<p>' + escape(state.name) + '</p></div>' +
    '<div class="review-section"><h2>Availability</h2>' + button('Edit days', 'jump', 'data-step="days"') +
    (dayRows ? button('Edit times', 'jump', 'data-step="times-0"') + '<ul>' + dayRows + '</ul>' : '<p>No days selected.</p>') + '</div>' +
    '<div class="review-section"><h2>Activities</h2>' + button('Edit activities', 'jump', 'data-step="activity-0"') +
    (activityRows ? '<ul>' + activityRows + '</ul>' : '<p>No activities answered.</p>') +
    (state.activitySuggestion.trim() ? '<p><strong>Your suggestion</strong> ' + escape(state.activitySuggestion.trim()) + '</p>' : '') + '</div>' +
    '<div class="review-section"><h2>Food</h2>' + button('Edit food', 'jump', 'data-step="food"') +
    '<p class="food-note">' + escape(state.foodNote.trim() || 'No food suggestions added.') + '</p></div>';
}

function showError(message) {
  error.textContent = message;
  error.hidden = !message;
}

function render(focus = false) {
  const pages = steps();
  if (!(step === 'done' && sent) && !pages.some(([id]) => step === id)) step = step.startsWith('suggested-') ? 'activity-2' : 'days';
  const position = pages.findIndex(([id]) => step === id);
  const done = step === 'done';
  draftStatus.hidden = done || !draftStatus.textContent;
  const count = pages.length;
  const value = done ? count : position + 1;
  progress.innerHTML = '<span>' + (done ? 'Complete' : pages[position][1]) + '</span><span>' + value + ' / ' + count +
    '</span><progress value="' + value + '" max="' + count + '" aria-label="Survey progress"></progress>';
  if (step === 'name') stepPanel.innerHTML = heading('Let’s get together.', 'Tell us when you’re free from December 19 to January 1 and what you’d enjoy doing with the family.') +
    '<label class="field">First name<input type="text" name="name" autocomplete="given-name" required maxlength="80" value="' + escape(state.name) + '"></label>';
  if (step === 'days') stepPanel.innerHTML = calendar();
  if (step.startsWith('times-')) stepPanel.innerHTML = timePage(Number(step.at(-1)));
  if (step.startsWith('activity-')) stepPanel.innerHTML = activityPage(Number(step.at(-1)));
  if (step.startsWith('suggested-')) stepPanel.innerHTML = suggestedPage(Number(step.slice('suggested-'.length)));
  if (step === 'food') stepPanel.innerHTML = foodPage();
  if (step === 'review') stepPanel.innerHTML = reviewPage();
  if (done) stepPanel.innerHTML = heading('Thanks, ' + escape(state.name) + '!', 'Your response is saved. If your plans change, you can update it from this browser.');
  navigation.innerHTML = done ? button('Edit my response', 'jump', 'data-step="review"', 'primary') :
    (position > 0 ? button('Back', 'back') : '') + '<button class="primary" type="submit">' +
    (step === 'review' ? (sent ? 'Save changes' : 'Send response') : 'Continue') + '</button>';
  stepPanel.querySelectorAll('.activity-icon img').forEach((img) => {
    const loaded = () => img.parentElement.classList.add('loaded');
    img.addEventListener('load', loaded, { once: true });
    if (img.complete && img.naturalWidth) loaded();
  });
  showError('');
  if (focus) {
    document.querySelector('#step-heading').focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}

function timeAction(action, iso, index) {
  const isTemplate = iso === 'template';
  const day = state.days[iso];
  const windows = isTemplate ? template : day?.windows;
  if (action === 'preset') {
    const [, start, end] = presets[index];
    if (isTemplate) template = [[start, end]];
    else day.windows = windows.length === 1 && windows[0][0] === start && windows[0][1] === end ? [] : [[start, end]];
  }
  if (action === 'add-window') {
    if (!validateWindows(windows)) {
      showError('Finish the current time window before adding another.');
      return false;
    }
    windows.push(['', '']);
  }
  if (action === 'remove-window') windows.splice(index, 1);
  return true;
}

form.addEventListener('click', (event) => {
  const target = event.target.closest('button[data-action]');
  if (!target || busy) return;
  const { action, date, index } = target.dataset;
  if (action === 'jump' || action === 'back') {
    step = action === 'jump' ? target.dataset.step : steps()[steps().findIndex(([id]) => id === step) - 1][0];
    save(true);
    render(true);
    return;
  }
  if (action === 'day') {
    const day = state.days[date] || { status: 0, windows: [], note: '' };
    day.status = (day.status + 1) % statuses.length;
    if (day.status === 0) day.windows = [];
    state.days[date] = day;
  }
  if (action === 'clear-times') state.days[date].windows = [];
  if (action === 'mark-unavailable') {
    state.days[date].status = 0;
    state.days[date].windows = [];
    if (Number(step.at(-1)) >= timePageCount()) step = 'activity-0';
    save(true);
    render(true);
    return;
  }
  if (action === 'clear-activity') delete state.activities[target.dataset.id];
  if (action === 'apply-template') {
    if (!validateWindows(template)) { showError('Choose a valid time window to copy.'); return; }
    const blanks = selectedDates().filter((iso) => state.days[iso].windows.length === 0);
    if (!blanks.length) { showError('Every selected day already has hours. You can edit each day below.'); return; }
    for (const iso of blanks) state.days[iso].windows = template.map((window) => [...window]);
  }
  if (['preset', 'add-window', 'remove-window'].includes(action) && !timeAction(action, date, Number(index))) return;
  save();
  render();
  const focusTarget = action === 'add-window' ? Array.from(stepPanel.querySelectorAll('[data-day="' + date + '"] input[data-end="0"]')).at(-1) :
    action === 'clear-activity' ? stepPanel.querySelector('input[name="' + target.dataset.id + '"]') :
      stepPanel.querySelector('button[data-action="' + action + '"]' + (date ? '[data-date="' + date + '"]' : '') + (index && action === 'preset' ? '[data-index="' + index + '"]' : ''));
  (focusTarget || stepPanel.querySelector('[data-day="' + date + '"] input'))?.focus({ preventScroll: true });
});

form.addEventListener('input', ({ target }) => {
  const { name, value, dataset } = target;
  if (name === 'name') state.name = value;
  if (name === 'activitySuggestion') state.activitySuggestion = value;
  if (name === 'foodNote') state.foodNote = value;
  if (target.type === 'radio') {
    state.activities[name] = value;
    const activity = target.closest('.activity');
    if (!activity.querySelector('[data-action="clear-activity"]')) {
      activity.insertAdjacentHTML('beforeend', button('Clear choice', 'clear-activity', 'data-id="' + name + '"'));
    }
  }
  if (target.matches('textarea[data-date]')) state.days[dataset.date].note = value;
  if (target.type === 'time') {
    const windows = dataset.date === 'template' ? template : state.days[dataset.date].windows;
    const window = windows[Number(dataset.index)] ||= ['', ''];
    window[Number(dataset.end)] = value;
    target.closest('.subcard').querySelectorAll('.presets button').forEach((preset, index) => {
      const [, start, end] = presets[index];
      preset.setAttribute('aria-pressed', String(windows.length === 1 && windows[0][0] === start && windows[0][1] === end));
    });
  }
  save();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  showError('');
  if (step === 'name' && !state.name.trim()) {
    showError('Enter your first name to continue.');
    form.elements.name.focus();
    return;
  }
  if (step.startsWith('times-')) {
    const invalid = datesOnPage(Number(step.at(-1))).find((iso) => !validateWindows(state.days[iso].windows));
    if (invalid) {
      showError('Add a time window between 9 a.m. and 9 p.m. for ' + dateLabel.format(dateObject(invalid)) + ', or mark the date unavailable.');
      stepPanel.querySelector('[data-day="' + invalid + '"] input').focus();
      return;
    }
  }
  if (step !== 'review') {
    const pages = steps();
    step = pages[pages.findIndex(([id]) => id === step) + 1][0];
    save(true);
    render(true);
    return;
  }
  if (!submissionUrl) {
    showError('This preview keeps your draft on this device. Online submissions aren’t connected yet.');
    return;
  }
  busy = true;
  const submit = navigation.querySelector('[type="submit"]');
  navigation.querySelectorAll('button').forEach((control) => { control.disabled = true; });
  submit.textContent = 'Saving…';
  try {
    const response = cleanResponse(state);
    save(true);
    const request = await sendToSurvey({ response });
    if (!request.ok) throw Error('Your draft is safe on this device. Try sending again in a moment.');
    Object.assign(state, response);
    sent = true;
    step = 'done';
    void loadCommunity();
    save(true);
    render(true);
  } catch (problem) {
    showError(problem instanceof TypeError || problem.name === 'TimeoutError' ?
      'Couldn’t reach the survey. Your draft is still here. Try again when you’re connected.' : problem.message);
  } finally {
    busy = false;
    navigation.querySelectorAll('button').forEach((control) => { control.disabled = false; });
    submit.textContent = sent ? 'Save changes' : 'Send response';
  }
});

const catalogReady = loadCommunity();
const restore = () => {
  render();
  if (cachedHere && revision) showDraftStatus('Saved on this device.');
};
if (step.startsWith('suggested-') && !community.length) void catalogReady.then(restore);
else restore();
void catalogReady.then(restoreCloudDraft);
window.addEventListener('online', syncDraft);
window.addEventListener('pagehide', syncDraft);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void syncDraft();
});
