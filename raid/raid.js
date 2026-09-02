/* Wild Hearts · Raid Nights
   Members log the hours they can raid; the company finds the overlap.

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

const CFG = window.RAID_CONFIG || {};
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

function weekStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function cellDate(day, hour) {
  const d = weekStart();
  d.setDate(d.getDate() + day);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/* local grid index (day * 24 + hour) -> UTC slot, and back */
const LOCAL_TO_SLOT = new Array(168);
const SLOT_TO_LOCAL = new Map();
for (let day = 0; day < 7; day++) {
  for (let hour = 0; hour < 24; hour++) {
    const d = cellDate(day, hour);
    const slot = d.getUTCDay() * 24 + d.getUTCHours();
    LOCAL_TO_SLOT[day * 24 + hour] = slot;
    SLOT_TO_LOCAL.set(slot, day * 24 + hour);
  }
}

const HOUR_FMT = new Intl.DateTimeFormat(undefined, { hour: 'numeric' });
const hourLabel = (h) => HOUR_FMT.format(cellDate(0, h));
const cellLabel = (day, hour) => `${DAY_NAMES[day]} ${hourLabel(hour)}`;

const TZ_NAME = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time'; }
  catch { return 'local time'; }
})();

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

  if (!signedIn && !document.querySelector('#view-overlap').classList.contains('is-active')) {
    showView('overlap');
  }
}

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
    ? `${s.respondents} of ${s.members} members have logged hours · shown in ${TZ_NAME}`
    : `shown in ${TZ_NAME}`;

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
let saveTimer = null;

function setCell(i, on) {
  const slot = LOCAL_TO_SLOT[i];
  if (on) state.mine.add(slot); else state.mine.delete(slot);
  mineCells[i].setAttribute('aria-pressed', on ? 'true' : 'false');
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
  $('mine-count').textContent =
    `${state.mine.size} hour${state.mine.size === 1 ? '' : 's'} marked · ${TZ_NAME}`;
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
    queueSave();
  });

  el.addEventListener('mouseover', (e) => {
    if (!painting) return;
    const cell = e.target.closest('.cell');
    if (!cell) return;
    setCell(Number(cell.dataset.i), paintTo);
    queueSave();
  });

  window.addEventListener('mouseup', () => { painting = false; });

  el.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    if (suppressClick) { suppressClick = false; return; }
    const i = Number(cell.dataset.i);
    setCell(i, cell.getAttribute('aria-pressed') !== 'true');
    queueSave();
  });

  $('clear-all').addEventListener('click', () => {
    for (let i = 0; i < 168; i++) setCell(i, false);
    queueSave();
  });
}

function queueSave() {
  $('mine-count').textContent =
    `${state.mine.size} hour${state.mine.size === 1 ? '' : 's'} marked · ${TZ_NAME}`;
  $('mine-status').textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveMine, 600);
}

/* Writes the difference, not the whole grid: an insert for newly marked hours
   and a delete for cleared ones. Both are scoped to this member by RLS
   regardless of what member_id the client puts in the payload. */
async function saveMine() {
  const uid = state.session?.user?.id;
  if (!uid) return;

  const add = [...state.mine].filter((s) => !state.saved.has(s));
  const del = [...state.saved].filter((s) => !state.mine.has(s));
  if (!add.length && !del.length) { $('mine-status').textContent = 'Saved'; return; }

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
    state.saved = new Set(state.mine);
    $('mine-status').textContent = `Saved ${new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
    await loadPublic();      // the member's own change moves the public heatmap
    if (isLeader()) await loadLeader();
  } catch (err) {
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

  $('company-stats').textContent = `${state.members.length} members · shown in ${TZ_NAME}`;
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
  const name = esc(m.display_name || 'Adventurer');
  const face = m.avatar_url
    ? `<img src="${esc(m.avatar_url)}" alt="" width="24" height="24" loading="lazy">`
    : `<span class="fallback">${esc((m.display_name || '?').trim().charAt(0).toUpperCase())}</span>`;
  return `<span class="chip${leader ? ' is-leader' : ''}">${face}<span class="name">${name}</span>${
    leader ? '<span class="tag">Leader</span>' : ''}</span>`;
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
  $('mine-status').textContent = 'Saved';
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
    .select('id, discord_id, display_name, avatar_url, role').eq('id', uid).maybeSingle();
  if (error) throw error;
  state.member = data;
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
      await loadEvents();
      if (isLeader()) await loadLeader();
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
      $('events-detail').hidden = true;
      $('events-index').hidden = false;
      $('events-list').innerHTML = '';
      showView('overlap');
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

/* ---------- dates ---------- */
/* 'YYYY-MM-DD' through the Date constructor is parsed as UTC midnight, which
   renders as the previous day for anyone west of Greenwich. Build it locally. */
function parseISODate(s) {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

const localISODate = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function pollWindow(ev) {
  const start = parseISODate(ev.poll_start) || new Date(new Date().setHours(0, 0, 0, 0));
  return Array.from({ length: ev.poll_days || 14 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    d.setHours(0, 0, 0, 0);
    return d;
  });
}

/* Canonical key for an hour, so a value written by this page and one read back
   from Postgres ('...+00:00') compare equal. */
const hourKey = (v) => new Date(v).toISOString();
const cellKey = (day, hour) => {
  const d = new Date(day);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

const fmtWhen = (v) => new Date(v).toLocaleString(undefined, {
  weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});

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
  renderDetail();
}

function closeEvent() {
  state.openEvent = null;
  $('events-detail').hidden = true;
  $('events-index').hidden = false;
  renderEvents();
}

const canManage = (ev) => ev && (ev.created_by === state.session?.user?.id || isLeader());
const mySignup = () => state.evSignups.find((s) => s.member_id === state.session?.user?.id) || null;

function renderDetail() {
  const ev = state.openEvent;
  if (!ev) return;
  const manage = canManage(ev);
  const mine = mySignup();

  const when = ev.scheduled_at
    ? `<span class="ev-when">${esc(fmtWhen(ev.scheduled_at))}</span>`
    : `<span class="ev-when">${ev.mode === 'poll' ? 'Time not picked yet' : 'No time set'}</span>`;

  $('events-detail').innerHTML = `
    <button type="button" class="back-link" id="ev-back">&larr; All events</button>

    <div class="section-head">
      <p class="eyebrow">${esc(compText(ev))} · by ${esc(who(ev.created_by).display_name)}</p>
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
        <p class="hint" style="margin-bottom:10px">Pick every role you can fill — more roles means
           more chance of a seat when the party is short one.</p>
        <div class="roles" id="role-picker">
          ${ROLES.map((r) => `<label class="r-${r}">
            <input type="checkbox" value="${r}"${mine?.roles?.includes(r) ? ' checked' : ''}>
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
          <p class="grid-note" id="poll-status">${esc(TZ_NAME)}</p>
        </div>
        <p class="hint" style="margin-bottom:10px">${manage
          ? 'Darker means more people. Click an hour to see who, then lock it in.'
          : 'Drag to mark the hours you could make. Only the organiser and FC leaders see these.'}</p>
        <div class="grid-scroll"><div class="dayg" id="poll-grid"></div></div>
        <div class="grid-actions">
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
        <div class="grid-head"><h2>Organiser</h2></div>
        <div class="grid-actions">
          <button type="button" class="ghost" id="ev-cancel-event">
            ${ev.status === 'cancelled' ? 'Reopen event' : 'Cancel event'}
          </button>
        </div>
      </div>` : ''}
  `;

  $('ev-back').addEventListener('click', closeEvent);
  wireSignup();
  if (ev.mode === 'poll' && ev.status !== 'cancelled') renderPoll();
  renderRoster();

  const cancelBtn = $('ev-cancel-event');
  if (cancelBtn) cancelBtn.addEventListener('click', toggleCancelled);
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
    return `<li class="${s.member_id === uid ? 'is-you' : ''}">
      <span class="pos">${i + 1}</span>${face(m)}
      <span>${esc(m.display_name)}</span>
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
let pollPainting = false, pollPaintTo = false, pollSuppress = false, pollTimer = null;

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
    h.innerHTML = `${DAY_NAMES[d.getDay()]}<small>${d.getDate()}/${d.getMonth() + 1}</small>`;
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
        `${DAY_NAMES[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1} ${hourLabel(hour)}`
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
  s.textContent = canManage(state.openEvent)
    ? `${new Set(state.evResponses.map((r) => r.member_id)).size} responded · ${TZ_NAME}`
    : `${state.evMarks.size} hour${state.evMarks.size === 1 ? '' : 's'} marked · ${TZ_NAME}`;
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
    apply(c, pollPaintTo); queuePollSave();
  });
  el.addEventListener('mouseover', (e) => {
    if (!pollPainting) return;
    const c = e.target.closest('.cell'); if (!c) return;
    apply(c, pollPaintTo); queuePollSave();
  });
  window.addEventListener('mouseup', () => { pollPainting = false; });
  el.addEventListener('click', (e) => {
    const c = e.target.closest('.cell'); if (!c) return;
    if (pollSuppress) { pollSuppress = false; return; }
    apply(c, c.getAttribute('aria-pressed') !== 'true'); queuePollSave();
  });

  const pre = $('ev-prefill');
  if (pre) pre.addEventListener('click', () => {
    /* Reuse the weekly grid the member already filled in: mark every hour of
       the poll window that their recurring availability already covers. */
    for (const [key, cell] of pollCells) {
      const d = new Date(key);
      if (state.saved.has(d.getUTCDay() * 24 + d.getUTCHours())) apply(cell, true);
    }
    queuePollSave();
  });
}

function queuePollSave() {
  updatePollStatus();
  clearTimeout(pollTimer);
  pollTimer = setTimeout(savePoll, 600);
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
      $('poll-status').textContent = 'Pick your roles above first.';
      state.evMarks = new Set(state.evSavedMarks);
      renderPoll();
      return;
    }
    const { error } = await db.from('raid_event_signups')
      .insert({ event_id: ev.id, member_id: uid, roles });
    if (error) { banner(`Could not sign up: ${esc(error.message)}`, true); return; }
    const { data } = await db.from('raid_event_signups').select('*').eq('event_id', ev.id).order('seq');
    state.evSignups = data || [];
  }

  const add = [...state.evMarks].filter((k) => !state.evSavedMarks.has(k));
  const del = [...state.evSavedMarks].filter((k) => !state.evMarks.has(k));
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
    state.evSavedMarks = new Set(state.evMarks);
    $('poll-status').textContent = `Saved · ${state.evMarks.size} hours`;
  } catch (err) {
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
      $('ev-poll-start').value = localISODate(new Date());
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
    if (mode === 'poll') {
      row.poll_start = $('ev-poll-start').value || localISODate(new Date());
      row.poll_days = Number($('ev-poll-days').value);
      row.status = 'open';
    } else {
      if (!$('ev-when').value) { err.textContent = 'Pick a start time.'; err.hidden = false; return; }
      row.scheduled_at = new Date($('ev-when').value).toISOString();
      row.status = 'scheduled';
    }

    $('ev-save').disabled = true;
    try {
      const { data, error } = await db.from('raid_events').insert(row).select('id').single();
      if (error) throw error;
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
