/* BattyDev · Guides — phase pager
   Generic over any guide page: it reads the phases out of the document rather
   than from a config, so a new guide is a new HTML file and nothing else.

   A guide page provides:
     <div class="rail" id="rail">      empty; the buttons are built here
     <section class="phase" data-label="Phase 1" aria-labelledby="...">
       ...one per phase, in reading order, with an <h1> inside...
     <div class="pager"> with .prev, .next and .count

   Why phases live in the markup instead of being rendered from JSON: the guide
   is prose, and prose in HTML stays readable, diffable and printable. With JS
   off you get every phase stacked in order, which is a worse read but not a
   broken one -- .phase is only hidden once this script marks the page ready. */
(function () {
  'use strict';

  var root = document.querySelector('[data-guide]');
  if (!root) return;

  var phases = Array.prototype.slice.call(root.querySelectorAll('.phase'));
  if (!phases.length) return;

  var rail = document.getElementById('rail');
  var pager = root.querySelector('.pager');
  var prevBtn = pager && pager.querySelector('.prev');
  var nextBtn = pager && pager.querySelector('.next');
  var countEl = pager && pager.querySelector('.count');

  /* Storage key is per-guide so two guides do not fight over one bookmark. */
  var storeKey = 'battydev.guide.' + (root.dataset.guide || 'default');
  var current = -1;
  var seen = {};

  /* Slug for the hash. Prefer an explicit id -- a phase's own id is what any
     link already written into a note points at. */
  function slugOf(section, i) {
    if (section.id) return section.id;
    var id = 'phase-' + i;
    section.id = id;
    return id;
  }

  function labelOf(section, i) {
    if (section.dataset.label) return section.dataset.label;
    var h = section.querySelector('h1');
    return h ? h.textContent.trim() : 'Section ' + (i + 1);
  }

  var slugs = phases.map(slugOf);
  var labels = phases.map(labelOf);

  /* ---- rail ---- */
  var railButtons = [];
  if (rail) {
    phases.forEach(function (section, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = labels[i];
      /* The rail is a set of jump links into one document, so the active one is
         a current step rather than a current page. */
      b.setAttribute('aria-controls', slugs[i]);
      b.addEventListener('click', function () { go(i, true); });
      rail.appendChild(b);
      railButtons.push(b);
    });
  }

  function show(i) {
    phases.forEach(function (section, n) {
      var on = n === i;
      section.classList.toggle('is-active', on);
      /* hidden as well as the class: display:none alone still leaves the
         section in the a11y tree for some assistive tech, and its links
         reachable by Tab. */
      section.hidden = !on;
    });
    railButtons.forEach(function (b, n) {
      b.classList.toggle('is-active', n === i);
      b.classList.toggle('is-seen', !!seen[n]);
      b.setAttribute('aria-current', n === i ? 'step' : 'false');
    });
    if (prevBtn) prevBtn.disabled = i === 0;
    if (nextBtn) nextBtn.disabled = i === phases.length - 1;
    if (countEl) countEl.textContent = (i + 1) + ' / ' + phases.length;

    /* Keep the active rail chip in view -- on a phone the rail scrolls and the
       chip for a late phase would otherwise sit off-screen. */
    var chip = railButtons[i];
    if (chip && chip.scrollIntoView) {
      chip.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    }
  }

  /* focus: move keyboard focus to the new phase's heading. Only on an explicit
     navigation -- on first load there is nothing to move focus away from, and
     stealing it would skip the reader past the header. */
  function go(i, focus) {
    if (i < 0 || i >= phases.length || i === current) return;
    current = i;
    seen[i] = true;
    show(i);

    try { localStorage.setItem(storeKey, slugs[i]); } catch (e) { /* private mode */ }

    /* replaceState, not a hash assignment: stepping through ten phases should
       not bury the previous page under ten history entries, and Back should
       leave the guide rather than walk it backwards. */
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', '#' + slugs[i]);
    }

    /* Always the top, never a scroll to the section. Only one phase is on the
       page at a time, so its heading is the top of the content -- and letting
       the browser's own fragment scroll stand would drop that heading behind
       the sticky home bar on any deep link. preventScroll on the focus below
       is what keeps this from being undone. */
    window.scrollTo({ top: 0, behavior: 'auto' });

    if (focus) {
      var h = phases[i].querySelector('h1');
      if (h) {
        h.setAttribute('tabindex', '-1');
        h.focus({ preventScroll: true });
      }
    }
  }

  if (prevBtn) prevBtn.addEventListener('click', function () { go(current - 1, true); });
  if (nextBtn) nextBtn.addEventListener('click', function () { go(current + 1, true); });

  /* Arrow keys page through, except while typing or when the reader is holding
     a modifier for a browser shortcut. */
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key === 'ArrowRight') { go(current + 1, true); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { go(current - 1, true); e.preventDefault(); }
  });

  /* Someone editing the hash by hand, or following a second link to the same
     page, should land on that phase. replaceState above does not fire this. */
  window.addEventListener('hashchange', function () {
    var i = slugs.indexOf(window.location.hash.slice(1));
    if (i >= 0) go(i, true);
  });

  /* Opening position, in priority order: an explicit hash beats the remembered
     phase, because a link is a deliberate request and the bookmark is not. */
  function initialIndex() {
    var fromHash = slugs.indexOf(window.location.hash.slice(1));
    if (fromHash >= 0) return fromHash;
    try {
      var stored = slugs.indexOf(localStorage.getItem(storeKey) || '');
      if (stored >= 0) return stored;
    } catch (e) { /* private mode */ }
    return 0;
  }

  /* The pager decides the scroll position itself, so the browser restoring the
     previous one on a back/forward or reload only fights it. */
  if (window.history && 'scrollRestoration' in window.history) {
    window.history.scrollRestoration = 'manual';
  }

  /* Flips .phase from "all visible" to "one at a time". Set last so the stacked
     no-JS fallback is what shows if anything above threw. */
  root.classList.add('is-paged');
  go(initialIndex(), false);

  /* The browser applies a fragment's scroll after the parser reaches the target
     and again around load, both of which can land after the go() above. One
     more reset once load has settled makes the deep-link case reliable. */
  window.addEventListener('load', function () { window.scrollTo({ top: 0, behavior: 'auto' }); });
})();
