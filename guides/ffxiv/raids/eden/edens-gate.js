/* BattyDev · Guides — Eden's Gate role picker
   Sibling script to the two Eden's Gate guides, loaded after guide.js. It is
   deliberately not part of guide.js: the pager is generic over every guide in
   the section and this is one guide's widget.

   What it does: the picker sits outside the .phase sections, so guide.js never
   swaps it away and the choice follows you from E1 through to the cheat sheet.
   Picking a role marks the matching row in every .roles block on the page.

   Dimming, not hiding: a main tank still needs to know what the healer is
   doing during Undersea Quake, because that is the mechanic that decides who
   is stranded with whom. The other rows stay legible, just quieter. */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- motion
     The diagrams are animated SVGs embedded with <object>, which makes each one
     a real same-origin document rather than the frozen bitmap <img> would give.
     Two things follow. Each file's own prefers-reduced-motion rules apply, so a
     reader who has asked their system for less motion gets the still frame for
     free. And the documents are reachable from here, which is what lets this
     button exist -- WCAG 2.2.2 wants a way to stop looping motion that does not
     involve going into OS settings.

     Stopping it means injecting one rule into each embedded document rather
     than editing fifteen SVGs, so the files stay plain pictures. */
  var MOTION_KEY = 'battydev.guide.edens-gate.motion';
  var toggle = document.getElementById('motion-toggle');

  function diagrams() {
    return Array.prototype.slice.call(document.querySelectorAll('object.diagram'));
  }

  function setPaused(obj, paused) {
    var doc;
    /* Same-origin, but an embed that has not finished loading answers with the
       placeholder about:blank rather than nothing -- styling that is styling a
       document which is about to be thrown away, which is what made a restored
       "paused" choice silently fail to re-apply on reload. Wait for the SVG. */
    try { doc = obj.contentDocument; } catch (e) { return; }
    var root = doc && doc.documentElement;
    if (!root || String(root.nodeName).toLowerCase() !== 'svg') return;
    var style = doc.getElementById('bd-motion');
    if (!paused) { if (style) style.remove(); return; }
    if (!style) {
      style = doc.createElement('style');
      style.id = 'bd-motion';
      style.textContent = '*{animation-play-state:paused !important}';
      doc.documentElement.appendChild(style);
    }
  }

  function applyMotion(paused) {
    diagrams().forEach(function (o) { setPaused(o, paused); });
    if (toggle) {
      toggle.setAttribute('aria-pressed', paused ? 'true' : 'false');
      var label = toggle.querySelector('span');
      var icon = toggle.querySelector('i');
      if (label) label.textContent = paused ? 'Play diagram animations' : 'Pause diagram animations';
      if (icon) icon.className = paused ? 'bi bi-play-fill' : 'bi bi-pause-fill';
    }
  }

  var paused = false;
  try { paused = localStorage.getItem(MOTION_KEY) === 'paused'; } catch (e) { /* private mode */ }

  if (toggle) {
    toggle.addEventListener('click', function () {
      paused = !paused;
      applyMotion(paused);
      try { localStorage.setItem(MOTION_KEY, paused ? 'paused' : 'playing'); } catch (e) { /* private mode */ }
    });
  }

  /* Embeds load independently of this script: a cold one arrives later and
     fires load, a cached one may already have arrived and fired it before the
     listener existed. Cover both -- listen, apply now, and apply once more when
     the page itself has finished loading. */
  diagrams().forEach(function (o) {
    o.addEventListener('load', function () { setPaused(o, paused); });
  });
  applyMotion(paused);
  window.addEventListener('load', function () { applyMotion(paused); });

  /* ----------------------------------------------------------------- roles */
  var bar = document.querySelector('[data-rolebar]');
  if (!bar) return;

  var buttons = Array.prototype.slice.call(bar.querySelectorAll('button[data-role]'));
  if (!buttons.length) return;

  var roles = document.querySelectorAll('.role[data-role]');
  var key = 'battydev.guide.' + (bar.dataset.rolebar || 'roles');
  var valid = buttons.map(function (b) { return b.dataset.role; });

  function apply(role) {
    var filtered = role !== 'all';
    document.body.classList.toggle('is-filtered', filtered);
    Array.prototype.forEach.call(roles, function (el) {
      el.classList.toggle('is-mine', filtered && el.dataset.role === role);
    });
    buttons.forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.role === role ? 'true' : 'false');
    });
  }

  function choose(role) {
    apply(role);
    try { localStorage.setItem(key, role); } catch (e) { /* private mode */ }
  }

  buttons.forEach(function (b) {
    b.addEventListener('click', function () { choose(b.dataset.role); });
  });

  /* A stored value that is no longer one of the buttons -- the guide was
     edited under a saved choice -- falls back rather than filtering to
     nothing. */
  var start = 'all';
  try {
    var saved = localStorage.getItem(key);
    if (saved && valid.indexOf(saved) >= 0) start = saved;
  } catch (e) { /* private mode */ }

  apply(start);
})();
