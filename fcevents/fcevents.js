/* Wild Hearts · FC Events
   Members log the hours they are free; the company finds the overlap and puts
   events on -- raids, dungeons, maps, whatever is being run.

   On security: this is a static page, so the publishable key in config.js is
   public by necessity -- anyone can read it out of the page source and issue
   their own queries with it. Every visibility rule below is therefore a
   restatement of something the database already enforces, never the thing doing
   the enforcing:

     * hiding the "Company" tab from non-leaders is a courtesy. A non-leader who
       unhides it gets an empty grid, because the SELECT behind it returns them
       only their own row.
     * the public heatmap is not "the same rows with the names stripped in JS".
       It is a separate RPC, raid_heatmap(), that returns {slot, count}
       and never carries an identity across the wire in the first place.

   If you are changing this file, the rule is: you cannot make it leak by
   editing it. If a change here appears to expose more than it should, the bug
   is in raid/sql/001_schema.sql, and that is where to fix it. */

'use strict';

const CFG = window.FC_CONFIG || {};
const CONFIGURED = Boolean(CFG.url && CFG.key);
const db = CONFIGURED ? supabase.createClient(CFG.url, CFG.key) : null;

const $ = (id) => document.getElementById(id);

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/* ---------- time ----------------------------------------------------------
   Slots are stored as an hour of the UTC week (utcDay * 24 + utcHour, day 0 =
   Sunday, matching getUTCDay). Storing UTC is what makes the aggregate mean
   anything -- two members in different timezones who are free at the same real
   moment have to land on the same slot, which they would not if each stored
   their own local hour.

   The grid, though, is drawn in the viewer's local time, so every cell needs a
   local <-> UTC mapping. It is computed against the CURRENT week rather than by
   adding a fixed offset, so the offset used is the one actually in force --
   correct on either side of a daylight-saving change.

   Two known edges, both benign here: on the spring-forward day the missing
   local hour folds onto its neighbour, and a member in a :30 or :45 offset zone
   would be recorded to the nearest hour. The Wild Hearts are on Malboro, so
   everyone is on a whole-hour North American offset. */

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const BROWSER_TZ = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch { return 'UTC'; }
})();

/* The zone every time on this page is drawn in. Held in a module variable
   rather than read from the browser at each call, so a member's saved choice
   wins over whatever machine they happen to be sitting at -- and so that
   changing it is one assignment plus a redraw. */
let currentTz = BROWSER_TZ;
const TZ = () => currentTz;

const PART_FMT = new Map();
function partFmt(tz) {
  if (!PART_FMT.has(tz)) {
    PART_FMT.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return PART_FMT.get(tz);
}

/* The wall-clock fields an instant reads as, in a given zone. Intl is the only
   thing in the platform that knows the IANA rules, so all zone maths below goes
   through it rather than through Date's own local-time methods -- those only
   ever speak the browser's zone, which is precisely what we are replacing. */
function zoned(instant, tz = TZ()) {
  const p = {};
  for (const part of partFmt(tz).formatToParts(instant)) p[part.type] = part.value;
  return {
    y: +p.year, mo: +p.month, d: +p.day,
    h: +p.hour % 24, mi: +p.minute, s: +p.second,
    dow: DAY_NAMES.indexOf(p.weekday),
  };
}

function offsetMs(instant, tz) {
  const z = zoned(instant, tz);
  return Date.UTC(z.y, z.mo - 1, z.d, z.h, z.mi, z.s)
    - Math.floor(instant.getTime() / 1000) * 1000;
}

/* The instant at which a wall-clock time occurs in TZ(). Two passes: reading
   the fields as if they were UTC gives an instant that is wrong by the offset,
   and the offset in force AT that wrong instant can itself be wrong by an hour
   across a daylight-saving boundary -- so the offset is re-read at the
   corrected instant and applied. On the hour that does not exist in spring this
   lands on the following hour, which is the same thing every calendar app does.
*/
function instantAt(y, mo, d, h, mi = 0) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const o1 = offsetMs(new Date(guess), TZ());
  const o2 = offsetMs(new Date(guess - o1), TZ());
  return guess - o2;
}

/* Calendar arithmetic is done at UTC noon so that adding days can never slip
   across a DST boundary and land on the wrong date. */
const ymdToNoon = (ymd) => Date.UTC(ymd.y, ymd.mo - 1, ymd.d, 12);
function addDays(ymd, n) {
  const t = new Date(ymdToNoon(ymd) + n * 86400000);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
const ymdDow = (ymd) => new Date(ymdToNoon(ymd)).getUTCDay();
const todayYmd = () => { const z = zoned(new Date()); return { y: z.y, mo: z.mo, d: z.d }; };
const ymdISO = (ymd) => `${ymd.y}-${String(ymd.mo).padStart(2, '0')}-${String(ymd.d).padStart(2, '0')}`;

/* The Sunday that starts the current week, in TZ(). */
const weekStartYmd = () => addDays(todayYmd(), -zoned(new Date()).dow);

function cellInstant(day, hour) {
  const w = addDays(weekStartYmd(), day);
  return instantAt(w.y, w.mo, w.d, hour);
}

/* ---------- the weekly slot map ----------
   Slots are stored as an hour of the UTC week (utcDay * 24 + utcHour, day 0 =
   Sunday). Storing UTC is what makes the aggregate mean anything: two members
   in different zones who are free at the same real moment have to land on the
   same slot, which they would not if each stored their own wall clock.

   The grid is drawn in TZ(), so this maps each cell to its UTC slot. It is
   rebuilt whenever the chosen zone changes -- and the mapping is computed
   against the CURRENT week, so the offset used is the one actually in force,
   correct on either side of a daylight-saving change. */
const LOCAL_TO_SLOT = new Array(168);
function rebuildSlots() {
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const t = new Date(cellInstant(day, hour));
      LOCAL_TO_SLOT[day * 24 + hour] = t.getUTCDay() * 24 + t.getUTCHours();
    }
  }
}
rebuildSlots();

const HOUR_FMT = new Map();
function hourLabel(h) {
  const tz = TZ();
  if (!HOUR_FMT.has(tz)) {
    HOUR_FMT.set(tz, new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: 'numeric' }));
  }
  return HOUR_FMT.get(tz).format(cellInstant(0, h));
}
const cellLabel = (day, hour) => `${DAY_NAMES[day]} ${hourLabel(hour)}`;

/* Zone name plus the abbreviation people actually say out loud, so a time is
   never ambiguous: "America/New_York (EDT)". */
function tzLabel() {
  try {
    const abbr = new Intl.DateTimeFormat('en-US', { timeZone: TZ(), timeZoneName: 'short' })
      .formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value;
    /* "UTC (UTC)" tells nobody anything. */
    return abbr && abbr !== TZ() ? `${TZ()} (${abbr})` : TZ();
  } catch { return TZ(); }
}

/* Every absolute time on the page goes through this, and it always carries the
   zone -- the whole complaint that started this was not knowing which one. */
function fmtWhen(v) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: TZ(), weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(v));
}

/* ---------- state ---------- */
const state = {
  session: null,
  member: null,          // this viewer's raid_members row, or null
  saved: new Set(),      // slots as last confirmed by the server
  mine: new Set(),       // slots as currently shown in the grid
  heat: new Map(),       // slot -> count, from the public RPC
  stats: null,           // { members, respondents }
  bySlot: new Map(),     // slot -> [member] -- leaders only
  members: [],           // all members -- leaders only
  picked: null,          // selected cell in the company grid
};

const isLeader = () => state.member?.role === 'leader';

/* ---------- chrome ---------- */
function banner(msg, warn = false) {
  const el = $('banner');
  if (!msg) { el.hidden = true; return; }
  el.innerHTML = msg;
  el.classList.toggle('is-warn', warn);
  el.hidden = false;
}

function stamp(text) { $('stamp').textContent = text; }

/* ---------- routing ----------
   The view lives in the URL hash, so a reload keeps you where you were and an
   event can be linked to directly. Hash rather than a path because this is
   GitHub Pages: there is no server to route /fcevents/event/<id> back to the page.

   replaceState rather than pushState for plain view switches -- back should
   leave the page, not walk the tab history. Opening an event does push, so
   Back returns to the list, which is what the arrow means there. */
const VIEWS = ['welcome', 'overlap', 'events', 'mine', 'chars', 'custom', 'company'];

function readRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  if (h.startsWith('event/')) {
    const id = h.slice('event/'.length);
    return /^[0-9a-f-]{36}$/i.test(id) ? { view: 'events', event: id } : null;
  }
  return VIEWS.includes(h) ? { view: h } : null;
}

function writeRoute(view, eventId, push = false) {
  const next = eventId ? `#/event/${eventId}` : `#${view}`;
  if (location.hash === next) return;
  routing = true;
  if (push) history.pushState(null, '', next);
  else history.replaceState(null, '', next);
  routing = false;
}

let routing = false;

function showView(name) {
  for (const s of document.querySelectorAll('.view')) {
    const on = s.id === `view-${name}`;
    s.classList.toggle('is-active', on);
    s.hidden = !on;
  }
  for (const b of document.querySelectorAll('.system-icons button')) {
    const on = b.dataset.viewTarget === name;
    b.classList.toggle('is-active', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  if (!(name === 'events' && state.openEvent)) writeRoute(name);
}

for (const b of document.querySelectorAll('.system-icons button')) {
  b.addEventListener('click', () => {
    showView(b.dataset.viewTarget);
    /* Returning to the tab should show the list, not whichever event happened
       to be open when it was last left. */
    if (b.dataset.viewTarget === 'events' && state.openEvent) closeEvent();
  });
}

/* Reflects auth state into the chrome. The tabs it reveals are conveniences --
   see the header note; none of them is what keeps a member out of the leader
   data. */
function syncChrome() {
  const signedIn = Boolean(state.session);
  /* querySelectorAll, not querySelector: "member" gates both Events and My
     times, and the singular form would have left the second one hidden. */
  for (const b of document.querySelectorAll('[data-needs="member"]')) b.hidden = !signedIn;
  for (const b of document.querySelectorAll('[data-needs="leader"]')) b.hidden = !isLeader();

  const btn = $('auth-btn');
  btn.hidden = !CONFIGURED;
  btn.textContent = signedIn ? 'Sign out' : 'Sign in with Discord';

  /* Home is for signed-out visitors only; once you are in, Events is home. */
  for (const b of document.querySelectorAll('[data-anon]')) b.hidden = signedIn;

  if (!signedIn) {
    const open = [...document.querySelectorAll('.view')].find((v) => v.classList.contains('is-active'));
    if (!open || !['view-welcome', 'view-overlap'].includes(open.id)) showView('welcome');
  }
}

/* Where a member lands. Events, not the heatmap: the heatmap answers "when is
   the company around", which is background, while Events is the thing there is
   something to DO about -- sign up, or put one on. The signed-out public still
   lands on the heatmap, because events are not theirs to see. */
let landed = false;
async function landOnDefaultView() {
  if (landed || !state.session) return;
  landed = true;
  const route = readRoute();
  /* 'welcome' is the signed-out landing, so it is not a place to leave a member
     standing -- signing in from it must still take them to Events. Treat it as
     no route at all. */
  if (route && route.view !== 'welcome') {
    showView(route.view);
    if (route.event) {
      try { await openEvent(route.event); }
      catch { banner('That event link could not be opened — it may have been removed.', true); }
    }
    return;
  }
  showView('events');
}

/* A signed-out visitor gets the welcome page, and is told plainly if the link
   they followed was to an event -- that is a dead end otherwise, since events
   are not the public's to see. */
function landSignedOut() {
  const route = readRoute();
  const note = $('welcome-note');
  if (route?.event) {
    note.textContent = 'That link points to an event. Sign in with Discord to open it.';
    note.hidden = false;
    showView('welcome');
    return;
  }
  note.hidden = true;
  showView(route && route.view !== 'welcome' && route.view === 'overlap' ? 'overlap' : 'welcome');
}

/* Back and forward, and a hash typed by hand. */
window.addEventListener('hashchange', async () => {
  if (routing || !state.session) return;
  const route = readRoute();
  if (!route) return;
  if (route.event) {
    if (state.openEvent?.id !== route.event) {
      showView('events');
      try { await openEvent(route.event); } catch { /* stale link */ }
    }
  } else {
    if (state.openEvent) closeEvent();
    showView(route.view);
  }
});

/* ---------- grid construction ---------- */
/* One builder for all three grids. `mode` is 'read' (heatmap), 'edit' (the
   member's own hours) or 'pick' (leader, click an hour to see who). */
function buildGrid(el, mode) {
  el.innerHTML = '';
  const cells = new Array(168);

  el.appendChild(document.createElement('div')); // gutter corner
  for (let day = 0; day < 7; day++) {
    const h = document.createElement('div');
    h.className = 'dh';
    h.textContent = DAY_NAMES[day];
    el.appendChild(h);
  }

  for (let hour = 0; hour < 24; hour++) {
    const g = document.createElement('div');
    g.className = 'hh' + (hour % 3 === 0 ? '' : ' is-quiet');
    g.textContent = hourLabel(hour);
    el.appendChild(g);

    for (let day = 0; day < 7; day++) {
      const i = day * 24 + hour;
      const interactive = mode !== 'read';
      const c = document.createElement(interactive ? 'button' : 'div');
      c.className = 'cell h0' + (hour % 6 === 0 ? ' is-daybreak' : '');
      c.dataset.i = String(i);
      if (interactive) {
        c.type = 'button';
        c.tabIndex = i === 0 ? 0 : -1;   // roving tabindex; 168 tab stops is not navigation
        if (mode === 'edit') c.setAttribute('aria-pressed', 'false');
      }
      c.setAttribute('aria-label', cellLabel(day, hour));
      el.appendChild(c);
      cells[i] = c;
    }
  }
  return cells;
}

/* Arrow-key movement over a grid built above. */
function wireKeys(el, cells) {
  el.addEventListener('keydown', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const i = Number(cell.dataset.i);
    const day = Math.floor(i / 24), hour = i % 24;
    const to = {
      ArrowUp: [day, hour - 1], ArrowDown: [day, hour + 1],
      ArrowLeft: [day - 1, hour], ArrowRight: [day + 1, hour],
    }[e.key];
    if (!to) return;
    const [d, h] = to;
    if (d < 0 || d > 6 || h < 0 || h > 23) return;
    e.preventDefault();
    const next = cells[d * 24 + h];
    cell.tabIndex = -1;
    next.tabIndex = 0;
    next.focus();
  });
}

const HEAT_STEPS = 5;
function heatClass(count, max) {
  if (!count) return 'h0';
  return 'h' + Math.max(1, Math.min(HEAT_STEPS, Math.ceil((count / Math.max(max, 1)) * HEAT_STEPS)));
}

function paintHeat(cells, countAt, max, describe) {
  for (let i = 0; i < 168; i++) {
    const n = countAt(i);
    const c = cells[i];
    c.className = c.className.replace(/\bh[0-5]\b/, heatClass(n, max));
    const day = Math.floor(i / 24), hour = i % 24;
    c.setAttribute('aria-label', `${cellLabel(day, hour)} — ${describe(n)}`);
    c.title = `${cellLabel(day, hour)} · ${describe(n)}`;
  }
}

/* ---------- overlap (public) ---------- */
let overlapCells = null;

function renderOverlap() {
  if (!overlapCells) overlapCells = buildGrid($('overlap-grid'), 'read');

  const countAt = (i) => state.heat.get(LOCAL_TO_SLOT[i]) || 0;
  const counts = Array.from({ length: 168 }, (_, i) => countAt(i));
  const max = Math.max(0, ...counts);

  paintHeat(overlapCells, countAt, max, (n) => (n === 1 ? '1 free' : `${n} free`));

  const s = state.stats;
  $('overlap-stats').textContent = s
    ? `${s.respondents} of ${s.members} members have logged hours · shown in ${tzLabel()}`
    : `shown in ${tzLabel()}`;

  /* Legend is drawn from the same scale the cells use, so it cannot drift. */
  $('overlap-legend').innerHTML = max
    ? '<span>none</span>' +
      Array.from({ length: HEAT_STEPS + 1 }, (_, k) => `<i class="cell h${k}"></i>`).join('') +
      `<span>${max} free</span>`
    : '';

  renderBest(counts, max);
}

/* Contiguous runs of the peak hours, so "Thu 7-10pm" reads as one window
   rather than three rows. Runs do not wrap Saturday into Sunday -- a raid
   window that straddles the week boundary is not a thing anyone schedules. */
function bestWindows(counts, max, limit = 5) {
  if (!max) return [];
  const runs = [];
  const gather = (threshold) => {
    for (let day = 0; day < 7; day++) {
      let run = null;
      for (let hour = 0; hour < 24; hour++) {
        const n = counts[day * 24 + hour];
        if (n >= threshold) {
          if (run) { run.end = hour; run.min = Math.min(run.min, n); run.max = Math.max(run.max, n); }
          else run = { day, start: hour, end: hour, min: n, max: n };
        } else if (run) { runs.push(run); run = null; }
      }
      if (run) runs.push(run);
    }
  };
  gather(max);
  /* A single peak hour on its own is a thin answer. Widening by one drops in
     the near-misses around it, which is usually the window people want. */
  if (runs.length < 3 && max > 1) { runs.length = 0; gather(max - 1); }

  return runs
    .sort((a, b) => (b.max - a.max) || (b.min - a.min) || ((b.end - b.start) - (a.end - a.start)))
    .slice(0, limit);
}

function renderBest(counts, max) {
  const wins = bestWindows(counts, max);
  const el = $('best-windows');
  if (!wins.length) {
    el.innerHTML = '<p class="empty">Nothing logged yet.</p>';
    return;
  }
  el.innerHTML = wins.map((w) => {
    const span = w.start === w.end
      ? `${hourLabel(w.start)}`
      : `${hourLabel(w.start)} – ${hourLabel((w.end + 1) % 24)}`;
    const hrs = w.end - w.start + 1;
    /* A widened window can hold a better hour than its own floor. Showing the
       range keeps "2 free" from hiding the fact that one hour in it has 3. */
    const free = w.min === w.max ? `${w.min} free` : `${w.min}–${w.max} free`;
    return `<li>
      <b>${esc(DAY_NAMES[w.day])} ${esc(span)}</b>
      <span>${hrs} hour${hrs === 1 ? '' : 's'}</span>
      <span class="count">${free}</span>
    </li>`;
  }).join('');
}

/* ---------- my times (member) ---------- */
let mineCells = null;
let painting = false, paintTo = false, suppressClick = false;

function setCell(i, on) {
  const slot = LOCAL_TO_SLOT[i];
  if (on) state.mine.add(slot); else state.mine.delete(slot);
  mineCells[i].setAttribute('aria-pressed', on ? 'true' : 'false');
}

/* How far the grid has drifted from what the server holds. */
function pendingCount(desired, saved) {
  let n = 0;
  for (const x of desired) if (!saved.has(x)) n++;
  for (const x of saved) if (!desired.has(x)) n++;
  return n;
}

function renderMine() {
  if (!mineCells) {
    mineCells = buildGrid($('mine-grid'), 'edit');
    wireKeys($('mine-grid'), mineCells);
    wirePainting();
  }
  for (let i = 0; i < 168; i++) {
    mineCells[i].setAttribute('aria-pressed', state.mine.has(LOCAL_TO_SLOT[i]) ? 'true' : 'false');
  }
  markDirty();
}

function wirePainting() {
  const el = $('mine-grid');

  /* Drag-paint. mousedown does the work and sets a flag so the click that
     follows does not immediately undo it; a keyboard-generated click has no
     preceding mousedown, so it falls through to the click handler below. */
  el.addEventListener('mousedown', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    e.preventDefault();
    const i = Number(cell.dataset.i);
    paintTo = cell.getAttribute('aria-pressed') !== 'true';
    painting = true;
    suppressClick = true;
    setCell(i, paintTo);
    markDirty();
  });

  el.addEventListener('mouseover', (e) => {
    if (!painting) return;
    const cell = e.target.closest('.cell');
    if (!cell) return;
    setCell(Number(cell.dataset.i), paintTo);
    markDirty();
  });

  window.addEventListener('mouseup', () => { painting = false; });

  el.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    if (suppressClick) { suppressClick = false; return; }
    const i = Number(cell.dataset.i);
    setCell(i, cell.getAttribute('aria-pressed') !== 'true');
    markDirty();
  });

  $('clear-all').addEventListener('click', () => {
    for (let i = 0; i < 168; i++) setCell(i, false);
    markDirty();
  });

  $('mine-save').addEventListener('click', saveMine);
}

/* Formerly a debounced autosave. It dropped hours: saveMine() read
   state.mine AFTER its awaits to decide what was now safely stored, so
   anything painted during the round-trip was marked saved without ever having
   been sent, and the next diff then found nothing to do. An explicit save
   removes the overlap entirely; snapshotting the target below removes the bug
   itself, so the two are independent fixes and neither relies on the other. */
function markDirty() {
  const pending = pendingCount(state.mine, state.saved);
  $('mine-count').textContent =
    `${state.mine.size} hour${state.mine.size === 1 ? '' : 's'} marked · ${tzLabel()}`;
  $('mine-save').disabled = pending === 0;
  $('mine-status').textContent = pending
    ? `${pending} unsaved change${pending === 1 ? '' : 's'}`
    : 'Saved';
}

/* Writes the difference, not the whole grid: an insert for newly marked hours
   and a delete for cleared ones. Both are scoped to this member by RLS
   regardless of what member_id the client puts in the payload. */
async function saveMine() {
  const uid = state.session?.user?.id;
  if (!uid) return;

  /* Snapshot what is being sent. Marking state.mine as saved after the awaits
     would claim credit for anything painted meanwhile -- the bug this replaces.
     Only the set actually written becomes the new baseline; anything added
     during the round-trip stays pending and the button stays live. */
  const target = new Set(state.mine);
  const add = [...target].filter((s) => !state.saved.has(s));
  const del = [...state.saved].filter((s) => !target.has(s));
  if (!add.length && !del.length) { markDirty(); return; }

  const btn = $('mine-save');
  btn.disabled = true;
  $('mine-status').textContent = 'Saving…';
  try {
    if (add.length) {
      const { error } = await db.from('raid_availability')
        .insert(add.map((slot) => ({ member_id: uid, slot })));
      if (error) throw error;
    }
    if (del.length) {
      const { error } = await db.from('raid_availability')
        .delete().eq('member_id', uid).in('slot', del);
      if (error) throw error;
    }
    state.saved = target;
    await loadPublic();      // the member's own change moves the public heatmap
    if (isLeader()) await loadLeader();
    markDirty();
    if (pendingCount(state.mine, state.saved) === 0) {
      $('mine-status').textContent = `Saved ${new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
    }
  } catch (err) {
    markDirty();
    $('mine-status').textContent = 'Not saved';
    banner(`Could not save your availability: ${esc(err.message || err)}`, true);
  }
}

/* ---------- company (leader) ---------- */
let companyCells = null;

function renderCompany() {
  if (!companyCells) {
    companyCells = buildGrid($('company-grid'), 'pick');
    wireKeys($('company-grid'), companyCells);
    $('company-grid').addEventListener('click', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell) return;
      pickSlot(Number(cell.dataset.i));
    });
  }

  const countAt = (i) => (state.bySlot.get(LOCAL_TO_SLOT[i]) || []).length;
  const max = Math.max(0, ...Array.from({ length: 168 }, (_, i) => countAt(i)));
  paintHeat(companyCells, countAt, max, (n) => (n === 1 ? '1 free' : `${n} free`));

  if (state.picked !== null) {
    companyCells[state.picked].classList.add('is-picked');
    pickSlot(state.picked);
  }

  $('company-stats').textContent = `${state.members.length} members · shown in ${tzLabel()}`;
  $('company-members').innerHTML = state.members.length
    ? state.members.map((m) => chip(m, m.role === 'leader')).join('')
    : '<p class="empty">No members yet.</p>';
}

function pickSlot(i) {
  if (state.picked !== null && companyCells[state.picked]) {
    companyCells[state.picked].classList.remove('is-picked');
  }
  state.picked = i;
  companyCells[i].classList.add('is-picked');

  const day = Math.floor(i / 24), hour = i % 24;
  const who = state.bySlot.get(LOCAL_TO_SLOT[i]) || [];
  $('company-slot-heading').textContent =
    `${DAY_NAMES[day]} ${hourLabel(hour)} — ${who.length} free`;
  $('company-who').innerHTML = who.length
    ? who.map((m) => chip(m, m.role === 'leader')).join('')
    : '<p class="empty">Nobody has marked this hour.</p>';
}

function chip(m, leader) {
  /* Prefer the linked character where there is one, for the same reason the
     roster does. m may be a bare directory row, so guard on the id. */
  const linked = m.id ? charsOf(m.id)[0] : null;
  const name = esc(linked ? linked.character_name : (m.display_name || 'Adventurer'));
  const face = m.avatar_url
    ? `<img src="${esc(m.avatar_url)}" alt="" width="24" height="24" loading="lazy">`
    : `<span class="fallback">${esc((m.display_name || '?').trim().charAt(0).toUpperCase())}</span>`;
  return `<span class="chip${leader ? ' is-leader' : ''}">${face}<span class="name">${name}</span>${
    leader ? '<span class="tag">Leader</span>' : ''}</span>`;
}

/* ---------- timezone ----------
   Stored on the member so the choice follows them between machines. It is a
   rendering preference only: raid_availability.slot stays an hour of the UTC
   week and raid_event_responses.starts_at stays an absolute instant, which is
   what keeps two members in different zones agreeing on the same moment. */
function wireTimezone() {
  const sel = $('tz-pick');
  let zones = [];
  try { zones = Intl.supportedValuesOf('timeZone'); } catch { zones = []; }
  /* Older engines have no supportedValuesOf. Offer at least the browser's own
     zone and UTC so the control is never empty. */
  if (!zones.length) zones = [...new Set([BROWSER_TZ, 'UTC'])];
  if (!zones.includes(BROWSER_TZ)) zones.unshift(BROWSER_TZ);

  sel.innerHTML = zones.map((z) => `<option value="${esc(z)}">${esc(z)}</option>`).join('');
  sel.value = TZ();

  sel.addEventListener('change', async () => {
    applyTimezone(sel.value);
    $('tz-status').textContent = 'Saving…';
    const { error } = await db.from('raid_members')
      .update({ timezone: currentTz }).eq('id', state.session.user.id);
    $('tz-status').textContent = error ? `Not saved: ${error.message}` : `Saved · ${tzLabel()}`;
  });
}

/* Point every renderer at a new zone. The slot map has to be rebuilt before
   anything redraws, because it is what maps a grid cell to the UTC hour that
   was actually stored. */
function applyTimezone(tz) {
  currentTz = tz || BROWSER_TZ;
  rebuildSlots();
  const sel = $('tz-pick');
  if (sel) { sel.value = currentTz; }
  $('tz-status').textContent = tzLabel();
  renderOverlap();
  if (mineCells) renderMine();
  if (state.openEvent) renderDetail();
  if (state.events.length) renderEvents();
  if (isLeader() && companyCells) renderCompany();
}

/* ---------- loading ---------- */
async function loadPublic() {
  const [heat, stats] = await Promise.all([
    db.rpc('raid_heatmap'),
    db.rpc('raid_stats'),
  ]);
  if (heat.error) throw heat.error;

  state.heat = new Map((heat.data || []).map((r) => [r.slot, r.available]));
  state.stats = stats.error ? null : (stats.data?.[0] ?? null);
  renderOverlap();
  stamp(`Updated ${new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`);
}

async function loadMine() {
  const { data, error } = await db.from('raid_availability').select('slot');
  if (error) throw error;
  state.saved = new Set((data || []).map((r) => r.slot));
  state.mine = new Set(state.saved);
  renderMine();
}

async function loadLeader() {
  /* Both of these return everything only because the caller is a leader --
     the same two queries run by a member come back scoped to their own row. */
  const [rows, members] = await Promise.all([
    db.from('raid_availability').select('slot, raid_members(id, display_name, avatar_url, role)'),
    db.from('raid_members').select('id, display_name, avatar_url, role').order('display_name'),
  ]);
  if (rows.error) throw rows.error;

  const bySlot = new Map();
  for (const r of rows.data || []) {
    if (!r.raid_members) continue;
    if (!bySlot.has(r.slot)) bySlot.set(r.slot, []);
    bySlot.get(r.slot).push(r.raid_members);
  }
  for (const list of bySlot.values()) {
    list.sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''));
  }
  state.bySlot = bySlot;
  state.members = members.error ? [] : (members.data || []);
  renderCompany();
}

async function loadMember() {
  const uid = state.session?.user?.id;
  if (!uid) { state.member = null; return; }
  const { data, error } = await db.from('raid_members')
    .select('id, discord_id, display_name, avatar_url, role, timezone').eq('id', uid).maybeSingle();
  if (error) throw error;
  state.member = data;
  if (data) {
    if (data.timezone) {
      applyTimezone(data.timezone);
    } else {
      /* First sign-in: adopt what the browser reports and write it down, so the
         zone every time is drawn in stops being implicit. */
      applyTimezone(BROWSER_TZ);
      await db.from('raid_members').update({ timezone: BROWSER_TZ }).eq('id', uid);
      state.member.timezone = BROWSER_TZ;
    }
  }
  if (!data) {
    banner('Your Discord login worked, but no member record exists for it yet. ' +
           'A leader may need to run the provisioning trigger for your account.', true);
  }
}

/* ---------- auth ---------- */
async function onSession(session) {
  state.session = session;
  banner('');
  try {
    await loadMember();
    syncChrome();
    if (session) {
      await loadMine();
      await loadEventContext();
      await loadFcRoster();
      await loadCharacters();
      await loadEvents();
      if (isLeader()) await loadLeader();
      maybeOpenGuide();
      await landOnDefaultView();
    } else {
      landed = false;
      landSignedOut();
    }
  } catch (err) {
    banner(`Could not load your account: ${esc(err.message || err)}`, true);
    syncChrome();
  }
}

function wireAuth() {
  $('auth-btn').addEventListener('click', async () => {
    if (state.session) {
      await db.auth.signOut();
      state.member = null;
      state.mine = new Set();
      state.saved = new Set();
      state.events = [];
      state.directory = new Map();
      state.openEvent = null;
      state.evSignups = [];
      state.evResponses = [];
      state.characters = [];
      state.charFilter = '';
      jobOrderDraft.clear();
      $('custom-body').innerHTML = '';
      $('events-detail').hidden = true;
      $('events-index').hidden = false;
      $('events-list').innerHTML = '';
      if ($('guide').open) $('guide').close();
      showView('welcome');
      return;
    }
    const { error } = await db.auth.signInWithOAuth({
      provider: 'discord',
      /* Back to this page, not the site root. Must also be listed under
         Authentication -> URL Configuration -> Redirect URLs in Supabase. */
      options: { redirectTo: location.origin + location.pathname },
    });
    if (error) banner(`Discord sign-in failed: ${esc(error.message)}`, true);
  });

  db.auth.onAuthStateChange((_evt, session) => { onSession(session); });
}

/* ---------- boot ---------- */
async function main() {
  if (!CONFIGURED) {
    buildGrid($('overlap-grid'), 'read');
    banner('This page is not connected to its Supabase project yet. ' +
           'Fill in <code>raid/config.js</code> with the project URL and publishable key.', true);
    stamp('Not configured');
    syncChrome();
    showView('welcome');
    return;
  }

  syncChrome();

  try {
    await loadPublic();
  } catch (err) {
    banner(`Could not load the overlap heatmap: ${esc(err.message || err)}`, true);
    buildGrid($('overlap-grid'), 'read');
  }

  wireAuth();
  wireEventForm();
  wireChars();
  wireTimezone();
  wireGuide();
  wireCustom();
  const { data } = await db.auth.getSession();
  await onSession(data?.session ?? null);
}

main();

/* =========================================================================
   EVENTS
   =========================================================================
   Anyone signed in can create an event. Two shapes: a poll (offer a date
   window, people mark hours, creator locks one in) or a fixed time (people
   just sign up).

   The privacy rule this section implements is enforced in
   sql/002_events.sql, not here. Restating it because it is easy to break by
   accident while editing:

     * a SIGNUP is visible to every member -- a roster is shared with the
       people on it, and renderRoster() draws it for everyone.
     * a RESPONSE ("I can make it at these hours") is visible only to the
       responder, the event's creator, and leaders. So the same poll grid
       renders as "your hours" for a participant and as "everyone's hours"
       for the organiser -- not because of a flag below, but because the
       query returns a different number of rows to each of them.

   Creating an event therefore grants no access to the weekly availability
   grid from 001. If it ever appears to, the bug is in the SQL. */

const ROLES = ['tank', 'healer', 'dps'];
const ROLE_LABEL = { tank: 'Tank', healer: 'Healer', dps: 'DPS' };
const ROLE_ICON  = { tank: 'bi-shield-shaded', healer: 'bi-heart-pulse-fill', dps: 'bi-crosshair' };

Object.assign(state, {
  eventTypes: [],
  directory: new Map(),   // member id -> { display_name, avatar_url, role }
  events: [],
  openEvent: null,
  evSignups: [],
  evResponses: [],        // only the rows RLS hands this viewer
  evMarks: new Set(),     // my marked hours for the open event, as ISO strings
  evSavedMarks: new Set(),
});

/* ---------- dates ----------
   An event happens on a date, so its poll runs over absolute days rather than
   the recurring 0..167 week the availability grid uses. Everything here is
   expressed as {y, mo, d} calendar fields plus TZ(), never as a Date read
   through the browser's own zone. */

/* The poll window as calendar days in the viewer's chosen zone. */
function pollWindow(ev) {
  let start;
  if (ev.poll_start) {
    const [y, mo, d] = String(ev.poll_start).slice(0, 10).split('-').map(Number);
    start = { y, mo, d };
  } else {
    start = todayYmd();
  }
  return Array.from({ length: ev.poll_days || 14 }, (_, i) => addDays(start, i));
}

/* Canonical key for an hour, so a value written by this page and one read back
   from Postgres ('...+00:00') compare equal. */
const hourKey = (v) => new Date(v).toISOString();
const cellKey = (ymd, hour) => new Date(instantAt(ymd.y, ymd.mo, ymd.d, hour)).toISOString();

/* ---------- composition ---------- */
const compOf = (ev) => ({ tank: ev.tanks_needed, healer: ev.healers_needed, dps: ev.dps_needed });
const isUnrestricted = (ev) => ROLES.every((r) => compOf(ev)[r] == null);

function compText(ev) {
  if (isUnrestricted(ev)) {
    return ev.party_size ? `${ev.party_size} spots` : 'Unlimited';
  }
  const c = compOf(ev);
  return ROLES.filter((r) => c[r] != null).map((r) => `${c[r]} ${ROLE_LABEL[r]}`).join(' · ');
}

/* The level, where one is stated. 'required' and 'recommended' are different
   claims and the pill says which -- both are advisory, since the database
   deliberately does not refuse a signup over a level (see 005). */
function levelPill(ev) {
  if (ev.min_level == null) return '';
  const req = ev.level_rule === 'required';
  return `<span class="lvl-pill${req ? ' is-required' : ''}">Lv ${Number(ev.min_level)} ${
    req ? 'required' : 'rec.'}</span>`;
}

/* The highest level this member has on a job that can fill one of the roles
   they are offering, across their linked characters. Used only to warn. */
function levelFor(memberId, roles) {
  let best = null;
  for (const claim of charsOf(memberId)) {
    const c = byLodestone(claim.lodestone_id);
    for (const j of (c?.jobs || [])) {
      const r = JOB_ROLE[j.job];
      if (!r || (roles && roles.length && !roles.includes(r))) continue;
      if (best == null || (j.level || 0) > best) best = j.level || 0;
    }
  }
  return best;
}

/* ---------- the roster solver ----------
   Deterministic, so every viewer computes the same answer from the same rows
   and nobody has to be told where they stand by a column that could go stale.

   Order of precedence:
     1. anyone the organiser explicitly pinned to a role keeps that seat
     2. then, in order: people who said they could make the scheduled hour,
        ahead of people who signed up later without committing to it
     3. within each of those, signup order (seq) decides -- which is the whole
        point of seq being an identity column rather than a timestamp
   Whoever is left over is a backup, in the same order. */
function solveRoster(ev, signups, availableAt) {
  const need = compOf(ev);
  const ordered = [...signups].sort((a, b) => {
    const ac = availableAt.has(a.member_id) ? 0 : 1;
    const bc = availableAt.has(b.member_id) ? 0 : 1;
    return (ac - bc) || (Number(a.seq) - Number(b.seq));
  });

  if (isUnrestricted(ev)) {
    const cap = ev.party_size;
    const roster = [], backup = [];
    for (const s of ordered) (cap == null || roster.length < cap ? roster : backup).push(s);
    return { unrestricted: true, filled: {}, roster, backup };
  }

  /* Seat assignment is a bipartite matching, not a greedy pick, and the
     difference is visible with three people: if someone who can tank-or-DPS
     takes a DPS seat, a later DPS-only signup has nowhere to go and the party
     is short a tank with a spare body standing next to it.

     So this is Kuhn's algorithm with capacities: walk the signups in priority
     order and, when someone's roles are all full, try to move an already-seated
     person to one of THEIR other roles to free the seat. That fills the most
     seats possible while still letting earlier signups win -- nobody who has a
     seat ever loses one, they only slide sideways.

     Roles are tried in tank/healer/dps order, which is the order they are
     scarce in in practice, so a tie between two open roles resolves toward the
     one that is usually harder to fill. */
  const byId = new Map(signups.map((s) => [s.id, s]));
  const roleOf = new Map();                       // signup id -> role
  const count = { tank: 0, healer: 0, dps: 0 };
  const pinned = new Set();

  /* The organiser's explicit pins are fixed points: they are placed first and
     never moved by the solver, even if that puts a role over its count. */
  for (const s of ordered) {
    if (s.assigned_role) {
      roleOf.set(s.id, s.assigned_role);
      count[s.assigned_role]++;
      pinned.add(s.id);
    }
  }

  const rolesOf = (s) => ROLES.filter((r) => (s.roles || []).includes(r));

  function place(s, seen) {
    for (const r of rolesOf(s)) {
      if (need[r] == null || seen.has(r)) continue;
      seen.add(r);
      if (count[r] < need[r]) { roleOf.set(s.id, r); count[r]++; return true; }
      for (const [id, held] of [...roleOf]) {
        if (held !== r || pinned.has(id)) continue;
        roleOf.delete(id); count[r]--;
        if (place(byId.get(id), seen)) { roleOf.set(s.id, r); count[r]++; return true; }
        roleOf.set(id, r); count[r]++;            // put them back
      }
    }
    return false;
  }

  const backup = [];
  for (const s of ordered) {
    if (pinned.has(s.id)) continue;
    if (!place(s, new Set())) backup.push(s);
  }

  const filled = { tank: [], healer: [], dps: [] };
  for (const s of ordered) {
    const r = roleOf.get(s.id);
    if (r) filled[r].push(s);
  }
  return { unrestricted: false, filled, roster: [], backup };
}

/* ---------- people ---------- */
const who = (id) => state.directory.get(id) || { display_name: 'Unknown', avatar_url: null };

function face(m) {
  return m.avatar_url
    ? `<img src="${esc(m.avatar_url)}" alt="" width="22" height="22" loading="lazy">`
    : `<span class="fallback">${esc((m.display_name || '?').trim().charAt(0).toUpperCase())}</span>`;
}

/* ---------- list ---------- */
function renderEvents() {
  const el = $('events-list');
  if (!state.events.length) {
    el.innerHTML = '<p class="empty">Nothing scheduled. Put something up.</p>';
    return;
  }
  const uid = state.session?.user?.id;
  el.innerHTML = `<div class="ev-list">${state.events.map((ev) => {
    const mine = ev.created_by === uid;
    const when = ev.scheduled_at ? fmtWhen(ev.scheduled_at)
      : (ev.mode === 'poll' ? 'Polling for a time' : 'No time set');
    return `<button type="button" class="ev-card is-${esc(ev.status)}" data-event="${esc(ev.id)}">
      <h3>${esc(ev.title)}</h3>
      <div class="ev-meta">
        <span class="pill is-${esc(ev.status)}">${esc(ev.status)}</span>
        ${mine ? '<span class="pill is-mine">Yours</span>' : ''}
        <span>${esc(when)}</span>
        <span>${esc(compText(ev))}</span>
        ${levelPill(ev)}
        <span class="who">by ${esc(who(ev.created_by).display_name)}</span>
      </div>
    </button>`;
  }).join('')}</div>`;
}

/* ---------- detail ---------- */
async function openEvent(id) {
  const ev = state.events.find((e) => e.id === id);
  if (!ev) return;
  state.openEvent = ev;

  const [signups, responses] = await Promise.all([
    db.from('raid_event_signups').select('*').eq('event_id', id).order('seq'),
    db.from('raid_event_responses').select('member_id, starts_at').eq('event_id', id),
  ]);
  if (signups.error) throw signups.error;

  state.evSignups = signups.data || [];
  state.evResponses = responses.error ? [] : (responses.data || []);

  const uid = state.session?.user?.id;
  state.evSavedMarks = new Set(
    state.evResponses.filter((r) => r.member_id === uid).map((r) => hourKey(r.starts_at))
  );
  state.evMarks = new Set(state.evSavedMarks);

  $('events-index').hidden = true;
  $('events-detail').hidden = false;
  writeRoute(null, id, true);
  renderDetail();
}

function closeEvent() {
  state.openEvent = null;
  $('events-detail').hidden = true;
  $('events-index').hidden = false;
  writeRoute('events');
  renderEvents();
}

const canManage = (ev) => ev && (ev.created_by === state.session?.user?.id || isLeader());

/* An existing signup is the member's own answer and is shown back verbatim.
   With no signup yet, seed the boxes from what their linked characters could
   actually fill -- a suggestion to save three clicks, never a constraint. The
   member still submits, and the database only ever receives what they ticked. */
function roleChecked(signup, role) {
  if (signup) return Boolean(signup.roles?.includes(role));
  const uid = state.session?.user?.id;
  return charsOf(uid).some((claim) =>
    rolesFromJobs(byLodestone(claim.lodestone_id) || {}).includes(role));
}
const mySignup = () => state.evSignups.find((s) => s.member_id === state.session?.user?.id) || null;

/* Advisory only. The database does not refuse a signup over a level, because
   doing so would need a character claim and a job level from a JSON file
   republished on a schedule -- it would bar people for being briefly stale and
   leave a leader unable to wave in somebody they know is ready. */
function levelWarning(ev, signup) {
  if (ev.min_level == null) return '';
  const uid = state.session?.user?.id;
  if (!charsOf(uid).length) return '';
  const lv = levelFor(uid, signup?.roles);
  if (lv == null || lv >= ev.min_level) return '';
  return `<p class="lvl-warn">Your linked characters top out at level ${lv} for these roles;
    this is ${ev.level_rule === 'required' ? 'listed as required at' : 'tuned for'}
    level ${Number(ev.min_level)}.</p>`;
}

function renderDetail() {
  const ev = state.openEvent;
  if (!ev) return;
  const manage = canManage(ev);
  const mine = mySignup();

  const when = ev.scheduled_at
    ? `<span class="ev-when">${esc(fmtWhen(ev.scheduled_at))}</span>`
    : `<span class="ev-when">${ev.mode === 'poll' ? 'Time not picked yet' : 'No time set'}</span>`;

  $('events-detail').innerHTML = `
    <div class="detail-top">
      <button type="button" class="back-link" id="ev-back">&larr; All events</button>
      <button type="button" class="ghost" id="ev-copy">Copy link</button>
    </div>

    <div class="section-head">
      <p class="eyebrow">${esc(compText(ev))} · by ${esc(who(ev.created_by).display_name)}</p>
      ${ev.min_level != null ? `<p class="lede" style="margin-top:0">${levelPill(ev)}</p>` : ''}
      <h1>${esc(ev.title)}</h1>
      <p class="lede">${when}
        <span class="pill is-${esc(ev.status)}">${esc(ev.status)}</span></p>
      ${ev.description ? `<p class="ev-desc">${esc(ev.description)}</p>` : ''}
    </div>

    ${ev.status !== 'cancelled' ? `
      <div class="panel">
        <div class="grid-head">
          <h2>${mine ? 'You are signed up' : 'Sign up'}</h2>
          <p class="grid-note" id="signup-status"></p>
        </div>
        ${levelWarning(ev, mine)}
        <p class="hint" style="margin-bottom:10px">Pick every role you can fill — more roles means
           more chance of a seat when the party is short one.</p>
        <div class="roles" id="role-picker">
          ${ROLES.map((r) => `<label class="r-${r}">
            <input type="checkbox" value="${r}"${roleChecked(mine, r) ? ' checked' : ''}>
            <i class="bi ${ROLE_ICON[r]}"></i> ${ROLE_LABEL[r]}
          </label>`).join('')}
        </div>
        <div class="grid-actions">
          <button type="button" class="primary" id="ev-signup">${mine ? 'Update roles' : 'Sign up'}</button>
          ${mine ? '<button type="button" class="ghost" id="ev-withdraw">Withdraw</button>' : ''}
        </div>
      </div>` : ''}

    ${ev.mode === 'poll' && ev.status !== 'cancelled' ? `
      <div class="panel">
        <div class="grid-head">
          <h2>${manage ? 'Who can make it' : 'Your hours'}</h2>
          <p class="grid-note" id="poll-status">${esc(tzLabel())}</p>
        </div>
        <p class="hint" style="margin-bottom:10px">${manage
          ? 'Darker means more people. Click an hour to see who, then lock it in.'
          : 'Drag to mark the hours you could make. Only the organiser and FC leaders see these.'}</p>
        <div class="grid-scroll"><div class="dayg" id="poll-grid"></div></div>
        <div class="grid-actions">
          ${!manage ? '<button type="button" class="primary" id="poll-save" disabled>Save my hours</button>' : ''}
          ${!manage ? '<button type="button" class="ghost" id="ev-prefill">Use my weekly times</button>' : ''}
          <span class="grid-note" id="poll-picked"></span>
          ${manage ? '<button type="button" class="primary" id="ev-schedule" disabled>Schedule this hour</button>' : ''}
        </div>
        <div class="who" id="poll-who" style="margin-top:12px"></div>
      </div>` : ''}

    <div class="panel">
      <div class="grid-head">
        <h2>Roster</h2>
        <p class="grid-note" id="roster-note"></p>
      </div>
      <div id="roster"></div>
    </div>

    ${manage ? `
      <div class="panel">
        <div class="grid-head">
          <h2>Organiser</h2>
          <p class="grid-note" id="announce-status"></p>
        </div>
        <div class="grid-actions">
          <button type="button" class="ghost" id="ev-announce">Announce to Discord</button>
          <button type="button" class="ghost" id="ev-cancel-event">
            ${ev.status === 'cancelled' ? 'Reopen event' : 'Cancel event'}
          </button>
        </div>
      </div>` : ''}
  `;

  $('ev-back').addEventListener('click', closeEvent);
  $('ev-copy').addEventListener('click', copyEventLink);
  wireSignup();
  if (ev.mode === 'poll' && ev.status !== 'cancelled') renderPoll();
  renderRoster();

  const cancelBtn = $('ev-cancel-event');
  if (cancelBtn) cancelBtn.addEventListener('click', toggleCancelled);
  const announceBtn = $('ev-announce');
  if (announceBtn) announceBtn.addEventListener('click', announce);
}

/* Posts the event to the FC's Discord channel.
   The webhook URL is a bearer credential -- anyone holding it can post to the
   channel forever -- so unlike the publishable key it cannot live in this file.
   It is a Supabase secret, and the announce-event Edge Function is the only
   thing that reads it. That function re-checks raid_can_manage_event() against
   the caller's own JWT, so this button is a convenience and not the gate. */
async function announce() {
  const btn = $('ev-announce');
  const status = $('announce-status');
  btn.disabled = true;
  status.textContent = 'Posting…';
  try {
    const { data, error } = await db.functions.invoke('announce-event', {
      body: { event_id: state.openEvent.id },
    });
    /* A non-2xx comes back as a FunctionsHttpError whose body carries the
       reason; surface that rather than "Edge Function returned a non-2xx
       status code", which tells the organiser nothing. */
    if (error) {
      let detail = error.message;
      try {
        const body = await error.context?.json?.();
        if (body?.message || body?.error) detail = body.message || body.error;
      } catch { /* keep the generic message */ }
      throw new Error(detail);
    }
    status.textContent = `Posted to Discord · ${data?.announced ?? 0} signed up`;
  } catch (err) {
    status.textContent = `Not posted: ${err.message || err}`;
  } finally {
    btn.disabled = false;
  }
}

/* A link straight to this event. Anyone following it lands on the event once
   signed in; signed out they get the public heatmap, because events are not
   the public's to see. */
function eventLink(ev) {
  return `${location.origin}${location.pathname}#/event/${ev.id}`;
}

async function copyEventLink() {
  const url = eventLink(state.openEvent);
  const btn = $('ev-copy');
  try {
    await navigator.clipboard.writeText(url);
    btn.textContent = 'Copied';
  } catch {
    /* Clipboard access can be refused (permissions, insecure context). Put the
       link on screen so it can still be copied by hand rather than failing. */
    btn.textContent = 'Copy failed';
    banner(`Event link: <code>${esc(url)}</code>`);
  }
  setTimeout(() => { btn.textContent = 'Copy link'; }, 2000);
}

/* ---------- roster ---------- */
function renderRoster() {
  const ev = state.openEvent;
  const uid = state.session?.user?.id;

  /* Only counts people who committed to the hour that was actually chosen. */
  const availableAt = new Set(
    ev.scheduled_at
      ? state.evResponses.filter((r) => hourKey(r.starts_at) === hourKey(ev.scheduled_at))
          .map((r) => r.member_id)
      : []
  );

  const { unrestricted, filled, roster, backup } = solveRoster(ev, state.evSignups, availableAt);
  const manage = canManage(ev);

  const line = (s, i, pinnable) => {
    const m = who(s.member_id);
    const d = displayFor(s.member_id);
    return `<li class="${s.member_id === uid ? 'is-you' : ''}">
      <span class="pos">${i + 1}</span>${face(m)}
      <span>${esc(d.character || d.name)}</span>
      ${d.showTag ? `<span class="char-tag">${esc(d.name)}</span>` : ''}
      <span class="can">${(s.roles || []).map((r) => ROLE_LABEL[r]).join('/')}</span>
      ${manage && pinnable ? `<button type="button" class="pin${s.assigned_role ? ' is-pinned' : ''}"
        data-pin="${esc(s.id)}">${s.assigned_role ? 'pinned' : 'pin'}</button>` : ''}
    </li>`;
  };

  let html;
  if (unrestricted) {
    html = `<div class="slot-group">
      <h4>Attending <span class="count">${roster.length}${ev.party_size ? ` / ${ev.party_size}` : ''}</span></h4>
      <ul class="slot-list">${roster.length
        ? roster.map((s, i) => line(s, i, false)).join('')
        : '<li class="is-empty">Nobody yet</li>'}</ul></div>`;
  } else {
    const need = compOf(ev);
    html = `<div class="slots">${ROLES.filter((r) => need[r] != null).map((r) => {
      const list = filled[r];
      const empties = Math.max(0, need[r] - list.length);
      return `<div class="slot-group">
        <h4 class="r-${r}"><i class="bi ${ROLE_ICON[r]}"></i> ${ROLE_LABEL[r]}
          <span class="count">${list.length} / ${need[r]}</span></h4>
        <ul class="slot-list">
          ${list.map((s, i) => line(s, i, true)).join('')}
          ${Array.from({ length: empties }, () => '<li class="is-empty">open</li>').join('')}
        </ul></div>`;
    }).join('')}</div>`;
  }

  html += `<div class="slot-group" style="margin-top:16px">
    <h4>Backups <span class="count">in signup order</span></h4>
    <ul class="slot-list">${backup.length
      ? backup.map((s, i) => line(s, i, true)).join('')
      : '<li class="is-empty">None</li>'}</ul></div>`;

  $('roster').innerHTML = html;
  $('roster-note').textContent = ev.scheduled_at
    ? 'People who said they could make the chosen hour rank first, then signup order.'
    : 'Signup order.';

  for (const b of document.querySelectorAll('#roster .pin')) {
    b.addEventListener('click', () => cyclePin(b.dataset.pin));
  }
}

/* The organiser's override. Cycles through the roles this person offered, then
   back to automatic. The database refuses this write from anyone who is not
   the creator or a leader -- see the raid_guard_signup trigger. */
async function cyclePin(signupId) {
  const s = state.evSignups.find((x) => x.id === signupId);
  if (!s) return;
  const options = [...(s.roles || []), null];
  const next = options[(options.indexOf(s.assigned_role ?? null) + 1) % options.length] ?? null;
  const { error } = await db.from('raid_event_signups')
    .update({ assigned_role: next }).eq('id', signupId);
  if (error) { banner(`Could not pin that role: ${esc(error.message)}`, true); return; }
  s.assigned_role = next;
  renderRoster();
}

/* ---------- signup ---------- */
function wireSignup() {
  const btn = $('ev-signup');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const roles = [...document.querySelectorAll('#role-picker input:checked')].map((i) => i.value);
    if (!roles.length) { $('signup-status').textContent = 'Pick at least one role.'; return; }
    const uid = state.session.user.id;
    const existing = mySignup();
    btn.disabled = true;
    try {
      const { error } = existing
        ? await db.from('raid_event_signups').update({ roles }).eq('id', existing.id)
        : await db.from('raid_event_signups')
            .insert({ event_id: state.openEvent.id, member_id: uid, roles });
      if (error) throw error;
      await openEvent(state.openEvent.id);
    } catch (err) {
      $('signup-status').textContent = `Could not save: ${err.message || err}`;
      btn.disabled = false;
    }
  });

  const wd = $('ev-withdraw');
  if (wd) wd.addEventListener('click', async () => {
    /* Responses cascade off the signup, so withdrawing takes the marked hours
       with it -- there is no way to leave a schedule behind after leaving. */
    const { error } = await db.from('raid_event_signups').delete().eq('id', mySignup().id);
    if (error) { banner(`Could not withdraw: ${esc(error.message)}`, true); return; }
    await openEvent(state.openEvent.id);
  });
}

/* ---------- poll grid ---------- */
let pollCells = null, pollDaysCache = null, pollPicked = null;
let pollPainting = false, pollPaintTo = false, pollSuppress = false;

function renderPoll() {
  const ev = state.openEvent;
  const el = $('poll-grid');
  const days = pollWindow(ev);
  pollDaysCache = days;
  const manage = canManage(ev);

  el.style.setProperty('--cols', String(days.length));
  el.innerHTML = '';
  pollCells = new Map();

  el.appendChild(document.createElement('div'));
  for (const d of days) {
    const h = document.createElement('div');
    h.className = 'dh';
    h.innerHTML = `${DAY_NAMES[ymdDow(d)]}<small>${d.d}/${d.mo}</small>`;
    el.appendChild(h);
  }

  const counts = new Map();
  for (const r of state.evResponses) {
    const k = hourKey(r.starts_at);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const max = Math.max(0, ...counts.values());

  for (let hour = 0; hour < 24; hour++) {
    const g = document.createElement('div');
    g.className = 'hh' + (hour % 3 === 0 ? '' : ' is-quiet');
    g.textContent = hourLabel(hour);
    el.appendChild(g);

    for (const d of days) {
      const key = cellKey(d, hour);
      const c = document.createElement('button');
      c.type = 'button';
      c.dataset.key = key;
      const n = counts.get(key) || 0;
      /* The organiser reads counts; a participant reads their own on/off. Both
         come from the same rows -- the participant's query simply returned
         only theirs. */
      c.className = 'cell ' + (manage ? heatClass(n, max) : 'h0')
        + (hour % 6 === 0 ? ' is-daybreak' : '');
      if (!manage) c.setAttribute('aria-pressed', state.evMarks.has(key) ? 'true' : 'false');
      c.setAttribute('aria-label',
        `${DAY_NAMES[ymdDow(d)]} ${d.d}/${d.mo} ${hourLabel(hour)}`
        + (manage ? ` — ${n} free` : ''));
      el.appendChild(c);
      pollCells.set(key, c);
    }
  }

  if (manage) wirePollPick(); else wirePollPaint();
  updatePollStatus();
}

function updatePollStatus() {
  const s = $('poll-status');
  if (!s) return;
  if (canManage(state.openEvent)) {
    s.textContent = `${new Set(state.evResponses.map((r) => r.member_id)).size} responded · ${tzLabel()}`;
    return;
  }
  const pending = pendingCount(state.evMarks, state.evSavedMarks);
  const btn = $('poll-save');
  if (btn) btn.disabled = pending === 0;
  s.textContent = pending
    ? `${pending} unsaved change${pending === 1 ? '' : 's'} · ${tzLabel()}`
    : `${state.evMarks.size} hour${state.evMarks.size === 1 ? '' : 's'} marked · ${tzLabel()}`;
}

/* Participant: paint your own hours. Same mousedown/click dance as the weekly
   grid -- mousedown does the work and flags the click that follows, so a
   keyboard-generated click (which has no mousedown) still toggles. */
function wirePollPaint() {
  const el = $('poll-grid');

  const apply = (cell, on) => {
    const k = cell.dataset.key;
    if (on) state.evMarks.add(k); else state.evMarks.delete(k);
    cell.setAttribute('aria-pressed', on ? 'true' : 'false');
  };

  el.addEventListener('mousedown', (e) => {
    const c = e.target.closest('.cell'); if (!c) return;
    e.preventDefault();
    pollPaintTo = c.getAttribute('aria-pressed') !== 'true';
    pollPainting = true; pollSuppress = true;
    apply(c, pollPaintTo); updatePollStatus();
  });
  el.addEventListener('mouseover', (e) => {
    if (!pollPainting) return;
    const c = e.target.closest('.cell'); if (!c) return;
    apply(c, pollPaintTo); updatePollStatus();
  });
  window.addEventListener('mouseup', () => { pollPainting = false; });
  el.addEventListener('click', (e) => {
    const c = e.target.closest('.cell'); if (!c) return;
    if (pollSuppress) { pollSuppress = false; return; }
    apply(c, c.getAttribute('aria-pressed') !== 'true'); updatePollStatus();
  });

  const pre = $('ev-prefill');
  if (pre) pre.addEventListener('click', () => {
    /* Reuse the weekly grid the member already filled in: mark every hour of
       the poll window that their recurring availability already covers. */
    for (const [key, cell] of pollCells) {
      const d = new Date(key);
      if (state.saved.has(d.getUTCDay() * 24 + d.getUTCHours())) apply(cell, true);
    }
    updatePollStatus();
  });

  const save = $('poll-save');
  if (save) save.addEventListener('click', savePoll);
}

async function savePoll() {
  const ev = state.openEvent;
  const uid = state.session?.user?.id;
  if (!ev || !uid) return;

  /* A response is FK'd to the signup, so marking hours requires being signed
     up. Do it implicitly rather than making people click twice -- but roles
     are still theirs to choose, so default to none and let the role picker
     above correct it. */
  if (!mySignup()) {
    const roles = [...document.querySelectorAll('#role-picker input:checked')].map((i) => i.value);
    if (!roles.length) {
      /* Do NOT roll the grid back here -- that threw away what they had just
         painted. Leave it pending; the save button stays live. */
      $('poll-status').textContent = 'Pick your roles above, then save.';
      return;
    }
    const { error } = await db.from('raid_event_signups')
      .insert({ event_id: ev.id, member_id: uid, roles });
    if (error) { banner(`Could not sign up: ${esc(error.message)}`, true); return; }
    const { data } = await db.from('raid_event_signups').select('*').eq('event_id', ev.id).order('seq');
    state.evSignups = data || [];
  }

  /* Snapshot, for the same reason saveMine() does -- see the note there. */
  const target = new Set(state.evMarks);
  const add = [...target].filter((k) => !state.evSavedMarks.has(k));
  const del = [...state.evSavedMarks].filter((k) => !target.has(k));
  if (!add.length && !del.length) { updatePollStatus(); return; }

  const btn = $('poll-save');
  if (btn) btn.disabled = true;
  $('poll-status').textContent = 'Saving…';
  try {
    if (add.length) {
      const { error } = await db.from('raid_event_responses')
        .insert(add.map((k) => ({ event_id: ev.id, member_id: uid, starts_at: k })));
      if (error) throw error;
    }
    if (del.length) {
      const { error } = await db.from('raid_event_responses')
        .delete().eq('event_id', ev.id).eq('member_id', uid).in('starts_at', del);
      if (error) throw error;
    }
    state.evSavedMarks = target;
    updatePollStatus();
    if (pendingCount(state.evMarks, state.evSavedMarks) === 0) {
      $('poll-status').textContent = `Saved · ${state.evMarks.size} hours · ${tzLabel()}`;
    }
  } catch (err) {
    updatePollStatus();
    banner(`Could not save your hours: ${esc(err.message || err)}`, true);
  }
}

/* Organiser: click an hour to see who is free then, and lock it in. */
function wirePollPick() {
  const el = $('poll-grid');
  el.addEventListener('click', (e) => {
    const c = e.target.closest('.cell'); if (!c) return;
    if (pollPicked && pollCells.get(pollPicked)) pollCells.get(pollPicked).classList.remove('is-picked');
    pollPicked = c.dataset.key;
    c.classList.add('is-picked');

    const free = state.evResponses.filter((r) => hourKey(r.starts_at) === pollPicked)
      .map((r) => who(r.member_id))
      .sort((a, b) => a.display_name.localeCompare(b.display_name));

    $('poll-picked').textContent = `${fmtWhen(pollPicked)} — ${free.length} free`;
    $('poll-who').innerHTML = free.length
      ? free.map((m) => `<span class="chip">${face(m)}<span class="name">${esc(m.display_name)}</span></span>`).join('')
      : '<p class="empty">Nobody has marked this hour.</p>';
    $('ev-schedule').disabled = false;
  });

  $('ev-schedule').addEventListener('click', async () => {
    if (!pollPicked) return;
    const { error } = await db.from('raid_events')
      .update({ scheduled_at: pollPicked, status: 'scheduled' })
      .eq('id', state.openEvent.id);
    if (error) { banner(`Could not schedule: ${esc(error.message)}`, true); return; }
    await loadEvents();
    await openEvent(state.openEvent.id);
  });
}

async function toggleCancelled() {
  const ev = state.openEvent;
  const next = ev.status === 'cancelled'
    ? (ev.scheduled_at ? 'scheduled' : 'open')
    : 'cancelled';
  const { error } = await db.from('raid_events').update({ status: next }).eq('id', ev.id);
  if (error) { banner(`Could not update the event: ${esc(error.message)}`, true); return; }
  await loadEvents();
  await openEvent(ev.id);
}

/* ---------- create ---------- */
function wireEventForm() {
  const form = $('event-form');
  const typeSel = $('ev-type');

  $('new-event').addEventListener('click', () => {
    form.hidden = !form.hidden;
    if (!form.hidden) {
      $('ev-poll-start').value = ymdISO(todayYmd());
      /* Same suggestion the signup picker makes: what the member's linked
         characters could actually fill. */
      for (const box of document.querySelectorAll('#ev-my-roles input')) {
        box.checked = roleChecked(null, box.value);
      }
      $('ev-title').focus();
    }
  });
  $('ev-cancel').addEventListener('click', () => { form.hidden = true; });

  for (const r of document.querySelectorAll('input[name="ev-mode"]')) {
    r.addEventListener('change', () => {
      const poll = document.querySelector('input[name="ev-mode"]:checked').value === 'poll';
      $('ev-poll-fields').hidden = !poll;
      $('ev-fixed-fields').hidden = poll;
    });
  }

  /* Prefill the composition from the duty, then leave it editable -- the event
     stores its own copy, so this is a starting point and not a binding. */
  typeSel.addEventListener('change', () => {
    const t = state.eventTypes.find((x) => x.code === typeSel.value);
    if (!t) return;
    $('ev-tanks').value   = t.tanks   ?? '';
    $('ev-healers').value = t.healers ?? '';
    $('ev-dps').value     = t.dps     ?? '';
    $('ev-size').value    = t.party_size ?? '';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('event-form-error');
    err.hidden = true;

    const mode = document.querySelector('input[name="ev-mode"]:checked').value;
    const numOrNull = (id) => {
      const v = $(id).value.trim();
      return v === '' ? null : Number(v);
    };
    const row = {
      created_by: state.session.user.id,
      title: $('ev-title').value.trim(),
      description: $('ev-desc').value.trim() || null,
      event_type: typeSel.value || null,
      tanks_needed: numOrNull('ev-tanks'),
      healers_needed: numOrNull('ev-healers'),
      dps_needed: numOrNull('ev-dps'),
      party_size: numOrNull('ev-size'),
      mode,
    };
    const lvl = $('ev-level').value.trim();
    row.min_level = lvl === '' ? null : Number(lvl);
    row.level_rule = $('ev-level-rule').value;

    if (mode === 'poll') {
      row.poll_start = $('ev-poll-start').value || ymdISO(todayYmd());
      row.poll_days = Number($('ev-poll-days').value);
      row.status = 'open';
    } else {
      const raw = $('ev-when').value;
      if (!raw) { err.textContent = 'Pick a start time.'; err.hidden = false; return; }
      /* datetime-local hands back wall-clock text with no zone. new Date() would
         read it in the BROWSER's zone, which is wrong for anyone whose chosen
         zone differs -- so parse the fields and place them in TZ(). */
      const [dPart, tPart] = raw.split('T');
      const [wy, wmo, wd] = dPart.split('-').map(Number);
      const [wh, wmi] = tPart.split(':').map(Number);
      row.scheduled_at = new Date(instantAt(wy, wmo, wd, wh, wmi)).toISOString();
      row.status = 'scheduled';
    }

    $('ev-save').disabled = true;
    try {
      const { data, error } = await db.from('raid_events').insert(row).select('id').single();
      if (error) throw error;

      /* Sign the organiser up in the same breath, if they ticked anything.
         Creating and joining were two separate steps before, which read as an
         oversight -- most people putting an event on are playing in it. A
         failure here is not fatal: the event exists, and they can sign up on
         the page it opens. */
      const myRoles = [...document.querySelectorAll('#ev-my-roles input:checked')].map((i) => i.value);
      if (myRoles.length) {
        const { error: joinErr } = await db.from('raid_event_signups')
          .insert({ event_id: data.id, member_id: state.session.user.id, roles: myRoles });
        if (joinErr) banner(`Event created, but signing you up failed: ${esc(joinErr.message)}`, true);
      }

      form.reset();
      form.hidden = true;
      await loadEvents();
      await openEvent(data.id);
    } catch (e2) {
      err.textContent = `Could not create the event: ${e2.message || e2}`;
      err.hidden = false;
    } finally {
      $('ev-save').disabled = false;
    }
  });

  $('events-list').addEventListener('click', (e) => {
    const card = e.target.closest('[data-event]');
    if (card) openEvent(card.dataset.event).catch((x) =>
      banner(`Could not open that event: ${esc(x.message || x)}`, true));
  });
}

/* ---------- getting started ----------
   Opens itself once for somebody who has not linked a character or marked any
   hours -- that is exactly the person it is for -- and never again after they
   close it. localStorage, because it is a per-browser convenience and not worth
   a column; if it is unavailable the guide simply opens each time. */
const GUIDE_SEEN = 'raid.guide.seen';

function openGuide() {
  const d = $('guide');
  if (!d.open) d.showModal();
}

function wireGuide() {
  const d = $('guide');
  $('guide-open').addEventListener('click', openGuide);
  $('welcome-guide').addEventListener('click', openGuide);
  $('welcome-signin').addEventListener('click', () => $('auth-btn').click());
  $('welcome-overlap').addEventListener('click', () => showView('overlap'));
  $('guide-close').addEventListener('click', () => d.close());
  /* Fires for the close button, for Esc, and for the backdrop click below --
     one place to record that it has been read. */
  d.addEventListener('close', () => {
    try { localStorage.setItem(GUIDE_SEEN, '1'); } catch { /* private mode */ }
  });
  d.addEventListener('click', (e) => {
    /* A dialog's own box covers the viewport, so a click landing on it rather
       than on the panel inside is a click on the backdrop. */
    if (e.target === d) d.close();
  });
}

function maybeOpenGuide() {
  let seen = false;
  try { seen = localStorage.getItem(GUIDE_SEEN) === '1'; } catch { seen = false; }
  const fresh = !charsOf(state.session?.user?.id).length && state.saved.size === 0;
  if (!seen && fresh) openGuide();
}

/* ---------- loading ---------- */
async function loadEventContext() {
  /* The directory is a narrow, name-only projection -- see the note on
     raid_member_directory in 002_events.sql. Loaded whole once rather than
     embedded per query, because PostgREST cannot infer an embed through a
     view and an FC is small enough that one fetch is cheaper anyway. */
  const [types, dir] = await Promise.all([
    db.from('raid_event_types').select('*').order('sort_order'),
    db.from('raid_member_directory').select('id, display_name, avatar_url, role'),
  ]);
  state.eventTypes = types.error ? [] : (types.data || []);
  state.directory = new Map((dir.error ? [] : (dir.data || [])).map((m) => [m.id, m]));

  const sel = $('ev-type');
  sel.innerHTML = state.eventTypes
    .map((t) => `<option value="${esc(t.code)}">${esc(t.label)}</option>`).join('');
}

async function loadEvents() {
  const { data, error } = await db.from('raid_events').select('*')
    .order('scheduled_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  state.events = data || [];
  renderEvents();
}

/* =========================================================================
   CHARACTERS
   =========================================================================
   A member claims one or more FFXIV characters off the existing FC roster.
   Self-asserted on purpose -- there is no verification step and none is wanted
   -- but the unique constraint on lodestone_id means a character can be claimed
   only once, so a wrong claim blocks rather than duplicates, and a leader can
   reassign or remove it.

   Claims are readable by every member (migration 003), because the whole point
   of linking is for the company to know who is who. What a claim never carries
   is availability: raid_availability and raid_event_responses are untouched by
   any of this.

   Nothing about the character is stored beyond the Lodestone id, name and
   world. Portraits, titles, Grand Company and jobs are read from the roster
   JSON at render time, so a plate stays current as that file is republished
   rather than freezing whatever was true on the day someone clicked claim. */

const ROSTER_URL = 'https://raw.githubusercontent.com/BattyDev/batty-ffxiv-status/data/ffxiv.json';
const ROSTER_FALLBACK = '../ffxiv/ffxiv.json';
const JOB_ICONS = '../ffxiv/assets/job-icons/';

/* Duty Finder's role split. The roster JSON's own `role` field says
   combat/craft/gather, which is a different question, so this map is the one
   that can answer "what could this character actually be in a party". */
const JOB_ROLE = (() => {
  const m = {};
  for (const j of ['Paladin', 'Warrior', 'Dark Knight', 'Gunbreaker', 'Gladiator', 'Marauder']) m[j] = 'tank';
  for (const j of ['White Mage', 'Scholar', 'Astrologian', 'Sage', 'Conjurer']) m[j] = 'healer';
  for (const j of ['Monk', 'Dragoon', 'Ninja', 'Samurai', 'Reaper', 'Viper', 'Bard', 'Machinist',
                   'Dancer', 'Black Mage', 'Summoner', 'Red Mage', 'Pictomancer', 'Blue Mage',
                   'Pugilist', 'Lancer', 'Rogue', 'Archer', 'Thaumaturge', 'Arcanist']) m[j] = 'dps';
  return m;
})();

Object.assign(state, {
  fcRoster: [],           // the Lodestone roster, from the published JSON
  jobIcons: {},
  characters: [],         // every claim this viewer can read (all of them)
  charFilter: '',
});

const slug = (s) => String(s ?? '').toLowerCase();
const byLodestone = (id) => state.fcRoster.find((c) => String(c.id) === String(id)) || null;
const gcClass = (c) => `gc-${slug(c?.grand_company || 'none').replace(/[^a-z]/g, '') || 'none'}`;

/* Which raid roles this character's levelled combat jobs could cover. Used to
   preselect the role checkboxes on signup -- a suggestion, never a constraint:
   the member still chooses, and the database only ever sees what they picked. */
function rolesFromJobs(c, minLevel = 50, claim = null) {
  /* Walked in the member's preferred job order where there is one, so the roles
     come out most-wanted first rather than in the fixed tank/healer/DPS order.
     Which roles are offered does not change -- only which reads first. */
  const jobs = claim ? mergeJobOrder(c, claim.job_order) : (c?.jobs || []);
  const found = [];
  for (const j of jobs) {
    const r = JOB_ROLE[j.job];
    if (r && (j.level || 0) >= minLevel && !found.includes(r)) found.push(r);
  }
  return claim ? found : ROLES.filter((r) => found.includes(r));
}

/* Every claim held by one member, newest first. */
const charsOf = (memberId) => state.characters.filter((c) => c.member_id === memberId);

/* The name to show for somebody on a shared roster: their character if they
   have linked one, else their Discord display name. */
function displayFor(memberId) {
  const m = who(memberId);
  const character = charsOf(memberId)[0]?.character_name ?? null;
  return {
    name: m.display_name,
    character,
    /* Plenty of people use their character name as their Discord name. Showing
       it twice reads as a rendering bug rather than as extra information. */
    showTag: Boolean(character) && slug(character) !== slug(m.display_name),
    avatar_url: m.avatar_url,
  };
}

/* ---------- rendering a plate ---------- */
function jobChip(j, main) {
  const icon = state.jobIcons[j.job];
  return `<span class="job${main ? ' is-main' : ''}">${
    icon ? `<img src="${esc(JOB_ICONS + icon)}" alt="" width="20" height="20" loading="lazy">` : ''
  }${esc(j.job)} <span class="lv">${Number(j.level) || 0}</span></span>`;
}

function plate(c, { tag = 'div', body = '', attrs = '' } = {}) {
  /* Whatever this member said they would rather play, where they have said it.
     Falls back to the Lodestone's own main job otherwise. */
  const claim = state.characters.find((x) => String(x.lodestone_id) === String(c.id));
  const main = preferredJob(c, claim) || c.main_job;
  const roles = rolesFromJobs(c, 50, claim);
  return `<${tag} class="adventurer ${gcClass(c)}" ${attrs}>
    <div class="char-head">
      ${c.avatar
        ? `<img class="portrait" src="${esc(c.avatar)}" alt="" width="56" height="56" loading="lazy">`
        : '<span class="portrait"></span>'}
      <div class="char-id">
        <h3 class="char-name">${esc(c.name)}</h3>
        ${c.title ? `<span class="char-title">${esc(c.title)}</span>` : ''}
        <div class="char-meta">${esc(c.race || '')}${c.world ? ` · ${esc(c.world)}` : ''}</div>
        ${c.grand_company
          ? `<span class="gc-badge">${esc(c.grand_company)}</span>` : ''}
      </div>
    </div>
    ${main ? `<div class="job-list">${jobChip(main, true)}</div>` : ''}
    ${roles.length
      ? `<div class="role-hint">${roles.map((r) => `<span class="r-${r}">${ROLE_LABEL[r]}</span>`).join('')}</div>`
      : ''}
    ${body}
  </${tag}>`;
}

/* ---------- views ---------- */
function renderChars() {
  const uid = state.session?.user?.id;
  const mine = charsOf(uid);
  const claimedIds = new Set(state.characters.map((c) => String(c.lodestone_id)));

  /* Yours */
  const my = $('my-chars');
  if (!state.fcRoster.length) {
    my.innerHTML = '<p class="empty">Could not load the Free Company roster.</p>';
  } else if (!mine.length) {
    my.innerHTML = '<p class="empty">No characters linked yet. Claim one below.</p>';
  } else {
    my.innerHTML = mine.map((claim) => {
      const c = byLodestone(claim.lodestone_id)
        /* The roster JSON is the source of truth for everything cosmetic, but
           a character who has left the FC drops out of it. Fall back to what
           the claim itself stored so the plate degrades instead of vanishing. */
        || { id: claim.lodestone_id, name: claim.character_name, world: claim.world, jobs: [] };
      return plate(c, {
        body: `<div class="plate-foot">
          <span class="grid-note">${byLodestone(claim.lodestone_id) ? 'Linked' : 'Linked · no longer on the FC roster'}</span>
          <button type="button" class="ghost" data-unlink="${esc(claim.id)}">Unlink</button>
        </div>`,
      });
    }).join('');
  }
  $('chars-status').textContent = mine.length
    ? `${mine.length} linked` : 'None linked';

  /* Claim a character */
  const q = slug(state.charFilter).trim();
  const available = state.fcRoster
    .filter((c) => !claimedIds.has(String(c.id)))
    .filter((c) => !q || slug(c.name).includes(q) || slug(c.main_job?.job).includes(q));
  const shown = available.slice(0, 24);

  $('claim-list').innerHTML = shown.length
    ? shown.map((c) => plate(c, {
        tag: 'button',
        attrs: `type="button" data-claim="${esc(c.id)}"`,
        body: '<div class="plate-foot"><span class="grid-note">Claim this character</span></div>',
      })).join('')
    : '<p class="empty">No unclaimed characters match.</p>';
  $('claim-note').textContent = state.fcRoster.length
    ? `${available.length} unclaimed${shown.length < available.length ? ` · showing ${shown.length}` : ''}`
    : '';

  /* Leaders: every claim, correctable */
  $('claims-admin').hidden = !isLeader();
  if (isLeader()) {
    $('all-claims').innerHTML = state.characters.length
      ? `<div class="claims-table">${state.characters.map((claim) => `
          <div class="claim-row">
            <span>${esc(claim.character_name)}</span>
            <span class="arrow">&rarr;</span>
            <span>${esc(who(claim.member_id).display_name)}</span>
            <span class="spacer"></span>
            <button type="button" class="ghost" data-unlink="${esc(claim.id)}">Remove</button>
          </div>`).join('')}</div>`
      : '<p class="empty">Nobody has linked a character yet.</p>';
  }
}

function wireChars() {
  $('char-search').addEventListener('input', (e) => {
    state.charFilter = e.target.value;
    renderChars();
  });

  /* One delegated handler for both lists -- claim buttons live in the roster
     grid, unlink buttons in the member's own plates and the leader table. */
  document.getElementById('view-chars').addEventListener('click', async (e) => {
    const claimBtn = e.target.closest('[data-claim]');
    if (claimBtn) return claimCharacter(claimBtn.dataset.claim);
    const unlinkBtn = e.target.closest('[data-unlink]');
    if (unlinkBtn) return unlinkCharacter(unlinkBtn.dataset.unlink);
  });
}

async function claimCharacter(lodestoneId) {
  const c = byLodestone(lodestoneId);
  if (!c) return;
  try {
    const { error } = await db.from('raid_characters').insert({
      member_id: state.session.user.id,
      lodestone_id: String(c.id),
      character_name: c.name,
      world: c.world || null,
    });
    if (error) throw error;
    await loadCharacters();
    banner('');
  } catch (err) {
    /* The unique constraint is the race-condition guard: two people claiming
       the same character at once, or a stale page. Say which it was. */
    banner(/duplicate|unique/i.test(err.message || '')
      ? `${esc(c.name)} has already been claimed by someone else. Reload to see who.`
      : `Could not claim that character: ${esc(err.message || err)}`, true);
  }
}

async function unlinkCharacter(id) {
  const { error } = await db.from('raid_characters').delete().eq('id', id);
  if (error) { banner(`Could not unlink: ${esc(error.message)}`, true); return; }
  await loadCharacters();
}

/* ---------- loading ---------- */
async function loadCharacters() {
  const { data, error } = await db.from('raid_characters')
    .select('id, member_id, lodestone_id, character_name, world, job_order')
    .order('created_at');
  if (error) throw error;
  state.characters = data || [];
  renderChars();
  renderCustom();
  /* An event roster may now have a character name to show where it previously
     had a Discord handle. */
  if (state.openEvent) renderRoster();
}

/* The published roster, with the same URL and local fallback /ffxiv uses. */
async function loadFcRoster() {
  const grab = async (url) => {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  };
  let data = null;
  try {
    data = await grab(ROSTER_URL);
  } catch {
    try { data = await grab(ROSTER_FALLBACK); } catch { data = null; }
  }
  state.fcRoster = (data?.roster || []).filter((c) => c && c.id && c.name);

  try {
    state.jobIcons = await grab(`${JOB_ICONS}job-icons.json`);
  } catch {
    state.jobIcons = {};   // chips fall back to a bare label
  }
}

/* =========================================================================
   CUSTOMISATION -- preferred job order
   =========================================================================
   The Lodestone carries every job a character has ever levelled, in the game's
   own order. That says nothing about what somebody wants to be asked to play:
   a capped Warrior they are bored of outranks the level 90 Sage they are
   enjoying, and the site would read them as a tank forever. So a member orders
   their own jobs, and everything that guesses at a job -- the plate, the role
   hints -- reads the top of that list instead of the level column.

   The stored array is deliberately a hint rather than the truth. It is written
   once and the character keeps levelling, so it goes stale in both directions:
   jobs appear that are not in it, and jobs leave the character that still are.
   mergeJobOrder() reconciles both at render time rather than trying to keep the
   column exhaustive. */

const ROLE_OF_JOB = (j) => JOB_ROLE[j?.job] || null;

/* Default order when nobody has said otherwise: combat first (that is what
   events ask for), then crafters, then gatherers, each by level. */
function defaultJobOrder(c) {
  const rank = { combat: 0, craft: 1, gather: 2, field: 3 };
  return [...(c?.jobs || [])].sort((a, b) => {
    const ar = rank[a.role] ?? 9;
    const br = rank[b.role] ?? 9;
    return (ar - br) || ((b.level || 0) - (a.level || 0)) || a.job.localeCompare(b.job);
  });
}

/* The saved order reconciled against the jobs the character actually has now:
   stored names that still exist, in the stored order, then everything new in
   default order. A job that left the character simply drops out. */
function mergeJobOrder(c, stored) {
  const have = new Map((c?.jobs || []).map((j) => [j.job, j]));
  const out = [];
  for (const name of (stored || [])) {
    const j = have.get(name);
    if (j) { out.push(j); have.delete(name); }
  }
  for (const j of defaultJobOrder({ jobs: [...have.values()] })) out.push(j);
  return out;
}

/* The job this member would rather be playing on that character. The plate
   reads this, so it shows a chosen job rather than whichever one is highest. */
function preferredJob(c, claim) {
  const ordered = mergeJobOrder(c, claim?.job_order);
  return ordered.find((j) => ROLE_OF_JOB(j)) || ordered[0] || c?.main_job || null;
}

const jobOrderDraft = new Map();   // lodestone_id -> [job name] being edited

function renderCustom() {
  const el = $('custom-body');
  const uid = state.session?.user?.id;
  const mine = charsOf(uid);

  if (!mine.length) {
    el.innerHTML = '<div class="panel"><p class="empty">Link a character first &mdash; the jobs '
      + 'to order come from it. Use the <b>Characters</b> tab.</p></div>';
    return;
  }

  el.innerHTML = mine.map((claim) => {
    const c = byLodestone(claim.lodestone_id);
    if (!c) {
      return `<div class="panel custom-char">
        <div class="grid-head"><h2>${esc(claim.character_name)}</h2></div>
        <p class="empty">This character is no longer on the Free Company roster, so its
           job list cannot be read.</p></div>`;
    }
    const order = jobOrderDraft.get(String(claim.lodestone_id))
      || mergeJobOrder(c, claim.job_order).map((j) => j.job);
    const byName = new Map((c.jobs || []).map((j) => [j.job, j]));

    return `<div class="panel custom-char" data-char="${esc(claim.lodestone_id)}">
      <div class="grid-head">
        <h2>${esc(c.name)}</h2>
        <p class="grid-note" id="jo-status-${esc(claim.lodestone_id)}"></p>
      </div>
      <p class="hint" style="margin-bottom:12px">Top of the list is what you would rather be
         asked to play. Drag a row, or use the arrows.</p>
      <ol class="job-order" data-list="${esc(claim.lodestone_id)}">
        ${order.map((name, i) => {
          const j = byName.get(name);
          if (!j) return '';
          const role = ROLE_OF_JOB(j);
          const icon = state.jobIcons[j.job];
          return `<li draggable="true" data-job="${esc(name)}" data-i="${i}">
            <span class="grip" aria-hidden="true">&#9776;</span>
            <span class="rank">${i + 1}</span>
            ${icon ? `<img src="${esc(JOB_ICONS + icon)}" alt="" width="22" height="22" loading="lazy">` : ''}
            <span class="jname">${esc(j.job)}</span>
            <span class="jlv">${Number(j.level) || 0}</span>
            ${role ? `<span class="jrole r-${role}">${ROLE_LABEL[role]}</span>`
                   : '<span class="jrole">&mdash;</span>'}
            <button type="button" class="nudge" data-move="up" data-i="${i}"
              aria-label="Move ${esc(j.job)} up"${i === 0 ? ' disabled' : ''}>&uarr;</button>
            <button type="button" class="nudge" data-move="down" data-i="${i}"
              aria-label="Move ${esc(j.job)} down"${i === order.length - 1 ? ' disabled' : ''}>&darr;</button>
          </li>`;
        }).join('')}
      </ol>
      <div class="grid-actions">
        <button type="button" class="primary" data-save="${esc(claim.lodestone_id)}" disabled>Save order</button>
        <button type="button" class="ghost" data-reset="${esc(claim.lodestone_id)}">Reset to default</button>
      </div>
    </div>`;
  }).join('');

  for (const [id] of jobOrderDraft) markJobOrderDirty(id);
}

function currentOrder(lodestoneId) {
  const list = document.querySelector(`[data-list="${CSS.escape(String(lodestoneId))}"]`);
  return list ? [...list.querySelectorAll('li')].map((li) => li.dataset.job) : [];
}

function markJobOrderDirty(lodestoneId) {
  const claim = state.characters.find((c) => String(c.lodestone_id) === String(lodestoneId));
  const c = byLodestone(lodestoneId);
  if (!claim || !c) return;
  const saved = mergeJobOrder(c, claim.job_order).map((j) => j.job).join(' ');
  const now = currentOrder(lodestoneId).join(' ');
  const btn = document.querySelector(`[data-save="${CSS.escape(String(lodestoneId))}"]`);
  const status = $(`jo-status-${lodestoneId}`);
  if (btn) btn.disabled = saved === now;
  if (status) status.textContent = saved === now ? 'Saved' : 'Unsaved changes';
}

/* Reorder the draft and redraw. The list is short, and redrawing keeps the rank
   numbers, the disabled end-stops and the drag handles consistent without
   hand-patching each of them. */
function moveJob(lodestoneId, from, to) {
  const order = currentOrder(lodestoneId);
  if (to < 0 || to >= order.length) return;
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  jobOrderDraft.set(String(lodestoneId), order);
  renderCustom();
  /* Keep the moved row's button under the pointer, so a second nudge does not
     make the mouse chase it down the list. */
  const dir = to > from ? 'down' : 'up';
  const btn = document.querySelector(
    `[data-list="${CSS.escape(String(lodestoneId))}"] li[data-i="${to}"] [data-move="${dir}"]`);
  if (btn && !btn.disabled) btn.focus();
}

function wireCustom() {
  const root = $('view-custom');
  let dragFrom = null;

  root.addEventListener('click', (e) => {
    const move = e.target.closest('[data-move]');
    if (move) {
      const id = move.closest('[data-char]').dataset.char;
      const i = Number(move.dataset.i);
      return moveJob(id, i, move.dataset.move === 'up' ? i - 1 : i + 1);
    }
    const save = e.target.closest('[data-save]');
    if (save) return saveJobOrder(save.dataset.save);
    const reset = e.target.closest('[data-reset]');
    if (reset) {
      const c = byLodestone(reset.dataset.reset);
      jobOrderDraft.set(String(reset.dataset.reset), defaultJobOrder(c).map((j) => j.job));
      renderCustom();
    }
  });

  /* Native drag-and-drop, for a mouse. It does nothing on touch, which is why
     the arrows are the primary control rather than a courtesy. */
  root.addEventListener('dragstart', (e) => {
    const li = e.target.closest('li[data-job]');
    if (!li) return;
    dragFrom = { id: li.closest('[data-char]').dataset.char, i: Number(li.dataset.i) };
    li.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    /* Firefox refuses to start a drag unless data is set on the transfer. */
    e.dataTransfer.setData('text/plain', li.dataset.job);
  });
  root.addEventListener('dragover', (e) => {
    const li = e.target.closest('li[data-job]');
    if (!li || !dragFrom) return;
    e.preventDefault();
    li.classList.add('is-over');
  });
  root.addEventListener('dragleave', (e) => {
    const li = e.target.closest('li[data-job]');
    if (li) li.classList.remove('is-over');
  });
  root.addEventListener('drop', (e) => {
    const li = e.target.closest('li[data-job]');
    if (!li || !dragFrom) return;
    e.preventDefault();
    const id = li.closest('[data-char]').dataset.char;
    if (id === dragFrom.id) moveJob(id, dragFrom.i, Number(li.dataset.i));
    dragFrom = null;
  });
  root.addEventListener('dragend', () => {
    dragFrom = null;
    for (const el of root.querySelectorAll('.is-dragging, .is-over')) {
      el.classList.remove('is-dragging', 'is-over');
    }
  });
}

async function saveJobOrder(lodestoneId) {
  const claim = state.characters.find((c) => String(c.lodestone_id) === String(lodestoneId));
  if (!claim) return;
  /* Snapshot before the await, for the reason saveMine() spells out. */
  const target = currentOrder(lodestoneId);
  const status = $(`jo-status-${lodestoneId}`);
  const btn = document.querySelector(`[data-save="${CSS.escape(String(lodestoneId))}"]`);
  if (btn) btn.disabled = true;
  if (status) status.textContent = 'Saving...';
  try {
    const { error } = await db.from('raid_characters')
      .update({ job_order: target }).eq('id', claim.id);
    if (error) throw error;
    claim.job_order = target;
    jobOrderDraft.delete(String(lodestoneId));
    renderCustom();
    /* The plate and its role hints read the top of this list. */
    renderChars();
  } catch (err) {
    if (status) status.textContent = `Not saved: ${err.message || err}`;
    if (btn) btn.disabled = false;
  }
}
