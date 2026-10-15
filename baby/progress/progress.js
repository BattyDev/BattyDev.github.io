/* BattyDev · Baby · Progress
   The reference content in ../shared/weeks.js is date-free; this page maps it
   onto the calendar using the due date from the decrypted data file. */

'use strict';

const { $, esc, plural, fmtDate, fmtLong, weeksDays } = BB;

const WEEK_MIN = Math.min(...Object.keys(BABY_WEEKS).map(Number));
const WEEK_MAX = Math.max(...Object.keys(BABY_WEEKS).map(Number));
const clampWeek = (w) => Math.max(WEEK_MIN, Math.min(WEEK_MAX, w));

let P = null;
let done = new Set();
let moments = [];
let appointments = [];

const range = (a, b) => `${fmtDate(a)} – ${fmtDate(b)}`;

/* ---------- shared pieces ---------- */

function taskHTML(t) {
  const isDone = done.has(t.id);
  const late = !isDone && P.week > t.week;
  return `
    <li class="task ${isDone ? 'is-done' : late ? 'is-late' : ''}">
      <i class="bi ${isDone ? 'bi-check-circle-fill' : 'bi-circle'}" aria-hidden="true"></i>
      <span><b>${esc(t.title)}</b>${t.detail ? `<span class="note">${esc(t.detail)}</span>` : ''}</span>
      <span class="task-when">${isDone ? 'done' : late ? `was wk ${t.week}` : `wk ${t.week}`}</span>
    </li>`;
}

function weekDetailHTML(w) {
  const info = BABY_WEEKS[w];
  const ms = BABY_MILESTONES.filter((m) => m.from === w);
  const mine = moments.filter((m) => P.weekOf(m.d) === w);
  return `
    <div class="size">
      <span class="size-word">${esc(info.size)}</span>
      <span class="size-meta">about ${esc(info.len)}${info.wt !== '—' ? ` · ${esc(info.wt)}` : ''}</span>
    </div>
    <div class="week-cols">
      <section><h3><i class="bi bi-stars"></i> Baby</h3><p>${esc(info.baby)}</p></section>
      <section><h3><i class="bi bi-heart"></i> Mom</h3><p>${esc(info.mom)}</p></section>
      <section><h3><i class="bi bi-person-check"></i> You</h3><p>${esc(info.dad)}</p></section>
    </div>
    ${ms.length ? `<p class="week-ms">${ms.map((m) => `<span class="tag">${esc(m.label)}</span>`).join(' ')}</p>` : ''}
    ${mine.length ? `<ul class="moments">${mine.map((m) => `
      <li><i class="bi bi-bookmark-heart" aria-hidden="true"></i>
        <span><b>${esc(fmtDate(m.d))}</b> ${esc(m.text)}</span></li>`).join('')}</ul>` : ''}`;
}

/* ---------- now ---------- */

function renderNow(nickname) {
  const w = clampWeek(P.week);
  const info = BABY_WEEKS[w];

  if (P.left < 0) {
    $('now-eyebrow').textContent = 'Past the due date';
    $('now-heading').textContent = `${plural(-P.left, 'day')} past due`;
    $('now-lede').textContent = `Due ${fmtLong(P.due)}. Any day now.`;
  } else {
    $('now-eyebrow').textContent = BB.TRI_NAME[P.tri];
    $('now-heading').textContent = `${plural(P.week, 'week')}, ${plural(P.day, 'day')}`;
    $('now-lede').textContent = `${nickname} is about the size of a ${info.size}. Due ${fmtLong(P.due)}.`;
  }

  const month = BABY_MONTHS.find((m) => P.week >= m.from && P.week <= m.to);
  $('now-stats').innerHTML = [
    { k: 'Days to go', v: Math.max(0, P.left) },
    { k: 'Time to go', v: P.left > 0 ? weeksDays(P.left) : '—' },
    { k: 'Month', v: month ? `${month.n}<small> of 9</small>` : '9<small>+</small>' },
    { k: 'Done', v: `${Math.round(P.pct * 100)}<small>%</small>` },
  ].map((s) => `<div class="stat"><span class="k">${esc(s.k)}</span><span class="v">${s.v}</span></div>`).join('');

  /* Trimester boundaries at 14 and 28 weeks; month ticks at each month's start. */
  const pos = (P.pct * 100).toFixed(2);
  const ticks = BABY_MONTHS.slice(1).map((m) =>
    `<span class="tl-tick" style="left:${((m.from / 40) * 100).toFixed(2)}%"></span>`).join('');
  $('timeline').innerHTML = `
    <div class="tl-track">
      <span class="tl-seg" style="width:35%"></span><span class="tl-seg" style="width:35%"></span><span class="tl-seg" style="width:30%"></span>
      <span class="tl-fill" style="width:${pos}%"></span>
      ${ticks}
      <span class="tl-now" style="left:${pos}%"></span>
    </div>
    <div class="tl-labels">
      <span style="width:35%">1st trimester</span><span style="width:35%">2nd</span><span style="width:30%">3rd</span>
    </div>`;

  const start = P.weekStart(w);
  $('now-week-title').textContent = `Week ${w} · ${range(start, BB.addDays(start, 6))}`;
  $('now-week').innerHTML = weekDetailHTML(w);

  /* Late items first, then whatever is due in the next three weeks. */
  const open = BABY_TASKS.filter((t) => !done.has(t.id));
  const late = open.filter((t) => t.week < P.week);
  const soon = open.filter((t) => t.week >= P.week && t.week <= P.week + 3);
  const list = [...late, ...soon];
  const after = open.find((t) => t.week > P.week + 3);
  $('now-tasks').innerHTML = list.length
    ? `<ul class="tasks">${list.map(taskHTML).join('')}</ul>`
    : `<p class="empty">Nothing due right now.${after ? ` Next: ${esc(after.title.toLowerCase())} around week ${after.week}.` : ''}</p>`;

  const nextAppt = appointments.find((a) => a.d >= P.now);
  const nextMs = BABY_MILESTONES.find((m) => m.from > P.week);
  const lastMoment = moments[moments.length - 1];
  const items = [];
  if (nextAppt) {
    const away = BB.daysBetween(P.now, nextAppt.d);
    items.push(`<li><i class="bi bi-calendar-check" aria-hidden="true"></i><span><b>${esc(nextAppt.label)}</b>
      <span class="note">${esc(fmtDate(nextAppt.d, { weekday: 'short', month: 'short', day: 'numeric' }))} · ${
      away === 0 ? 'today' : `in ${plural(away, 'day')}`}</span></span></li>`);
  }
  if (nextMs) {
    items.push(`<li><i class="bi bi-flag" aria-hidden="true"></i><span><b>${esc(nextMs.label)}</b>
      <span class="note">week ${nextMs.from} · from ${esc(fmtDate(P.weekStart(nextMs.from)))}</span></span></li>`);
  }
  if (lastMoment) {
    items.push(`<li><i class="bi bi-bookmark-heart" aria-hidden="true"></i><span><b>Latest moment</b>
      <span class="note">${esc(fmtDate(lastMoment.d))}: ${esc(lastMoment.text)}</span></span></li>`);
  }
  $('now-next').innerHTML = items.length ? `<ul class="next">${items.join('')}</ul>` : '<p class="empty">Nothing scheduled.</p>';
}

/* ---------- weeks ---------- */

function renderWeeks() {
  const cur = clampWeek(P.week);
  const rows = [];
  for (let w = WEEK_MIN; w <= WEEK_MAX; w += 1) {
    const info = BABY_WEEKS[w];
    const start = P.weekStart(w);
    const state = w < cur ? 'is-past' : w === cur ? 'is-now' : '';
    const flag = BABY_MILESTONES.some((m) => m.from === w);
    const hasMoment = moments.some((m) => P.weekOf(m.d) === w);
    rows.push(`
      <div class="day wk ${state}${w === cur ? ' is-open' : ''}" id="week-${w}">
        <button type="button" class="day-head" aria-expanded="${w === cur}">
          <i class="bi bi-chevron-right chev" aria-hidden="true"></i>
          <span class="date">Week ${w}</span>
          <span class="macros">${esc(range(start, BB.addDays(start, 6)))} · ${esc(info.size)}</span>
          <span class="count">${w === cur ? '<span class="tag">now</span>' : ''}${
            flag ? '<i class="bi bi-flag" title="Milestone"></i>' : ''}${
            hasMoment ? '<i class="bi bi-bookmark-heart" title="Moment"></i>' : ''}</span>
        </button>
        <div class="day-body"${w === cur ? '' : ' hidden'}>${weekDetailHTML(w)}</div>
      </div>`);
  }
  $('weeks').innerHTML = rows.join('');
  $('weeks').querySelectorAll('.day-head').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.day');
      const open = row.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', String(open));
      row.querySelector('.day-body').hidden = !open;
    });
  });
}

/* ---------- months ---------- */

function renderMonths() {
  const doneCount = BABY_TASKS.filter((t) => done.has(t.id)).length;
  $('months-lede').textContent =
    `The big picture for each stretch, and your prep list: ${doneCount} of ${BABY_TASKS.length} done.`;
  $('months').innerHTML = BABY_MONTHS.map((m) => {
    const start = P.weekStart(m.from);
    const end = BB.addDays(P.weekStart(m.to + 1), -1);
    const state = P.week > m.to ? 'is-past' : P.week >= m.from ? 'is-now' : '';
    const tasks = BABY_TASKS.filter((t) => t.week >= m.from && t.week <= m.to);
    return `
      <article class="panel month ${state}" id="month-${m.n}">
        <h2>Month ${m.n}${state === 'is-now' ? ' <span class="tag">now</span>' : ''}
          <span class="month-when">${esc(range(start, end))} · weeks ${Math.max(1, m.from)}–${m.to}</span></h2>
        <div class="week-cols">
          <section><h3><i class="bi bi-stars"></i> Baby</h3><p>${esc(m.baby)}</p></section>
          <section><h3><i class="bi bi-heart"></i> Mom</h3><p>${esc(m.mom)}</p></section>
          <section><h3><i class="bi bi-person-check"></i> You</h3><p>${esc(m.dad)}</p></section>
        </div>
        ${tasks.length ? `<h3 class="sub">Prep list</h3><ul class="tasks">${tasks.map(taskHTML).join('')}</ul>` : ''}
      </article>`;
  }).join('');
}

/* ---------- visits ---------- */

function renderVisits() {
  if (!appointments.length) {
    $('appointments').innerHTML = '<p class="empty">No appointments recorded.</p>';
  } else {
    const nextIdx = appointments.findIndex((a) => a.d >= P.now);
    $('appointments').innerHTML = `<ul class="appts">${appointments.map((a, i) => {
      const away = BB.daysBetween(P.now, a.d);
      const cls = nextIdx === -1 || i < nextIdx ? 'is-past' : i === nextIdx ? 'is-next' : '';
      const tag = i === nextIdx ? `<span class="tag">${away === 0 ? 'today' : `in ${plural(away, 'day')}`}</span>` : '';
      return `
        <li class="${cls}">
          <span class="ap-date">${esc(fmtDate(a.d, { weekday: 'short', month: 'short', day: 'numeric' }))}</span>
          <span class="ap-text"><b>${esc(a.label)}</b> ${tag}${a.note ? `<span class="note">${esc(a.note)}</span>` : ''}</span>
          <span class="ap-wk">${esc(weeksDays(BB.daysBetween(P.lmp, a.d)))}</span>
        </li>`;
    }).join('')}</ul>`;
  }

  const at = P.elapsed / 7;
  let nextMarked = false;
  $('milestones').innerHTML = BABY_MILESTONES.map((m) => {
    const start = P.weekStart(m.from);
    const end = BB.addDays(P.weekStart(m.to), -1);
    let state = 'is-later';
    if (at >= m.to) state = 'is-done';
    else if (at >= m.from) state = 'is-now';
    else if (!nextMarked) { state = 'is-next'; nextMarked = true; }
    const when = m.to - m.from === 1
      ? `wk ${m.from} · ${fmtDate(start)}`
      : `wk ${m.from}–${m.to - 1} · ${range(start, end)}`;
    return `
      <li class="${state}">
        <span class="ms-dot" aria-hidden="true"></span>
        <span class="ms-text"><b>${esc(m.label)}</b>${m.note ? `<span class="note">${esc(m.note)}</span>` : ''}</span>
        <span class="ms-when">${esc(when)}</span>
      </li>`;
  }).join('');
}

/* ---------- boot ---------- */

BB.unlock((data) => {
  BB.chrome(data);
  const p = data.pregnancy || {};
  P = BB.pregnancy(p.due);
  if (!P) {
    $('now-heading').textContent = 'No due date set';
    $('now-lede').textContent = 'Add pregnancy.due to the data file.';
    BB.views();
    return;
  }
  done = new Set(p.done || []);
  const dated = (list) => (list || [])
    .map((x) => ({ ...x, d: BB.parseDate(x.date) }))
    .filter((x) => x.d)
    .sort((a, b) => a.d - b.d);
  moments = dated(p.moments);
  appointments = dated(p.appointments);

  renderNow(p.nickname || 'Baby');
  renderWeeks();
  renderMonths();
  renderVisits();

  /* Opening the week list lands on this week, not week 4. */
  document.addEventListener('bb:view', (ev) => {
    if (ev.detail !== 'weeks') return;
    const row = document.getElementById(`week-${clampWeek(P.week)}`);
    if (row) requestAnimationFrame(() => row.scrollIntoView({ block: 'center' }));
  });
  BB.views();
});
