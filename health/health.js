/* BattyDev · Health
   Reads the BattyHealth Supabase project and renders it as three views.

   On security: this is a static page, so the publishable key below is public by
   necessity — anyone can read it out of the page source. That is fine, and it is
   the point of the RLS setup behind it: every table grants SELECT only to an
   authenticated session whose JWT email matches the owner, so the key on its own
   returns zero rows. The sign-in form is not the lock, it is the key holder. */

'use strict';

const SUPABASE_URL = 'https://uvpaezhtddlanogmnwam.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Y2fH0X0TUepT6fwobaMiUQ_145DCcDw';

/* The gate asks for a PIN alone rather than email + password, so the account is
   named here and the PIN is that account's password. This is only a shortcut
   through the form: the PIN is still checked by Supabase, never by this file, so
   reading it out of the page source gets an attacker no further than knowing the
   email does. Do not be tempted to compare a PIN in JavaScript instead -- that
   would move the check to the client and require reopening anonymous read access
   to the whole database. */
const ACCOUNT_EMAIL = 'codyadcock10@gmail.com';

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (id) => document.getElementById(id);

/* ---------- formatting ---------- */

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const num = (v, digits = 0) =>
  v === null || v === undefined || v === '' ? '—' : Number(v).toFixed(digits).replace(/\.0+$/, '');

/* 'YYYY-MM-DD' parsed by the Date constructor is treated as UTC midnight, which
   renders as the previous day for anyone west of Greenwich. Build it locally. */
function parseDate(s) {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

const fmtDate = (s, opts = { weekday: 'short', month: 'short', day: 'numeric' }) => {
  const d = parseDate(s);
  return d ? d.toLocaleDateString(undefined, opts) : '—';
};

const todayISO = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/* ---------- goal bars ----------
   The targets table mixes directions and getting this wrong inverts the meaning:
   kcal is a ceiling, carbs is a midpoint to sit near, and protein, fat, fibre and
   sodium are floors. Sodium especially — it is a floor for POTS, so falling short
   is the problem, not exceeding it. */
const GOALS = [
  { key: 'kcal',      label: 'Calories', target: 'kcal_ceiling',  dir: 'ceiling', unit: 'kcal', digits: 0 },
  { key: 'protein_g', label: 'Protein',  target: 'protein_floor', dir: 'floor',   unit: 'g',    digits: 0 },
  { key: 'fat_g',     label: 'Fat',      target: 'fat_floor',     dir: 'floor',   unit: 'g',    digits: 0 },
  { key: 'carbs_g',   label: 'Carbs',    target: 'carbs_target',  dir: 'target',  unit: 'g',    digits: 0 },
  { key: 'fiber_g',   label: 'Fibre',    target: 'fiber_target',  dir: 'floor',   unit: 'g',    digits: 0 },
  { key: 'sodium_mg', label: 'Sodium',   target: 'sodium_floor',  dir: 'floor',   unit: 'mg',   digits: 0 },
];

function goalState(value, target, dir) {
  if (!target) return 'is-short';
  const ratio = value / target;
  if (dir === 'ceiling') return ratio > 1 ? 'is-over' : ratio >= 0.9 ? 'is-near' : 'is-good';
  if (dir === 'floor')   return ratio >= 1 ? 'is-good' : ratio >= 0.8 ? 'is-near' : 'is-short';
  /* target: sit near it in either direction */
  const off = Math.abs(ratio - 1);
  return off <= 0.1 ? 'is-good' : off <= 0.25 ? 'is-near' : ratio > 1 ? 'is-over' : 'is-short';
}

const DIR_WORD = { ceiling: 'ceiling', floor: 'floor', target: 'target' };

function renderGoals(el, totals, targets) {
  if (!totals) {
    el.innerHTML = '<p class="empty">Nothing logged yet.</p>';
    return;
  }
  el.innerHTML = GOALS.map((g) => {
    const value = Number(totals[g.key] ?? 0);
    const target = targets ? Number(targets[g.target]) : null;
    const state = goalState(value, target, g.dir);
    const pct = target ? Math.min(100, (value / target) * 100) : 0;
    const targetText = target
      ? `${num(target, g.digits)} ${esc(g.unit)} ${DIR_WORD[g.dir]}`
      : 'no target set';
    return `
      <div>
        <div class="goal-label">
          <b>${esc(g.label)}</b>
          <span>${num(value, g.digits)} ${esc(g.unit)}</span>
          <span class="target">${targetText}</span>
        </div>
        <div class="bar ${state}"><span style="width:${pct.toFixed(1)}%"></span></div>
      </div>`;
  }).join('');
}

/* ---------- nutrition ---------- */

function renderDays(el, totals, entries, targets) {
  if (!totals.length) {
    el.innerHTML = '<p class="empty">No days logged yet.</p>';
    return;
  }
  const byDate = new Map();
  for (const e of entries) {
    if (!byDate.has(e.log_date)) byDate.set(e.log_date, []);
    byDate.get(e.log_date).push(e);
  }

  el.innerHTML = totals.map((t, i) => {
    const items = byDate.get(t.log_date) || [];
    const kcalState = goalState(Number(t.kcal ?? 0), targets && Number(targets.kcal_ceiling), 'ceiling');
    const rows = items.length
      ? `<div class="scroll-x"><table class="items">
           <thead><tr>
             <th>Item</th><th class="num">Serv</th><th class="num">kcal</th>
             <th class="num">P</th><th class="num">F</th><th class="num">C</th>
             <th class="num">Fib</th><th class="num">Na</th>
           </tr></thead>
           <tbody>${items.map((it) => `
             <tr>
               <td>${esc(it.name)}${it.estimated ? ' <span class="est">est</span>' : ''}
                   ${it.note ? `<span class="note">${esc(it.note)}</span>` : ''}</td>
               <td class="num">${num(it.servings, 2)}</td>
               <td class="num">${num(it.kcal)}</td>
               <td class="num">${num(it.protein_g, 1)}</td>
               <td class="num">${num(it.fat_g, 1)}</td>
               <td class="num">${num(it.carbs_g, 1)}</td>
               <td class="num">${num(it.fiber_g, 1)}</td>
               <td class="num">${num(it.sodium_mg)}</td>
             </tr>`).join('')}</tbody>
         </table></div>`
      : '<p class="empty">No items recorded for this day.</p>';

    return `
      <div class="day${i === 0 ? ' is-open' : ''}">
        <button type="button" class="day-head" aria-expanded="${i === 0}">
          <i class="bi bi-chevron-right chev" aria-hidden="true"></i>
          <span class="date">${esc(fmtDate(t.log_date))}</span>
          <span class="macros">
            <b class="${kcalState === 'is-over' ? 'up' : ''}">${num(t.kcal)} kcal</b>
            · ${num(t.protein_g, 1)}p / ${num(t.fat_g, 1)}f / ${num(t.carbs_g, 1)}c
            · ${num(t.fiber_g, 1)} fibre · ${num(t.sodium_mg)} mg Na
          </span>
          <span class="count">${t.item_count} item${Number(t.item_count) === 1 ? '' : 's'}</span>
        </button>
        <div class="day-body"${i === 0 ? '' : ' hidden'}>${rows}</div>
      </div>`;
  }).join('');

  el.querySelectorAll('.day-head').forEach((btn) => {
    btn.addEventListener('click', () => {
      const day = btn.closest('.day');
      const open = day.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', String(open));
      day.querySelector('.day-body').hidden = !open;
    });
  });
}

/* ---------- body ---------- */

function delta(cur, prev, betterWhen) {
  if (cur === null || cur === undefined || prev === null || prev === undefined) return '';
  const d = Number(cur) - Number(prev);
  if (Math.abs(d) < 0.05) return '<span class="d">no change</span>';
  const good = betterWhen === 'down' ? d < 0 : d > 0;
  const arrow = d > 0 ? '▲' : '▼';
  return `<span class="d ${good ? 'down' : 'up'}">${arrow} ${Math.abs(d).toFixed(1)} since last</span>`;
}

function renderInbodyLatest(el, scans) {
  if (!scans.length) {
    el.innerHTML = '<p class="empty">No scans recorded.</p>';
    return;
  }
  const [cur, prev] = scans;
  const cards = [
    { k: 'Weight',      v: num(cur.weight_lbs, 1),   u: 'lb', p: prev && prev.weight_lbs,   c: cur.weight_lbs,   better: 'down' },
    { k: 'Body fat',    v: num(cur.body_fat_pct, 1), u: '%',  p: prev && prev.body_fat_pct, c: cur.body_fat_pct, better: 'down' },
    { k: 'Fat mass',    v: num(cur.body_fat_lbs, 1), u: 'lb', p: prev && prev.body_fat_lbs, c: cur.body_fat_lbs, better: 'down' },
    { k: 'Muscle (SMM)',v: num(cur.smm_lbs, 1),      u: 'lb', p: prev && prev.smm_lbs,      c: cur.smm_lbs,      better: 'up' },
    { k: 'InBody score',v: num(cur.inbody_score),    u: '',   p: prev && prev.inbody_score, c: cur.inbody_score, better: 'up' },
    { k: 'BMR',         v: num(cur.bmr_kcal),        u: 'kcal', p: prev && prev.bmr_kcal,   c: cur.bmr_kcal,     better: 'up' },
  ];
  el.innerHTML = `
    <div class="stat" style="grid-column:1/-1">
      <span class="k">Scan date</span>
      <span class="v">${esc(fmtDate(cur.scan_date, { year: 'numeric', month: 'long', day: 'numeric' }))}</span>
    </div>` + cards.map((c) => `
    <div class="stat">
      <span class="k">${esc(c.k)}</span>
      <span class="v">${c.v}${c.u ? ` <small>${esc(c.u)}</small>` : ''}</span>
      ${delta(c.c, c.p, c.better)}
    </div>`).join('');
}

function table(headers, rows, emptyText) {
  if (!rows.length) return `<p class="empty">${esc(emptyText)}</p>`;
  return `<table class="items">
    <thead><tr>${headers.map((h) => `<th${h.num ? ' class="num"' : ''}>${esc(h.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>`;
}

/* Scan notes run to several hundred characters of instrument detail; show the
   opening and keep the rest in the title attribute rather than blowing up the row. */
function shortNote(note, len = 120) {
  if (!note) return '';
  const s = String(note);
  const cut = s.length > len ? `${s.slice(0, len).trimEnd()}…` : s;
  return `<span class="note" title="${esc(s)}">${esc(cut)}</span>`;
}

/* ---------- boot ---------- */

async function loadAll() {
  const q = (name, builder) => builder.then(({ data, error }) => {
    if (error) throw new Error(`${name}: ${error.message}`);
    return data || [];
  });

  return Promise.all([
    q('daily_totals', db.from('daily_totals').select('*').order('log_date', { ascending: false }).limit(30)),
    q('entries', db.from('entries').select('*').order('log_date', { ascending: false }).order('id', { ascending: true }).limit(500)),
    q('targets', db.from('targets').select('*').order('effective_from', { ascending: false }).limit(1)),
    q('weight_trend', db.from('weight_trend').select('*').order('log_date', { ascending: false }).limit(60)),
    q('inbody', db.from('inbody').select('*').order('scan_date', { ascending: false })),
    q('cardio_estimate', db.from('cardio_estimate').select('*').order('session_date', { ascending: false }).limit(60)),
    q('sessions', db.from('sessions').select('*').order('session_date', { ascending: false }).limit(60)),
    q('progression_status', db.from('progression_status').select('*').order('last_performed', { ascending: false })),
  ]);
}

function renderAll([daily, entries, targetRows, weights, inbody, cardio, sessions, progression]) {
  const targets = targetRows[0] || null;

  /* Today's panel falls back to the most recent logged day, and says so, rather
     than showing an empty card before the first meal of the day is logged. */
  const latest = daily[0] || null;
  const isToday = latest && latest.log_date === todayISO();
  $('today-heading').textContent = isToday ? 'Today' : `Latest logged · ${fmtDate(latest ? latest.log_date : null)}`;
  renderGoals($('today-goals'), latest, targets);
  if (targets && targets.note) {
    $('nutrition-lede').textContent = targets.note;
  }

  renderDays($('days'), daily, entries, targets);

  renderInbodyLatest($('inbody-latest'), inbody);

  $('weights').innerHTML = table(
    [{ label: 'Date' }, { label: 'Weight (lb)', num: true }, { label: '7-day avg', num: true }],
    weights.map((w) => `<tr>
      <td>${esc(fmtDate(w.log_date))}</td>
      <td class="num">${num(w.lbs, 1)}</td>
      <td class="num">${Number(w.days_in_window) > 1 ? num(w.avg_7d, 2) : '—'}</td>
    </tr>`),
    'No weigh-ins logged yet.'
  );

  $('inbody-history').innerHTML = table(
    [{ label: 'Date' }, { label: 'Weight', num: true }, { label: 'BF %', num: true },
     { label: 'Fat lb', num: true }, { label: 'SMM lb', num: true }, { label: 'Score', num: true }, { label: 'Note' }],
    inbody.map((s) => `<tr>
      <td>${esc(fmtDate(s.scan_date))}</td>
      <td class="num">${num(s.weight_lbs, 1)}</td>
      <td class="num">${num(s.body_fat_pct, 1)}</td>
      <td class="num">${num(s.body_fat_lbs, 1)}</td>
      <td class="num">${num(s.smm_lbs, 1)}</td>
      <td class="num">${num(s.inbody_score)}</td>
      <td>${shortNote(s.note)}</td>
    </tr>`),
    'No scans recorded.'
  );

  $('cardio').innerHTML = table(
    [{ label: 'Date' }, { label: 'Modality' }, { label: 'Min', num: true }, { label: 'Console kcal', num: true },
     { label: 'Est. kcal', num: true }, { label: 'Avg HR', num: true }, { label: 'Max HR', num: true }, { label: 'Note' }],
    cardio.map((c) => `<tr>
      <td>${esc(fmtDate(c.session_date))}</td>
      <td>${esc(c.modality)}</td>
      <td class="num">${num(c.duration_min, 1)}</td>
      <td class="num">${num(c.console_kcal)}</td>
      <td class="num">${num(c.est_kcal_gross)}</td>
      <td class="num">${num(c.avg_hr)}</td>
      <td class="num">${num(c.max_hr)}</td>
      <td>${shortNote(c.note, 60)}</td>
    </tr>`),
    'No cardio logged yet.'
  );

  $('sessions').innerHTML = table(
    [{ label: 'Date' }, { label: 'Block' }, { label: 'Min', num: true }, { label: 'Bodyweight', num: true },
     { label: 'Sleep h', num: true }, { label: 'Readiness', num: true }, { label: 'Note' }],
    sessions.map((s) => `<tr>
      <td>${esc(fmtDate(s.session_date))}</td>
      <td>${esc(s.block)}</td>
      <td class="num">${num(s.duration_min)}</td>
      <td class="num">${num(s.bodyweight_lbs, 1)}</td>
      <td class="num">${num(s.sleep_hours, 1)}</td>
      <td class="num">${num(s.readiness)}</td>
      <td>${shortNote(s.note, 80)}</td>
    </tr>`),
    'No sessions logged yet.'
  );

  $('progression').innerHTML = table(
    [{ label: 'Exercise' }, { label: 'Block' }, { label: 'Last done' }, { label: 'Top weight', num: true },
     { label: 'Reps', num: true }, { label: 'Range', num: true }, { label: 'Next' }],
    progression.map((p) => `<tr>
      <td>${esc(p.name)}</td>
      <td>${esc(p.block)}</td>
      <td>${esc(fmtDate(p.last_performed))}</td>
      <td class="num">${num(p.top_weight, 1)}</td>
      <td class="num">${num(p.min_reps)}–${num(p.max_reps)}</td>
      <td class="num">${num(p.rep_low)}–${num(p.rep_high)}</td>
      <td>${p.add_load ? '<b class="down">add load</b>' : 'hold'}</td>
    </tr>`),
    'No working sets logged yet — this fills in once lift sets are recorded.'
  );

  $('updated').textContent = `Loaded ${new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;

  /* A signed-in account that is not the owner passes auth but fails every RLS
     policy, so it would otherwise just see a dashboard of empty panels. */
  const anyData = daily.length || entries.length || weights.length || inbody.length ||
                  cardio.length || sessions.length || progression.length;
  if (!anyData) {
    showBanner('Signed in, but this account has no access to the health data.');
  }
}

function showBanner(msg) {
  const b = $('banner');
  b.textContent = msg;
  b.hidden = false;
}

async function rememberCredential(form) {
  if (!window.PasswordCredential || !navigator.credentials) return;
  try {
    await navigator.credentials.store(new PasswordCredential(form));
  } catch {
    /* Declined, blocked, or an insecure context. The sign-in already
       succeeded, so this is never worth interrupting the user over. */
  }
}

async function boot() {
  $('gate').hidden = true;
  $('app').hidden = false;
  try {
    renderAll(await loadAll());
  } catch (err) {
    showBanner(`Could not load data — ${err.message}`);
  }
}

/* view switcher: mirrors /ffxiv so the two pages behave identically */
document.querySelectorAll('.system-icons button').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.viewTarget;
    document.querySelectorAll('.system-icons button').forEach((b) => {
      const on = b === btn;
      b.classList.toggle('is-active', on);
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    document.querySelectorAll('.view').forEach((v) => {
      const on = v.id === `view-${target}`;
      v.classList.toggle('is-active', on);
      v.hidden = !on;
    });
  });
});

$('login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const button = $('login-button');
  const errorEl = $('login-error');
  errorEl.textContent = '';
  button.disabled = true;
  button.textContent = 'Unlocking…';

  const { error } = await db.auth.signInWithPassword({
    email: ACCOUNT_EMAIL,
    password: $('pin').value,
  });

  /* This form signs in over XHR and never navigates, so Chrome's save-password
     heuristic -- which keys off a submit that unloads the page -- never fires.
     Asking outright is the supported way to get the credential stored, and is
     what makes autofill work on the next visit. Chromium-only; Firefox and
     Safari fall back to their own heuristics, helped by the username field. */
  if (!error) await rememberCredential(ev.target);

  button.disabled = false;
  button.textContent = 'Unlock';

  if (error) {
    /* Supabase says "Invalid login credentials" for a wrong password, which is
       confusing when the form only ever collected a PIN. */
    errorEl.textContent = /invalid login/i.test(error.message)
      ? 'Incorrect PIN.'
      : error.message;
    $('pin').value = '';
    $('pin').focus();
    return;
  }
  boot();
});

$('signout').addEventListener('click', async () => {
  await db.auth.signOut();
  /* Without this the browser may silently hand the credential straight back,
     so "sign out" would bounce into a signed-in page. */
  if (navigator.credentials && navigator.credentials.preventSilentAccess) {
    await navigator.credentials.preventSilentAccess();
  }
  location.reload();
});

/* ACCOUNT_EMAIL stays the single source of truth; the markup only carries a copy
   so credential managers see a username before this file runs. */
$('account').value = ACCOUNT_EMAIL;

/* supabase-js persists the session in localStorage, so a return visit skips the form. */
db.auth.getSession().then(({ data }) => {
  if (data.session) boot();
});
