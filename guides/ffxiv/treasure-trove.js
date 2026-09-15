/* Moogle Treasure Trove — the live parts of the guide.

   Everything here is specific to this one event, which is why it sits beside
   the guide rather than in guide.js: the pager is generic, this is not. It
   runs after guide.js and touches nothing the pager owns.

   All state is per-browser via localStorage. There is no account behind this
   page, and the tracker is a convenience rather than a record -- treat a lost
   value as a shrug, not a bug. Every access is wrapped because Safari's
   private mode throws on write rather than failing quietly. */
(function () {
  'use strict';

  var KEY = 'battydev.trove.';
  var store = {
    get: function (k, d) {
      try { var v = localStorage.getItem(KEY + k); return v === null ? d : JSON.parse(v); }
      catch (e) { return d; }
    },
    set: function (k, v) {
      try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (e) { /* private mode */ }
    }
  };

  /* ---- countdown ----
     The event ends 2026-10-19 07:59 PDT, which is 14:59 UTC. Pinning the UTC
     instant rather than a local one keeps it correct wherever it is read. */
  var END = Date.UTC(2026, 9, 19, 14, 59);
  var cd = document.getElementById('countdown');
  if (cd) {
    var days = Math.ceil((END - Date.now()) / 86400000);
    cd.textContent = days > 1 ? days + ' days left'
                   : days === 1 ? 'Last day'
                   : 'Event ended';
  }

  /* ---- token poms ----
     Ten: six Minimog (one per week) then the Ultimog's five, of which only
     four fit the ten-token total -- the tenth pom stands in for the last of
     them. They are drawn locked because Aloalo needs Endwalker, so ticking one
     now would be recording something you cannot have done. */
  var MINIMOGS = 6;
  var earned = store.get('tokens', []);
  var poms = document.getElementById('poms');
  var tcount = document.getElementById('tcount');

  if (poms && tcount) {
    for (var i = 0; i < 10; i++) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pom' + (i >= MINIMOGS ? ' locked' : '');
      b.setAttribute('aria-label', i < MINIMOGS
        ? 'Minimog token, week ' + (i + 1)
        : 'Ultimog token ' + (i - MINIMOGS + 1) + ' (needs Endwalker)');
      b.setAttribute('aria-pressed', earned.indexOf(i) > -1 ? 'true' : 'false');
      b.dataset.i = i;
      b.appendChild(document.createElement('i'));
      b.addEventListener('click', onPom);
      poms.appendChild(b);
    }
  }

  function onPom() {
    var n = Number(this.dataset.i);
    var on = this.getAttribute('aria-pressed') !== 'true';
    this.setAttribute('aria-pressed', String(on));
    earned = earned.filter(function (x) { return x !== n; });
    if (on) earned.push(n);
    store.set('tokens', earned);
    render();
  }

  /* ---- tomestone counter ----
     Steps of 5 because the smallest thing worth logging is a Hidden Gorge win.
     Clamped at zero so a stray −5 cannot leave a negative total on screen. */
  var tomes = store.get('tomes', 0);
  var tEl = document.getElementById('tomes');
  var plus = document.getElementById('plus');
  var minus = document.getElementById('minus');

  function bump(d) {
    tomes = Math.max(0, tomes + d);
    store.set('tomes', tomes);
    render();
  }
  if (plus) plus.addEventListener('click', function () { bump(5); });
  if (minus) minus.addEventListener('click', function () { bump(-5); });

  function render() {
    if (tcount) tcount.textContent = earned.length;
    if (tEl) tEl.textContent = tomes;
  }
  render();

  /* ---- this week ----
     Marks whichever week card contains "now" rather than hardcoding one, so the
     page stays right without an edit every Tuesday. Weeks turn over at 08:00
     UTC (1:00 a.m. PDT), matching the game's weekly reset. */
  var now = new Date();
  var weeks = document.querySelectorAll('.week');
  for (var w = 0; w < weeks.length; w++) {
    var el = weeks[w];
    var start = new Date(el.dataset.start + 'T08:00:00Z');
    var end = new Date(el.dataset.end + 'T08:00:00Z');
    if (now >= start && now < end) {
      el.classList.add('now');
      var badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'This week';
      el.querySelector('header').appendChild(badge);
    }
  }

  /* ---- weekly routine ----
     Stored against the week it belongs to, so the boxes come back cleared on
     the next reset instead of showing last week's work as done. No timer: the
     check happens whenever the page is opened, which is the only moment it
     matters. */
  function weekKey(d) {
    var t = new Date(d.getTime() - 8 * 3600000);   // shift so the day flips at 08:00 UTC
    var since = (t.getUTCDay() + 5) % 7;           // days since Tuesday
    t.setUTCDate(t.getUTCDate() - since);
    return t.toISOString().slice(0, 10);
  }

  var wk = weekKey(now);
  var saved = store.get('routine', {});
  if (saved.week !== wk) saved = { week: wk, done: {} };

  var boxes = document.querySelectorAll('#routine-list input');
  for (var c = 0; c < boxes.length; c++) {
    boxes[c].checked = !!saved.done[boxes[c].id];
    boxes[c].addEventListener('change', function () {
      saved.done[this.id] = this.checked;
      store.set('routine', saved);
    });
  }
})();
