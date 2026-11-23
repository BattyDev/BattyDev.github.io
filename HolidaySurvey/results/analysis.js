import { dates } from '../survey.js?v=4';

export function minutes(time) {
  const [hours, mins] = time.split(':').map(Number);
  return hours * 60 + mins;
}

export function formatTime(time) {
  const amount = typeof time === 'number' ? time : minutes(time);
  const hour = Math.floor(amount / 60);
  const minute = amount % 60;
  return (hour % 12 || 12) + (minute ? ':' + String(minute).padStart(2, '0') : '') + (hour < 12 ? ' a.m.' : ' p.m.');
}

export function sortWindows(a, b) {
  return b.total - a.total || b.definite.length - a.definite.length || a.date.localeCompare(b.date) || a.start - b.start;
}

export function bestWindows(responses, duration) {
  const result = [];
  for (const date of dates) {
    const free = responses.flatMap((response) => {
      const day = response.days?.[date];
      return day?.status && day.windows?.length
        ? [{ name: response.name, status: day.status, windows: day.windows.map((window) => window.map(minutes)) }]
        : [];
    });
    // An overlap can begin at any respondent's exact start time, including off the half hour.
    const starts = new Set(free.flatMap(({ windows }) => windows.map(([start]) => start)));
    const options = [];
    for (const start of starts) {
      const end = start + duration;
      if (start < 540 || end > 1260) continue;
      const covered = free.filter(({ windows }) => windows.some(([from, to]) => from <= start && end <= to));
      const definite = covered.filter(({ status }) => status === 2).map(({ name }) => name);
      const possible = covered.filter(({ status }) => status === 1).map(({ name }) => name);
      if (covered.length) options.push({ date, start, end, definite, possible, total: covered.length });
    }
    const best = options.sort(sortWindows)[0];
    if (best) result.push(best);
  }
  return result.sort(sortWindows);
}

export function activityTotals(responses, catalog) {
  return catalog.map(([id, title]) => {
    const counts = { play: 0, hang: 0, pass: 0 };
    for (const person of responses) {
      const vote = person.activities?.[id];
      if (Object.hasOwn(counts, vote)) counts[vote]++;
    }
    return { id, title, ...counts, unanswered: responses.length - counts.play - counts.hang - counts.pass };
  }).sort((a, b) => b.play - a.play || b.hang - a.hang || a.title.localeCompare(b.title));
}
