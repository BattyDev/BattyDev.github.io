export const dates = Array.from({ length: 14 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 11, 19 + index));
  return date.toISOString().slice(0, 10);
});

export const activities = [
  ['movie-theater', 'Movie theater', '🍿'],
  ['board-games', 'Board games', '🎲'],
  ['escape-room', 'Escape room', '🔐'],
  ['ice-skating', 'Ice skating', '⛸️'],
  ['bowling', 'Bowling', '🎳'],
  ['indoor-pickleball', 'Indoor pickleball', '🏓'],
  ['snow-tubing-soldier-hollow', 'Tubing at Soldier Hollow', '🛟', 'Midway, UT'],
  ['cookie-decorating-hot-cocoa', 'Cookie decorating and hot cocoa', '🍪'],
  ['jackbox-family-trivia', 'Jackbox or family trivia', '🎮'],
  ['holiday-lights-walk-drive', 'Holiday lights walk or drive', '🎄'],
  ['indoor-mini-golf', 'Indoor mini golf', '⛳'],
];

export const foodOptions = [
  ['home', 'Meal at home'], ['takeout', 'Takeout or delivery'], ['restaurant', 'Eat out'],
  ['snacks', 'Snacks and dessert'], ['flexible', 'I’m flexible'],
];

export const participation = [['play', 'Participate'], ['hang', 'Come & hang out'], ['pass', 'Pass']];
export const statuses = ['Unavailable', 'Could make it', 'Definitely available'];
export const presets = [
  ['Morning', '09:00', '12:00'], ['Afternoon', '12:00', '17:00'],
  ['Evening', '17:00', '21:00'], ['All day', '09:00', '21:00'],
];

export const emptyResponse = () => ({ name: '', days: {}, activities: {}, food: [], foodNote: '' });

const validTime = (time) => typeof time === 'string' && /^(?:0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/.test(time);
const choices = new Set(participation.map(([id]) => id));

export function cleanDraft(draft) {
  if (!draft?.response || !Number.isSafeInteger(draft.revision) || draft.revision < 0) throw Error('Invalid draft.');
  const value = draft.response;
  const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';
  const windows = (value) => Array.isArray(value) ? value.slice(0, 6).map((window) =>
    [0, 1].map((index) => validTime(window?.[index]) ? window[index] : '')) : [];
  const response = emptyResponse();
  response.name = text(value.name, 80);
  response.foodNote = text(value.foodNote, 1000);
  response.food = foodOptions.filter(([id]) => Array.isArray(value.food) && value.food.includes(id)).map(([id]) => id);
  for (const iso of dates) {
    const day = value.days?.[iso];
    if (!day || ![0, 1, 2].includes(day.status)) continue;
    response.days[iso] = { status: day.status, windows: windows(day.windows), note: text(day.note, 500) };
  }
  for (const [id] of activities) {
    const answer = value.activities?.[id];
    if (choices.has(answer)) response.activities[id] = answer;
  }
  const page = text(draft.step, 20);
  const step = /^(name|days|times-[0-3]|activity-[0-2]|food|review|done)$/.test(page) ? page : 'name';
  return { response, step, sent: draft.sent === true, template: windows(draft.template).slice(0, 1), revision: draft.revision };
}

export function validateWindows(windows) {
  return Array.isArray(windows) && windows.length > 0 && windows.length <= 6 && windows.every((window) => {
    if (!Array.isArray(window) || window.length !== 2) return false;
    const [start, end] = window;
    return validTime(start) && validTime(end) && '09:00' <= start && start < end && end <= '21:00';
  });
}

export function cleanResponse(value) {
  if (typeof value !== 'object' || value === null || typeof value.name !== 'string') throw Error('Enter your name.');
  const name = value.name.trim();
  if (!name || name.length > 80) throw Error('Enter a name up to 80 characters.');
  const result = { ...emptyResponse(), name };
  for (const iso of dates) {
    const day = value.days?.[iso];
    if (!day || day.status === 0) continue;
    if (day.status !== 1 && day.status !== 2) throw Error('Choose a day status.');
    if (!validateWindows(day.windows)) throw Error(`Add valid times between 9 a.m. and 9 p.m. for ${iso}.`);
    if (typeof day.note !== 'string' || day.note.length > 500) throw Error('Keep each day note under 500 characters.');
    const windows = [];
    for (const [start, end] of [...day.windows].sort((a, b) => a[0].localeCompare(b[0]))) {
      const previous = windows.at(-1);
      if (previous && start <= previous[1]) previous[1] = end > previous[1] ? end : previous[1];
      else windows.push([start, end]);
    }
    result.days[iso] = { status: day.status, windows, note: day.note.trim() };
  }
  for (const [id] of activities) {
    const answer = value.activities?.[id];
    if (choices.has(answer)) result.activities[id] = answer;
  }
  result.food = foodOptions.filter(([id]) => Array.isArray(value.food) && value.food.includes(id)).map(([id]) => id);
  if (typeof value.foodNote !== 'string' || value.foodNote.length > 1000) throw Error('Keep food ideas under 1,000 characters.');
  result.foodNote = value.foodNote.trim();
  return result;
}
