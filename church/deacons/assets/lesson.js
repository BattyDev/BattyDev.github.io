/* Deacons quorum lessons — fetch + render + view toggle + deck nav.
 *
 * All lesson content lives in lessons/*.json. This file is the only renderer
 * and knows nothing about any particular Sunday: adding a lesson is a JSON
 * file plus a manifest row, and it must never require a change here.
 *
 * Two views over the same data, chosen by ?view=:
 *   lesson.html?d=2026-09-20              outline, for reading on a phone
 *   lesson.html?d=2026-09-20&view=present deck, for presenting off a TV
 * Both are linkable; the toggle rewrites the URL rather than reloading.
 *
 * Nodes are built with h() rather than innerHTML so curriculum text carrying
 * an ampersand or an angle bracket renders as written.
 */
(function () {
  'use strict';

  /* ---------- tiny DOM helper ---------- */

  function h(tag, props) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (key) {
        if (key === 'class') node.className = props[key];
        else if (key === 'text') node.textContent = props[key];
        else if (key === 'html') node.innerHTML = props[key];
        else if (props[key] != null) node.setAttribute(key, props[key]);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  }

  function append(parent, child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) {
      child.forEach(function (c) { append(parent, c); });
    } else if (typeof child === 'string' || typeof child === 'number') {
      parent.appendChild(document.createTextNode(String(child)));
    } else {
      parent.appendChild(child);
    }
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /* ---------- shared vocabulary ---------- */

  var STATUS = {
    complete: { label: 'Complete', hint: 'Magazine lesson questions and activities are in place.' },
    'guide-draft': { label: 'Guide draft', hint: 'Built from the FSY guide chapter alone — the magazine issue is not published yet.' },
    'awaiting-source': { label: 'Awaiting source', hint: 'Queued. The curriculum pages have not been fetched yet.' }
  };

  var SUNDAY = { fast: 'Fast Sunday', second: 'Second Sunday', third: 'Third Sunday', last: 'Last Sunday' };

  function statusBadge(status) {
    var meta = STATUS[status] || { label: status || 'Unknown', hint: '' };
    return h('span', { class: 'badge badge-' + (status || 'unknown'), title: meta.hint, text: meta.label });
  }

  // Anything the advisor wrote rather than the curriculum is marked, so it is
  // obvious on the page what did and did not come from the material.
  function isAdvisor(obj) {
    return !!(obj && obj.origin === 'advisor');
  }

  function advisorTag(obj) {
    return isAdvisor(obj) ? h('span', { class: 'origin', text: "Advisor's option" }) : null;
  }

  function longDate(iso) {
    var parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!parts) return iso || '';
    // Construct in local time; a UTC-parsed "2026-09-20" renders as the 19th
    // west of Greenwich.
    var d = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
    return d.toLocaleDateString(undefined, {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });
  }

  function mins(n) {
    return n == null ? null : h('span', { class: 'mins', text: n + ' min' });
  }

  // backPocket.extraQuestions entries are bare strings unless they need an
  // origin, in which case they are { text, origin }.
  function textOf(entry) {
    return typeof entry === 'string' ? entry : (entry && entry.text) || '';
  }

  function scriptureLink(s) {
    if (!s) return null;
    if (!s.url) {
      // The renderer never guesses a scripture URL. An unlinked reference is a
      // gap in the data, and says so out loud rather than silently.
      return h('span', { class: 'scripture scripture-unlinked', title: 'No URL in the lesson data', text: s.ref || '' });
    }
    return h('a', { class: 'scripture', href: s.url, rel: 'noopener', target: '_blank', text: s.ref || s.url });
  }

  /* ---------- URL state ---------- */

  function readState() {
    var q = new URLSearchParams(location.search);
    var date = q.get('d') || '';
    return {
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
      present: q.get('view') === 'present'
    };
  }

  function writeState(date, present, push) {
    var url = 'lesson.html?d=' + encodeURIComponent(date) + (present ? '&view=present' : '');
    if (push) history.pushState({ date: date, present: present }, '', url);
    else history.replaceState({ date: date, present: present }, '', url);
  }

  /* ================================================================
     Index — reads the manifest so a new lesson appears without edits
     ================================================================ */

  function initIndex(root) {
    fetch('lessons/manifest.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('manifest.json: HTTP ' + r.status);
        return r.json();
      })
      .then(function (rows) { renderIndex(root, rows); })
      .catch(function (err) { renderError(root, 'Could not load the lesson list.', err); });
  }

  function renderIndex(root, rows) {
    clear(root);
    if (!Array.isArray(rows) || !rows.length) {
      append(root, h('p', { class: 'empty', text: 'No lessons yet.' }));
      return;
    }
    rows = rows.slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });

    var list = h('ol', { class: 'lesson-list' });
    rows.forEach(function (row) {
      var built = row.status !== 'awaiting-source';
      var head = h('div', { class: 'row-head' },
        h('span', { class: 'row-date', text: longDate(row.date) }),
        statusBadge(row.status));
      var body = h('div', { class: 'row-body' },
        h('b', { class: 'row-title', text: row.title || '' }),
        h('span', { class: 'row-meta', text: [
          row.chapter != null ? 'Chapter ' + row.chapter : null,
          SUNDAY[row.sunday] || null
        ].filter(Boolean).join(' · ') }),
        row.truth ? h('span', { class: 'row-truth', text: row.truth }) : null);

      // An awaiting-source row has no JSON to render, so it is not a link.
      var inner = built
        ? h('a', { class: 'row-link', href: 'lesson.html?d=' + encodeURIComponent(row.date) }, head, body)
        : h('div', { class: 'row-link is-pending', 'aria-disabled': 'true' }, head, body);

      append(list, h('li', { class: 'row' + (built ? '' : ' row-pending') }, inner));
    });
    append(root, list);
  }

  /* ================================================================
     Lesson — one data file, two views
     ================================================================ */

  var lesson = null;   // the fetched JSON, rendered by whichever view is up
  var deck = null;     // live deck state while presenting

  function initLesson(root) {
    var state = readState();
    if (!state.date) {
      renderError(root, 'No lesson requested.',
        new Error('Add ?d=YYYY-MM-DD to the URL, or pick a Sunday from the list.'));
      return;
    }
    writeState(state.date, state.present, false);

    fetch('lessons/' + state.date + '.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error(state.date + '.json: HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        lesson = data;
        document.title = (data.title || state.date) + ' · Deacons quorum';
        show(root, readState().present, false);
      })
      .catch(function (err) {
        renderError(root, 'No lesson built for ' + longDate(state.date) + ' yet.', err);
      });

    window.addEventListener('popstate', function () {
      if (lesson) show(root, readState().present, false);
    });
  }

  // The single switch between views. Both render the same `lesson` object.
  function show(root, present, push) {
    teardownDeck();
    if (push) writeState(lesson.date || readState().date, present, true);
    // Both elements: the deck's overscroll rules have to reach the viewport,
    // and Chromium only honours overscroll-behavior there from the root.
    document.documentElement.classList.toggle('presenting', !!present);
    document.body.classList.toggle('presenting', !!present);
    clear(root);
    if (present) renderDeck(root);
    else renderOutline(root);
    window.scrollTo(0, 0);
  }

  function viewToggle(root, present) {
    var btn = h('button', {
      class: 'toggle', type: 'button',
      text: present ? 'Outline' : 'Present'
    });
    btn.addEventListener('click', function () { show(root, !present, true); });
    return btn;
  }

  /* ---------- outline view ---------- */

  function section(num, title, minutes) {
    return h('h2', { class: 'sec' },
      h('span', { class: 'sec-n', text: String(num) }),
      h('span', { class: 'sec-t', text: title }),
      mins(minutes));
  }

  function renderOutline(root) {
    var d = lesson;

    /* header */
    var head = h('header', { class: 'lesson-head' },
      h('div', { class: 'lesson-kicker' },
        h('span', { text: longDate(d.date) }),
        SUNDAY[d.sunday] ? h('span', { text: SUNDAY[d.sunday] }) : null,
        statusBadge(d.status)),
      h('h1', { text: d.title || '' }),
      h('p', { class: 'chapter-line' },
        d.chapter && d.chapter.url
          ? h('a', { href: d.chapter.url, rel: 'noopener', target: '_blank',
                     text: 'For the Strength of Youth, chapter ' + d.chapter.number })
          : h('span', { text: d.chapter ? 'For the Strength of Youth, chapter ' + d.chapter.number : '' }),
        d.minutesTotal ? h('span', { class: 'total', text: d.minutesTotal + ' min planned' }) : null),
      h('div', { class: 'actions' }, viewToggle(root, false)));
    append(root, head);

    if (d.status === 'guide-draft') {
      append(root, h('p', { class: 'notice' },
        'Guide draft. Built from the FSY guide chapter alone — the magazine ',
        'issue is not published yet, so its questions and activities are still to come.'));
    }

    /* 1 — at a glance */
    append(root, h('section', { class: 'block' },
      section(1, 'At a glance'),
      d.atAGlance ? h('p', { class: 'glance', text: d.atAGlance }) : null,
      h('dl', { class: 'pair' },
        h('dt', { text: 'Eternal truth' }), h('dd', { text: d.truth || '' }),
        h('dt', { text: 'Invitation' }), h('dd', { text: d.invitation || '' })),
      d.scriptures && d.scriptures.length
        ? h('p', { class: 'glance-scriptures' },
            h('span', { class: 'label', text: 'Cross-references' }),
            joinNodes(d.scriptures.map(scriptureLink), ' · '))
        : null));

    /* 2 — background */
    if (d.background && d.background.length) {
      append(root, h('section', { class: 'block' },
        section(2, 'What I need to know first'),
        h('ul', { class: 'bullets' }, d.background.map(function (b) {
          return h('li', { class: b.hard ? 'hard' : '' },
            b.hard ? h('span', { class: 'flag', text: 'Hard for an 11-year-old' }) : null,
            b.text || '', ' ', advisorTag(b));
        }))));
    }

    /* 3 — open */
    if (d.open) {
      append(root, h('section', { class: 'block' },
        section(3, 'Open', d.open.minutes),
        h('p', { class: 'hook' }, d.open.hook || '', ' ', advisorTag(d.open)),
        d.open.how ? h('p', { class: 'how', text: d.open.how }) : null,
        d.open.materials && d.open.materials.length
          ? h('p', { class: 'materials' },
              h('span', { class: 'label', text: 'Bring' }), d.open.materials.join(', '))
          : null));
    }

    /* 4 — core discussion */
    if (d.discussion && d.discussion.length) {
      var block = h('section', { class: 'block' },
        section(4, 'Core discussion', sumMinutes(d.discussion)));
      var ol = h('ol', { class: 'questions' });
      d.discussion.forEach(function (q) {
        append(ol, h('li', { class: 'q' },
          h('p', { class: 'q-text' }, q.question || '', ' ', mins(q.minutes), ' ', advisorTag(q)),
          q.scriptures && q.scriptures.length
            ? h('p', { class: 'q-scriptures' }, joinNodes(q.scriptures.map(scriptureLink), ' · '))
            : null,
          q.followUp
            ? h('p', { class: 'q-follow' },
                h('span', { class: 'label', text: 'Follow up' }), q.followUp)
            : null,
          q.hopingFor
            ? h('p', { class: 'q-hope' },
                h('span', { class: 'label', text: 'Hoping for' }), q.hopingFor)
            : null,
          q.activity ? activityCard(q.activity) : null));
      });
      append(block, ol);
      append(root, block);
    }

    /* 5 — invitation */
    if (d.invite) {
      append(root, h('section', { class: 'block' },
        section(5, 'Invitation', d.invite.minutes),
        h('p', { class: 'ask' }, d.invite.ask || '', ' ', advisorTag(d.invite)),
        d.invite.christ
          ? h('p', { class: 'christ' },
              h('span', { class: 'label', text: 'Points to Christ' }), d.invite.christ)
          : null,
        d.invite.blessings && d.invite.blessings.length
          ? h('div', { class: 'blessings' },
              h('p', { class: 'label', text: 'Promised blessings' }),
              h('ul', { class: 'bullets' }, d.invite.blessings.map(function (b) {
                return h('li', { text: b });
              })))
          : null));
    }

    /* 6 — back pocket */
    var bp = d.backPocket;
    if (bp) {
      append(root, h('section', { class: 'block' },
        section(6, 'Back pocket'),
        bp.extraQuestions && bp.extraQuestions.length
          ? h('div', { class: 'pocket' },
              h('p', { class: 'label', text: 'Two more questions' }),
              h('ul', { class: 'bullets' }, bp.extraQuestions.map(function (q) {
                return h('li', {}, textOf(q), ' ', advisorTag(q));
              })))
          : null,
        pocketRow('If discussion dies', bp.ifDiscussionDies),
        pocketRow('If we start late, cut', bp.ifShortOnTime),
        pocketRow('If we finish early', bp.ifTimeLeft),
        bp.hardQuestion
          ? h('div', { class: 'pocket hardq' },
              h('p', { class: 'label', text: 'A sharp deacon might ask' }),
              h('p', { class: 'hardq-q', text: bp.hardQuestion.q || '' }),
              h('p', { class: 'hardq-a', text: bp.hardQuestion.a || '' }))
          : null));
    }

    /* 7 — sources */
    if (d.sources && d.sources.length) {
      append(root, h('section', { class: 'block' },
        section(7, 'Sources'),
        h('ul', { class: 'sources' }, d.sources.map(function (s) {
          return h('li', { class: 'src src-' + (s.kind || 'resource') },
            s.kind ? h('span', { class: 'src-kind', text: s.kind }) : null,
            s.url
              ? h('a', { href: s.url, rel: 'noopener', target: '_blank', text: s.title || s.url })
              : h('span', { text: s.title || '' }),
            s.fetched ? h('span', { class: 'src-meta', text: 'fetched ' + s.fetched }) : null);
        }))));
    }
  }

  function pocketRow(label, value) {
    if (!value) return null;
    return h('div', { class: 'pocket' },
      h('p', { class: 'label', text: label }),
      h('p', { text: value }));
  }

  function activityCard(a) {
    return h('div', { class: 'activity' },
      h('p', { class: 'label' }, 'Activity', ' ', advisorTag(a)),
      a.title ? h('p', { class: 'activity-title', text: a.title }) : null,
      a.instructions ? h('p', { text: a.instructions }) : null,
      a.rows && a.rows.length
        ? h('ul', { class: 'bullets' }, a.rows.map(function (r) { return h('li', { text: r }); }))
        : null);
  }

  function sumMinutes(list) {
    var total = list.reduce(function (acc, q) { return acc + (Number(q.minutes) || 0); }, 0);
    return total || null;
  }

  function joinNodes(nodes, sep) {
    var out = [];
    nodes.forEach(function (n, i) {
      if (i) out.push(sep);
      out.push(n);
    });
    return out;
  }

  /* ---------- present view ---------- */

  // Slides are derived from the same JSON, never authored separately, and are
  // capped so a deck stays presentable rather than becoming a scroll.
  var MAX_SLIDES = 10;

  function buildSlides(d) {
    var head = [];
    var tail = [];

    head.push({ kind: 'title', title: d.title || '', date: longDate(d.date),
                chapter: d.chapter ? 'For the Strength of Youth · Chapter ' + d.chapter.number : '',
                sunday: SUNDAY[d.sunday] || '' });

    if (d.open && d.open.hook) head.push({ kind: 'hook', body: d.open.hook, advisor: isAdvisor(d.open) });

    var scr = firstScripture(d);
    if (scr) head.push({ kind: 'scripture', ref: scr.ref, url: scr.url, body: scr.excerpt || '' });

    var activity = firstActivity(d);
    if (activity) tail.push({ kind: 'activity', title: activity.title || 'Activity',
                              body: activity.instructions || '', rows: activity.rows || [],
                              advisor: isAdvisor(activity) });

    if (d.invite || d.invitation) {
      tail.push({ kind: 'invite', body: (d.invite && d.invite.ask) || d.invitation || '',
                  advisor: isAdvisor(d.invite) });
    }

    // Every lesson lands on Jesus Christ, so the closing slide is not optional.
    tail.push({ kind: 'closing', body: (d.invite && d.invite.christ) || d.truth || '' });

    // Questions take whatever room is left; one question per slide, the
    // question and nothing else.
    var budget = Math.max(0, MAX_SLIDES - head.length - tail.length);
    var questions = (d.discussion || []).filter(function (q) { return q.question; });
    if (questions.length > budget && window.console) {
      console.warn('Deck: ' + questions.length + ' questions but room for ' + budget +
                   '. Showing the first ' + budget + '; the outline has them all.');
    }
    var mid = questions.slice(0, budget).map(function (q) {
      return { kind: 'question', body: q.question, advisor: isAdvisor(q) };
    });

    return head.concat(mid, tail);
  }

  function firstScripture(d) {
    var found = null;
    (d.discussion || []).some(function (q) {
      return (q.scriptures || []).some(function (s) {
        if (s && s.ref) { found = s; return true; }
        return false;
      });
    });
    // A guide draft has no discussion yet, so its scripture slide comes from
    // the chapter's own cross-references.
    if (!found) {
      (d.scriptures || []).some(function (s) {
        if (s && s.ref) { found = s; return true; }
        return false;
      });
    }
    return found;
  }

  function firstActivity(d) {
    var found = null;
    (d.discussion || []).some(function (q) {
      if (q.activity) { found = q.activity; return true; }
      return false;
    });
    return found;
  }

  function renderDeck(root) {
    var slides = buildSlides(lesson);
    var stage = h('div', { class: 'deck', tabindex: '-1', role: 'region', 'aria-label': 'Slides' });

    slides.forEach(function (s, i) {
      append(stage, slideNode(s, i, slides.length));
    });

    var counter = h('p', { class: 'deck-counter', 'aria-live': 'polite' });
    var chrome = h('div', { class: 'deck-chrome' },
      viewToggle(root, true),
      counter);

    append(root, stage);
    append(root, chrome);

    deck = { stage: stage, counter: counter, nodes: Array.prototype.slice.call(stage.children), index: 0 };
    wireDeck(root);
    goto(0);
    stage.focus({ preventScroll: true });
  }

  function slideNode(s, i, total) {
    var body = [];
    switch (s.kind) {
      case 'title':
        body = [
          h('p', { class: 'slide-kicker', text: [s.date, s.sunday].filter(Boolean).join(' · ') }),
          h('h2', { class: 'slide-title', text: s.title }),
          s.chapter ? h('p', { class: 'slide-foot', text: s.chapter }) : null
        ];
        break;
      case 'hook':
        body = [h('p', { class: 'slide-lead', text: s.body })];
        break;
      case 'scripture':
        body = [
          h('p', { class: 'slide-ref', text: s.ref }),
          s.body ? h('p', { class: 'slide-excerpt', text: '“' + s.body + '”' }) : null
        ];
        break;
      case 'question':
        body = [h('p', { class: 'slide-q', text: s.body })];
        break;
      case 'activity':
        body = [
          h('p', { class: 'slide-kicker', text: 'Together' }),
          h('h2', { class: 'slide-title', text: s.title }),
          s.body ? h('p', { class: 'slide-lead', text: s.body }) : null,
          s.rows && s.rows.length
            ? h('ul', { class: 'slide-rows' }, s.rows.map(function (r) { return h('li', { text: r }); }))
            : null
        ];
        break;
      case 'invite':
        body = [
          h('p', { class: 'slide-kicker', text: 'This week' }),
          h('p', { class: 'slide-lead', text: s.body })
        ];
        break;
      case 'closing':
        body = [
          h('p', { class: 'slide-kicker', text: 'Jesus Christ' }),
          h('p', { class: 'slide-lead', text: s.body })
        ];
        break;
    }
    if (s.advisor) body.push(h('p', { class: 'slide-origin', text: "Advisor's option" }));

    return h('section', {
      class: 'slide slide-' + s.kind,
      'aria-hidden': 'true',
      'aria-label': 'Slide ' + (i + 1) + ' of ' + total
    }, h('div', { class: 'slide-inner' }, body));
  }

  function goto(i) {
    if (!deck) return;
    var n = deck.nodes.length;
    // Clamped, so the last slide does not advance into nothing.
    var next = Math.max(0, Math.min(n - 1, i));
    deck.index = next;
    deck.nodes.forEach(function (node, j) {
      var on = j === next;
      node.classList.toggle('is-active', on);
      node.setAttribute('aria-hidden', on ? 'false' : 'true');
    });
    deck.counter.textContent = (next + 1) + ' / ' + n;
  }

  function wireDeck(root) {
    var onKey = function (ev) {
      if (ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      switch (ev.key) {
        case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ': case 'Spacebar':
          ev.preventDefault(); goto(deck.index + 1); break;
        case 'ArrowLeft': case 'ArrowUp': case 'PageUp':
          ev.preventDefault(); goto(deck.index - 1); break;
        case 'Home':
          ev.preventDefault(); goto(0); break;
        case 'End':
          ev.preventDefault(); goto(deck.nodes.length - 1); break;
        case 'Escape':
          ev.preventDefault(); show(root, false, true); break;
      }
    };

    var onClick = function (ev) {
      // Never hijack a tap meant for a link or the Outline button.
      if (ev.target.closest && ev.target.closest('a, button')) return;
      var rect = deck.stage.getBoundingClientRect();
      goto(deck.index + (ev.clientX - rect.left > rect.width / 2 ? 1 : -1));
    };

    var start = null;
    var onTouchStart = function (ev) {
      if (ev.touches.length !== 1) { start = null; return; }
      start = { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
    };
    var onTouchEnd = function (ev) {
      if (!start || !ev.changedTouches.length) return;
      var dx = ev.changedTouches[0].clientX - start.x;
      var dy = ev.changedTouches[0].clientY - start.y;
      start = null;
      // A swipe, not a scroll or a tap: mostly horizontal and far enough.
      if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy)) return;
      ev.preventDefault();
      goto(deck.index + (dx < 0 ? 1 : -1));
    };

    document.addEventListener('keydown', onKey);
    deck.stage.addEventListener('click', onClick);
    deck.stage.addEventListener('touchstart', onTouchStart, { passive: true });
    deck.stage.addEventListener('touchend', onTouchEnd);

    deck.off = function () {
      document.removeEventListener('keydown', onKey);
      deck.stage.removeEventListener('click', onClick);
      deck.stage.removeEventListener('touchstart', onTouchStart);
      deck.stage.removeEventListener('touchend', onTouchEnd);
    };
  }

  function teardownDeck() {
    if (deck && deck.off) deck.off();
    deck = null;
  }

  /* ---------- errors ---------- */

  function renderError(root, headline, err) {
    clear(root);
    append(root, h('div', { class: 'oops' },
      h('h1', { text: headline }),
      h('p', { class: 'oops-detail', text: err ? String(err.message || err) : '' }),
      h('p', {}, h('a', { class: 'back', href: './', text: 'All lessons' }))));
  }

  /* ---------- boot ---------- */

  document.addEventListener('DOMContentLoaded', function () {
    var index = document.getElementById('lesson-index');
    if (index) initIndex(index);
    var view = document.getElementById('view');
    if (view) initLesson(view);
  });
}());
