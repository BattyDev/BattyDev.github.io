/* BattyDev · Baby — the lock, and helpers every /baby page shares
   Usage on a page:  BB.unlock((data) => render(data));

   On security: there is no backend, so there is nothing to check a passphrase
   against and no way to keep a file private on GitHub Pages (this repository is
   public). Instead the data ships encrypted (../data.enc.json, written by
   ../tools/seal.mjs) and the passphrase derives the AES key that decrypts it,
   in the browser. A wrong passphrase does not "fail a check"; it produces a key
   that cannot open the file.

   Never add a plaintext copy of the data, a hard-coded passphrase, or a real
   date to anything under /baby. All three would be public the moment they were
   pushed. See baby/AGENTS.md. */

'use strict';

const BB = (() => {
  const DAY = 86400000;
  const TERM_DAYS = 280; // due date = first day of last period + 40 weeks
  const KEY_STORE = 'battydev.baby.key';
  /* Resolved against this script, so every page finds the one data file. */
  const DATA_URL = new URL('../data.enc.json', document.currentScript.src).href;

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

  /* ---------- crypto ---------- */

  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

  /* Must match tools/seal.mjs exactly. Extractable only so the key (never the
     passphrase) can be kept for the session or on this device. */
  async function deriveKey(passphrase, env) {
    const base = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: unb64(env.salt), iterations: env.iter },
      base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
  }

  /* Throws on a wrong key: the GCM tag will not verify. */
  async function decrypt(env, key) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  let envPromise = null;
  function loadEnvelope() {
    envPromise = envPromise || fetch(DATA_URL, { cache: 'no-cache' }).then((res) => {
      if (!res.ok) throw new Error(`could not fetch the data file (${res.status})`);
      return res.json();
    });
    return envPromise;
  }

  /* "Keep unlocked" puts the key in localStorage; otherwise sessionStorage, so
     moving between /baby pages does not re-prompt but closing the tab locks.
     Either can throw (private mode, blocked storage); the page still works. */
  const stores = () => [window.localStorage, window.sessionStorage];
  const storedKey = () => {
    for (const s of stores()) {
      try { const v = s.getItem(KEY_STORE); if (v) return v; } catch { /* unavailable */ }
    }
    return null;
  };
  const saveKey = (raw, persist) => {
    try { (persist ? localStorage : sessionStorage).setItem(KEY_STORE, raw); } catch { /* unlocked anyway */ }
  };
  const forgetKey = () => {
    for (const s of stores()) { try { s.removeItem(KEY_STORE); } catch { /* nothing to clear */ } }
  };

  /* ---------- the gate ---------- */

  function gateHTML() {
    /* The hidden username gives password managers something to file the
       passphrase under. It must differ from /health's (same origin), or the
       two saved credentials would overwrite each other. */
    return `
      <form id="login-form" autocomplete="on">
        <h2>Baby</h2>
        <p>Enter the passphrase to unlock.</p>
        <label for="account" class="visually-hidden">Account</label>
        <input type="text" id="account" name="username" autocomplete="username"
               value="baby" readonly tabindex="-1" class="visually-hidden">
        <label for="pin">Passphrase</label>
        <input type="password" id="pin" name="password" autocomplete="current-password"
               enterkeyhint="go" required autofocus>
        <label class="remember"><input type="checkbox" id="remember" checked> Keep unlocked on this device</label>
        <p class="err" id="login-error" role="alert"></p>
        <button type="submit" id="login-button">Unlock</button>
      </form>`;
  }

  function showGate(onData) {
    const gate = document.createElement('div');
    gate.className = 'gate';
    gate.id = 'gate';
    gate.innerHTML = gateHTML();
    document.body.prepend(gate);
    $('pin').focus();

    $('login-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const button = $('login-button');
      const errorEl = $('login-error');
      errorEl.textContent = '';
      button.disabled = true;
      button.textContent = 'Unlocking…';

      let data = null;
      try {
        const env = await loadEnvelope();
        const key = await deriveKey($('pin').value, env);
        try { data = await decrypt(env, key); } catch { errorEl.textContent = 'Incorrect passphrase.'; }
        if (data) {
          saveKey(b64(await crypto.subtle.exportKey('raw', key)), $('remember').checked);
          if (window.PasswordCredential && navigator.credentials) {
            try { await navigator.credentials.store(new PasswordCredential(ev.target)); } catch { /* declined */ }
          }
        }
      } catch (err) {
        errorEl.textContent = `Could not unlock — ${err.message}`;
      }

      button.disabled = false;
      button.textContent = 'Unlock';
      if (!data) {
        $('pin').value = '';
        $('pin').focus();
        return;
      }
      gate.remove();
      onData(data);
    });
  }

  /* Opens with a kept key if there is one that still fits; if the passphrase
     has changed since, the key is forgotten and the form shown instead. */
  async function unlock(onData) {
    const show = (data) => {
      const app = $('app');
      if (app) app.hidden = false;
      try {
        onData(data);
      } catch (err) {
        banner(`Could not render — ${err.message}`);
        throw err;
      }
    };
    const raw = storedKey();
    if (raw) {
      try {
        const key = await crypto.subtle.importKey('raw', unb64(raw), 'AES-GCM', true, ['decrypt']);
        show(await decrypt(await loadEnvelope(), key));
        return;
      } catch {
        forgetKey();
      }
    }
    showGate(show);
  }

  async function lock() {
    forgetKey();
    /* Capped: in some browsers this never settles, and locking must not hang. */
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
    if (stamp && data.updated) stamp.textContent = `Updated ${fmtDate(parseDate(data.updated))}`;
  }

  return {
    $, esc, parseDate, today, addDays, daysBetween, fmtDate, fmtLong, plural, weeksDays, usd,
    pregnancy, trimesterOf, TRI_NAME, unlock, lock, views, chrome, banner,
  };
})();
