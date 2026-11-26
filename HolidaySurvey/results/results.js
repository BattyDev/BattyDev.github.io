import { activities, dates, foodOptions, participation, statuses } from '../survey.js?v=4';
import { publishableKey, submissionUrl } from '../config.js?v=2';
import { activityTotals, bestWindows, formatTime } from './analysis.js?v=1';

const endpoint = new URL('holiday-results', submissionUrl);
const locked = document.querySelector('#locked');
const linkStatus = document.querySelector('#link-status');
const dashboard = document.querySelector('#dashboard');
const summary = document.querySelector('#summary');
const message = document.querySelector('#message');
const view = document.querySelector('#view');
const refresh = document.querySelector('#refresh');
const settings = { view: 'calendar', calendarDate: '', duration: 120, activity: '', individual: 0 };
const dateFormat = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Denver' });
const updatedFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Denver' });
const escape = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const nameList = (names) => names.map(escape).join(', ');
const dateLabel = (date) => dateFormat.format(new Date(date + 'T12:00:00Z'));
const rangeLabel = (start, end) => formatTime(start) + '–' + formatTime(end);
const voteLabel = Object.fromEntries(participation);
const foodLabel = Object.fromEntries(foodOptions);
let responses = [];
let catalog = [];
let linkKey = '';
let requestNumber = 0;

function setMessage(text) {
  message.textContent = text;
  message.hidden = !text;
}

function lock() {
  requestNumber++;
  linkKey = '';
  responses = [];
  catalog = [];
  view.replaceChildren();
  summary.textContent = '';
  summary.hidden = true;
  locked.hidden = false;
  dashboard.hidden = true;
  linkStatus.textContent = 'Open the organizer link to view the results.';
  refresh.disabled = false;
}

async function load(key) {
  const request = ++requestNumber;
  refresh.disabled = true;
  if (!locked.hidden) linkStatus.textContent = 'Loading results…';
  setMessage('');
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: publishableKey },
      body: JSON.stringify({ linkKey: key }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (request !== requestNumber) return;
    if (response.status === 401) {
      lock();
      setMessage('This organizer link is invalid.');
      return;
    }
    if (!response.ok) throw Error('Could not load results.');
    const records = await response.json();
    if (request !== requestNumber) return;
    responses = records.responses;
    catalog = [...activities.map(([id, title]) => [id, title]), ...records.community];
    if (settings.activity && !catalog.some(([id]) => id === settings.activity)) settings.activity = '';
    if (settings.individual >= responses.length) settings.individual = 0;
    linkKey = key;
    locked.hidden = true;
    dashboard.hidden = false;
    summary.textContent = responses.length + ' submitted ' + (responses.length === 1 ? 'response' : 'responses');
    summary.hidden = false;
    render();
  } catch {
    if (request === requestNumber) {
      if (!locked.hidden) linkStatus.textContent = 'Reload the organizer link to try again.';
      setMessage('Could not load the results. Try again in a moment.');
    }
  } finally {
    if (request === requestNumber) refresh.disabled = false;
  }
}

const option = (value, label, current) => '<option value="' + escape(value) + '"' +
  (String(value) === String(current) ? ' selected' : '') + '>' + escape(label) + '</option>';
const badge = (label, state) => '<span class="badge day-' + state + '">' + label + '</span>';
const empty = (text) => '<p class="help empty">' + text + '</p>';

const groupSize = ({ name }) => name.split(/\s+\+\s+/).length;
const headcount = (group) => group.reduce((total, person) => total + groupSize(person), 0);

function calendarView() {
  const days = dates.map((date) => {
    const definite = responses.filter((person) => person.days?.[date]?.status === 2);
    const possible = responses.filter((person) => person.days?.[date]?.status === 1);
    const total = headcount(definite) + headcount(possible);
    return { date, definite, possible, total };
  });
  if (!settings.calendarDate) {
    const best = days.reduce((a, b) => b.total > a.total ||
      (b.total === a.total && headcount(b.definite) > headcount(a.definite)) ? b : a);
    settings.calendarDate = best.date;
  }
  const selected = days.find(({ date }) => date === settings.calendarDate);
  const offset = new Date(dates[0] + 'T12:00:00Z').getUTCDay();
  const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const month = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
  const cells = days.map(({ date, total, definite, possible }) => {
    const stamp = new Date(date + 'T12:00:00Z');
    const label = dateLabel(date) + ', ' + headcount(definite) + ' definite, ' + headcount(possible) + ' could make it';
    return '<button type="button" class="calendar-day quiet" data-calendar-date="' + date +
      '" aria-label="' + escape(label) + '" aria-pressed="' + (date === selected.date) +
      '" aria-controls="calendar-details"><span>' + month.format(stamp) + ' ' + stamp.getUTCDate() +
      '</span><strong>' + total + '</strong></button>';
  }).join('');

  return '<h2>Availability calendar</h2><p class="help">Numbers show how many people are free for part of each day, including tentative answers. Tap a date for names and activities.</p>' +
    '<div class="availability-calendar" aria-label="December 19, 2026 through January 1, 2027">' +
    weekdayLabels.map((label) => '<span class="weekday">' + label + '</span>').join('') +
    '<span aria-hidden="true"></span>'.repeat(offset) + cells + '</div>' + calendarDetails(selected);
}

function calendarDetails({ date, definite, possible, total }) {
  const group = [...definite, ...possible];
  const top = activityTotals(group, catalog).filter(({ play }) => play > 0).slice(0, 3);
  const favorites = top.map(({ title, play }) => '<li>' + escape(title) + ' <span class="help">· ' +
    play + (play === 1 ? ' participation vote' : ' participation votes') + '</span></li>').join('');
  const list = group.map((person) => {
    const day = person.days[date];
    const interests = (vote) => nameList(catalog.filter(([id]) => person.activities?.[id] === vote).map(([, title]) => title));
    const play = interests('play');
    const hang = interests('hang');
    const name = person.name === 'OG' ? 'Jeff' : person.name;
    return '<li><div class="result-title"><strong>' + escape(name) + '</strong>' +
      badge(statuses[day.status], day.status) + '</div>' +
      '<p>' + day.windows.map(([start, end]) => rangeLabel(start, end)).join(', ') + '</p>' +
      (day.note ? '<p class="help free-text">' + escape(day.note) + '</p>' : '') +
      (play ? '<p class="help"><b>Would participate</b> ' + play + '</p>' : '') +
      (hang ? '<p class="help"><b>Would come along</b> ' + hang + '</p>' : '') +
      (!play && !hang ? '<p class="help">No activities selected to join.</p>' : '') + '</li>';
  }).join('');

  return '<section class="result-section calendar-details" id="calendar-details">' +
    '<h3>' + dateLabel(date) + '</h3>' +
    (total ? '<p class="help">' + headcount(definite) + ' definite · ' + headcount(possible) + ' could make it · Mountain Time</p>' +
      (favorites ? '<h4>Top activities for this group</h4><ul class="calendar-favorites">' + favorites + '</ul>' : '') +
      '<ul class="note-list calendar-people">' + list + '</ul>' : empty('Nobody marked this date as available.')) +
    '</section>';
}

function overlapView() {
  const included = settings.activity ?
    responses.filter(({ activities: votes }) => ['play', 'hang'].includes(votes?.[settings.activity])) : responses;
  const windows = bestWindows(included, settings.duration);
  const cards = windows.map(({ date, start, end, definite, possible, total }) =>
    '<article class="subcard result-card"><div class="result-title"><h3>' + dateLabel(date) + '</h3>' +
    '<strong aria-label="' + total + ' of ' + included.length + ' can attend">' + total + ' of ' + included.length + '</strong></div>' +
    '<p class="time-range">' + rangeLabel(start, end) + '</p>' +
    '<div class="attendees">' + (definite.length ? '<p>' + badge('Definitely', 2) + ' ' + nameList(definite) + '</p>' : '') +
    (possible.length ? '<p>' + badge('Could make it', 1) + ' ' + nameList(possible) + '</p>' : '') + '</div></article>').join('');

  return '<h2>Best times to meet</h2><p class="help">The strongest window for each date, ranked by how many can make it, then by how many are definite. All times are Mountain Time.</p>' +
    '<div class="result-filters"><label class="field">Time together<select data-setting="duration">' +
    [[30, '30 minutes'], [60, '1 hour'], [90, '1½ hours'], [120, '2 hours'], [180, '3 hours'], [240, '4 hours']].map(([n, label]) => option(n, label, settings.duration)).join('') +
    '</select></label><label class="field">Who to include<select data-setting="activity">' + option('', 'Everyone', settings.activity) +
    catalog.map(([id, title]) => option(id, title, settings.activity)).join('') + '</select></label></div>' +
    (settings.activity ? '<p class="help">Includes ' + included.length + ' people who chose Participate or Come &amp; hang out.</p>' : '') +
    (cards || empty('No availability matches that duration and group.'));
}

function voteNames(id, vote) {
  return responses.filter(({ activities: answers }) => answers?.[id] === vote).map(({ name }) => name);
}

function interestsView() {
  const tallies = activityTotals(responses, catalog).map(({ id, title, play, hang, pass, unanswered }) =>
    '<details class="subcard interest"><summary><span>' + escape(title) + '</span>' +
    '<span class="tally"><b>' + play + ' participate</b><span>' + hang + ' hang out</span><span>' + pass + ' pass</span></span></summary>' +
    '<div class="vote-names">' + participation.map(([vote, label]) => {
      const names = voteNames(id, vote);
      return names.length ? '<p><strong>' + label + '</strong> ' + nameList(names) + '</p>' : '';
    }).join('') + (unanswered ? '<p class="help">' + unanswered + ' skipped or unanswered</p>' : '') + '</div></details>').join('');
  const foodNotes = responses.filter(({ foodNote, food }) => foodNote || food?.some((id) => foodLabel[id])).map(({ name, foodNote, food }) =>
    '<li><strong>' + escape(name) + '</strong>' +
    (foodNote ? '<p class="free-text">' + escape(foodNote) + '</p>' : '') +
    (food?.length ? '<p class="help">' + escape(food.map((id) => foodLabel[id]).filter(Boolean).join(', ')) + '</p>' : '') + '</li>').join('');

  return '<h2>Activity votes</h2><p class="help">Ranked by interest in participating. Open an activity to see who voted.</p>' +
    (responses.length ? tallies : empty('Votes will appear when someone submits.')) +
    '<section class="result-section"><h2>Food ideas and requests</h2>' +
    (foodNotes ? '<ul class="note-list">' + foodNotes + '</ul>' : empty('No food ideas yet.')) + '</section>';
}

function individualView() {
  const person = responses[settings.individual] || responses[0];
  if (!person) return '<h2>Individual responses</h2>' + empty('No one has submitted yet.');
  const availability = dates.filter((date) => person.days?.[date]?.status).map((date) => {
    const day = person.days[date];
    return '<li><div class="result-title"><strong>' + dateLabel(date) + '</strong>' + badge(statuses[day.status], day.status) +
      '</div><p>' + day.windows.map(([start, end]) => rangeLabel(start, end)).join(', ') + '</p>' +
      (day.note ? '<p class="help free-text">' + escape(day.note) + '</p>' : '') + '</li>';
  }).join('');
  const votes = catalog.filter(([id]) => voteLabel[person.activities?.[id]]).map(([id, title]) =>
    '<li><strong>' + escape(title) + '</strong><span class="help">' + voteLabel[person.activities[id]] + '</span></li>').join('');
  const food = person.food?.map((id) => foodLabel[id]).filter(Boolean).join(', ');
  const nameCounts = responses.reduce((counts, respondent) =>
    counts.set(respondent.name, (counts.get(respondent.name) || 0) + 1), new Map());

  return '<h2>Individual responses</h2><label class="field">Respondent<select data-setting="individual">' +
    responses.map(({ name, updatedAt }, i) => option(i, nameCounts.get(name) > 1 && updatedAt ?
      name + ' · ' + updatedFormat.format(new Date(updatedAt)) : name, settings.individual)).join('') +
    '</select></label>' +
    (person.updatedAt ? '<p class="help">Last updated ' + updatedFormat.format(new Date(person.updatedAt)) + ' MT</p>' : '') +
    '<section class="result-section"><h3>Availability</h3>' + (availability ? '<ul class="note-list">' + availability + '</ul>' : empty('No days selected.')) + '</section>' +
    '<section class="result-section"><h3>Activity choices</h3>' + (votes ? '<ul class="note-list individual-votes">' + votes + '</ul>' : empty('No activity choices.')) +
    (person.activitySuggestion ? '<p class="help free-text">Suggested ' + escape(person.activitySuggestion) + '</p>' : '') + '</section>' +
    '<section class="result-section"><h3>Food ideas and requests</h3>' +
    (food ? '<p>' + escape(food) + '</p>' : '') +
    (person.foodNote ? '<p class="free-text">' + escape(person.foodNote) + '</p>' : (!food ? empty('No food ideas.') : '')) + '</section>';
}

function render() {
  dashboard.querySelectorAll('[data-view]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.view === settings.view)));
  view.innerHTML = ({ calendar: calendarView, overlap: overlapView, interests: interestsView, individuals: individualView })[settings.view]();
}

dashboard.addEventListener('click', (event) => {
  const target = event.target.closest('button[data-view]');
  if (!target) return;
  settings.view = target.dataset.view;
  render();
});

view.addEventListener('change', ({ target }) => {
  const setting = target.dataset.setting;
  if (!setting) return;
  settings[setting] = setting === 'activity' ? target.value : Number(target.value);
  render();
  view.querySelector('[data-setting="' + setting + '"]').focus();
});

view.addEventListener('click', ({ target }) => {
  const button = target.closest('button[data-calendar-date]');
  if (!button) return;
  settings.calendarDate = button.dataset.calendarDate;
  render();
  view.querySelector('[aria-pressed="true"][data-calendar-date]').focus({ preventScroll: true });
});

refresh.addEventListener('click', () => void load(linkKey));
document.querySelector('#lock').addEventListener('click', () => {
  history.replaceState(null, '', location.pathname + location.search);
  lock();
  setMessage('');
});

function openLink() {
  lock();
  setMessage('');
  const key = location.hash.slice(1);
  if (key) void load(key);
}

window.addEventListener('hashchange', openLink);
openLink();
