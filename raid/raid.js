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
  b.addEventListener('click', () => showView(b.dataset.viewTarget));
}

/* Reflects auth state into the chrome. The tabs it reveals are conveniences --
   see the header note; none of them is what keeps a member out of the leader
   data. */
function syncChrome() {
  const signedIn = Boolean(state.session);
  document.querySelector('[data-needs="member"]').hidden = !signedIn;
  document.querySelector('[data-needs="leader"]').hidden = !isLeader();

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
  const { data } = await db.auth.getSession();
  await onSession(data?.session ?? null);
}

main();
