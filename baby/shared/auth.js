/* BattyDev · Baby — sign-in, and helpers every /baby page shares
   Usage on a page:  BB.unlock((data) => render(data));

   On security: the data lives in baby_ tables on the battydevsite Supabase
   project, and Postgres decides who reads it: RLS admits only user ids on
   public.baby_members, and nothing is writable from a browser at all. The
   sign-in screen here is not the lock; a stranger who skips it, or signs in
   with their own account, gets an error back from the database.

   The repository is public, so never add a real date (above all the due
   date), a service-role key, or a copy of the data to anything under /baby.
   See baby/AGENTS.md. */

'use strict';

const BB = (() => {
  const DAY = 86400000;
  const TERM_DAYS = 280; // due date = first day of last period + 40 weeks

  const $ = (id) => document.getElementById(id);

  /* ---------- formatting ---------- */

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  /* 'YYYY-MM-DD' parsed by Date is UTC midnight, which renders as the previous
     day west of Greenwich. Build it locally. Anything unparseable is null. */
  function parseDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  }

  function today() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  /* Rounded, so a DST change (a 23- or 25-hour day) still counts as one day. */
  const daysBetween = (a, b) => Math.round((b - a) / DAY);

  const fmtDate = (d, opts = { month: 'short', day: 'numeric' }) =>
    d ? d.toLocaleDateString(undefined, opts) : '—';
  const fmtLong = (d) => fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const weeksDays = (days) => `${Math.floor(days / 7)}w ${days % 7}d`;

  const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const usd = (n) => money.format(Math.round(Number(n) || 0));

  /* ---------- pregnancy maths ---------- */

  const trimesterOf = (week) => (week < 14 ? 1 : week < 28 ? 2 : 3);
  const TRI_NAME = { 1: 'First trimester', 2: 'Second trimester', 3: 'Third trimester' };

  /* Everything date-related is derived from the due date alone, so it is the
     only date the data file has to carry. Null when it is missing or invalid. */
  function pregnancy(dueStr) {
    const due = parseDate(dueStr);
    if (!due) return null;
    const lmp = addDays(due, -TERM_DAYS);
    const now = today();
    const elapsed = daysBetween(lmp, now);
    const week = Math.floor(elapsed / 7);
    return {
      due, lmp, now, elapsed, week,
      day: ((elapsed % 7) + 7) % 7,
      left: daysBetween(now, due),
      pct: Math.max(0, Math.min(1, elapsed / TERM_DAYS)),
      tri: trimesterOf(week),
      /* First day of a gestational week, and the week a date falls in. */
      weekStart: (w) => addDays(lmp, w * 7),
      weekOf: (d) => Math.floor(daysBetween(lmp, d) / 7),
    };
  }

  /* ---------- sign-in ---------- */

  /* Both public by design (the same pair /fcevents uses): the URL is an
     endpoint and the publishable key grants only what RLS allows. For the
     baby_ tables that is nothing at all unless the signed-in user id is on
     public.baby_members. See baby/sql/001_baby_schema.sql. Never put a
     service-role key here. */
  const SUPABASE_URL = 'https://bbqauqqymjxqcyurxmna.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_0wB8tbr7yclMFE3uXqJblg_-etHxkiL';
  const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  /* Same arrangement as /health: the gate asks for a PIN alone, so the
     account is named here and the PIN is that account's password. This is
     only a shortcut through the form. The PIN is still checked by Supabase,
     never by this file, so reading it out of the page source gets an attacker
     no further than knowing the email does. Do not be tempted to compare a
     PIN in JavaScript instead: that would move the check to the client and
     mean opening the tables to anonymous reads. */
  const ACCOUNT_EMAIL = 'codyadcock10@gmail.com';

  function gateHTML(state, who) {
    if (state === 'denied') {
      return `
        <div class="gate-card">
          <h2>Baby</h2>
          <p>Signed in as <b>${esc(who || 'this account')}</b>, but it isn't on the list for this page.</p>
          <button type="button" id="gate-signout">Sign out</button>
        </div>`;
    }
    /* Password managers key a credential to an identity, so a lone password
       field gives them nothing to match on. The visually hidden username
       supplies it; display:none or type=hidden would be skipped. */
    return `
      <form id="login-form" class="gate-card" autocomplete="on">
        <h2>Baby</h2>
        <p>Enter your PIN to view this page.</p>
        <label for="account" class="visually-hidden">Account</label>
        <input type="email" id="account" name="username" autocomplete="username"
               value="${esc(ACCOUNT_EMAIL)}" readonly tabindex="-1" class="visually-hidden">
        <label for="pin">PIN</label>
        <input type="password" id="pin" name="password" autocomplete="current-password"
               enterkeyhint="go" required autofocus>
        <p class="err" id="login-error" role="alert"></p>
        <button type="submit" id="login-button">Unlock</button>
      </form>`;
  }

  /* This form signs in over XHR and never navigates, so Chrome's save-password
     heuristic never fires. Asking outright is what gets the credential stored
     and autofilled next time. Chromium-only; others use their own heuristics. */
  async function rememberCredential(form) {
    if (!window.PasswordCredential || !navigator.credentials) return;
    try {
      await navigator.credentials.store(new PasswordCredential(form));
    } catch {
      /* Declined, blocked, or an insecure context. Never worth interrupting over. */
    }
  }

  function showGate(state, who, onData) {
    let gate = $('gate');
    if (!gate) {
      gate = document.createElement('div');
      gate.className = 'gate';
      gate.id = 'gate';
      document.body.prepend(gate);
    }
    gate.innerHTML = gateHTML(state, who);
    const app = $('app');
    if (app) app.hidden = true;

    if (state === 'denied') {
      $('gate-signout').addEventListener('click', lock);
      return;
    }
    $('pin').focus();
    $('login-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const button = $('login-button');
      const errorEl = $('login-error');
      errorEl.textContent = '';
      button.disabled = true;
      button.textContent = 'Unlocking…';

      const { data, error } = await db.auth.signInWithPassword({
        email: ACCOUNT_EMAIL,
        password: $('pin').value,
      });
      if (!error) await rememberCredential(ev.target);

      button.disabled = false;
      button.textContent = 'Unlock';
      if (error) {
        /* Supabase says "Invalid login credentials" for a wrong password,
           which reads oddly when the form only asked for a PIN. */
        errorEl.textContent = /invalid login/i.test(error.message) ? 'Incorrect PIN.' : error.message;
        $('pin').value = '';
        $('pin').focus();
        return;
      }
      load(data.session, onData);
    });
  }

  let loaded = false;

  /* The whole section is one RPC: baby_snapshot() returns the document the
     pages render, or raises 42501 for an account that is not on the list. */
  async function load(session, onData) {
    if (loaded) return;
    const { data, error } = await db.rpc('baby_snapshot');
    if (error) {
      if (error.code === '42501') showGate('denied', session.user.email);
      else banner(`Could not load — ${error.message}`);
      return;
    }
    loaded = true;
    const gate = $('gate');
    if (gate) gate.remove();
    const app = $('app');
    if (app) app.hidden = false;
    try {
      onData(data);
    } catch (err) {
      banner(`Could not render — ${err.message}`);
      throw err;
    }
  }

  /* supabase-js keeps the session in localStorage, so a return visit (or a
     hop between /baby pages) goes straight through, as on /health. It is the
     same project as /fcevents, so a session from there counts here too, and
     signing out here signs out there. */
  async function unlock(onData) {
    const { data } = await db.auth.getSession();
    if (data.session) await load(data.session, onData);
    else showGate('signin', null, onData);
  }

  async function lock() {
    await db.auth.signOut();
    /* Without this the browser may hand the credential straight back, so
       "sign out" would bounce into a signed-in page. Capped, because in some
       browsers the promise never settles and signing out must not hang. */
    if (navigator.credentials && navigator.credentials.preventSilentAccess) {
      await Promise.race([
        navigator.credentials.preventSilentAccess().catch(() => {}),
        new Promise((done) => setTimeout(done, 500)),
      ]);
    }
    location.reload();
  }

  function banner(msg) {
    const b = $('banner');
    if (!b) return;
    b.textContent = msg;
    b.hidden = false;
    const app = $('app');
    if (app) app.hidden = false;
  }

  /* ---------- page chrome ---------- */

  /* Header icon buttons switch views, as on /health, plus the hash so a view
     can be linked to and survives a reload (/baby/savings/#history). */
  function views() {
    const buttons = [...document.querySelectorAll('.system-icons button[data-view-target]')];
    const show = (target, push) => {
      if (!buttons.some((b) => b.dataset.viewTarget === target)) target = buttons[0].dataset.viewTarget;
      for (const b of buttons) {
        const on = b.dataset.viewTarget === target;
        b.classList.toggle('is-active', on);
        if (on) b.setAttribute('aria-current', 'page');
        else b.removeAttribute('aria-current');
      }
      document.querySelectorAll('.view').forEach((v) => {
        const on = v.id === `view-${target}`;
        v.classList.toggle('is-active', on);
        v.hidden = !on;
      });
      if (push) history.replaceState(null, '', `#${target}`);
      document.dispatchEvent(new CustomEvent('bb:view', { detail: target }));
    };
    buttons.forEach((b) => b.addEventListener('click', () => show(b.dataset.viewTarget, true)));
    window.addEventListener('hashchange', () => show(location.hash.slice(1), false));
    show(location.hash.slice(1), false);
    return show;
  }

  function chrome(data) {
    const lockBtn = $('lock');
    if (lockBtn) lockBtn.addEventListener('click', lock);
    const sample = $('sample');
    if (sample) sample.hidden = !data.sample;
    const stamp = $('updated');
    /* A timestamp from the database, shown as a local date. */
    if (stamp && data.updated) stamp.textContent = `Updated ${fmtDate(new Date(data.updated))}`;
  }

  return {
    $, esc, parseDate, today, addDays, daysBetween, fmtDate, fmtLong, plural, weeksDays, usd,
    pregnancy, trimesterOf, TRI_NAME, unlock, lock, views, chrome, banner,
  };
})();
