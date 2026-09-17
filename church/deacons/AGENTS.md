# AGENTS.md — /church/deacons

Scope: **this directory only.** A self-contained section of a static personal
site. It shares no code with `guides/`, `fcevents/` or the game dashboards —
only the palette, which it copies rather than imports.

## What it is

Sunday lesson plans for the deacons quorum I advise, at
`battydev.com/church/deacons`. Each lesson is a scannable outline to read off a
phone mid-lesson, plus a full-screen deck derived from the same data to present
from.

```
church/
  index.html                        /church                  hub
  deacons/
    index.html                      /church/deacons          lesson list
    lesson.html                     renders ONE lesson, both views
    AGENTS.md                       this file
    lessons/
      README.md                     the JSON schema — read it before editing data
      manifest.json                 one row per Sunday
      2026-09-20.json               all content for that Sunday
    assets/
      lesson.css                    outline view + the shell both pages share
      deck.css                      present view
      lesson.js                     fetch + render + view toggle + deck nav
    _sources/                       raw fetched curriculum text, for provenance
```

Hidden, not private. `noindex, nofollow` on every page and **deliberately not
linked from the landing page** — the section above it, `/guides`, is linked;
this one is reachable only if you know the URL. There is no gate and nothing
secret behind it. Don't add a login.

No build step. Vanilla HTML, two stylesheets, one script.

## The one architectural rule

**Lesson content lives in `lessons/*.json` and nowhere else.** `lesson.html`
plus `lesson.js` is the only renderer.

- Adding a Sunday = one JSON file + one manifest row. **Never** an HTML or JS
  change.
- Changing how lessons look = CSS only. **Never** regenerating content.
- `index.html` reads `manifest.json`, so a new lesson appears on the list by
  itself.

This is the opposite of `guides/AGENTS.md`, which says to write prose in HTML
rather than a JSON blob. That is the right call there and the wrong one here:
this section will grow to twelve months of lessons on one repeating structure,
and the same paragraphs must not be re-emitted across files every time the
design changes. The tradeoff accepted in exchange: these pages need script to
render, where a guide does not.

If a lesson needs a field the schema lacks, add it to `lessons/README.md` in the
same commit. Don't invent field names per lesson.

## The curriculum

Since September 6, 2026, Aaronic Priesthood quorums teach from **For the
Strength of Youth: A Guide for Making Choices** — twelve chapters, the chapter
number matching the calendar month — with the weekly lesson pages in the **For
the Strength of Youth magazine**. The magazine lesson page is the curriculum;
its questions and activities are the spine of a lesson. The guide chapter
supplies the doctrine behind them.

Sunday School uses *Come, Follow Me*. That is a different class. **No
*Come, Follow Me* material here.**

### Fetch rules

- **Never construct a lesson URL.** Load the issue contents page and follow the
  links under "FSY Sunday Lessons." The paths are not consistent between
  months — in the October 2026 issue, October's lessons sit under
  `/2026/10/fsy-lessons/…` while November's sit under `/2026/10/…` with no
  `fsy-lessons` segment. A guessed slug fetches the wrong month or nothing.
- **Confirm the edition.** Some 2022-edition guide chapters still resolve under
  the same `/manual/for-the-strength-of-youth/` path. The 2026 chapter 9 title
  reads "9. You are blessed by priesthood keys and authority." If the title
  doesn't match, stop and say so.
- Follow the cross-references the lesson pages themselves link to — Guide to
  the Scriptures, Preach My Gospel, Gospel Topics, general conference talks —
  rather than substituting other sources.
- On a last Sunday, use the **Aaronic Priesthood** version of the lesson, never
  the Young Women version.
- **Never fabricate a quotation.** Anything attributed to a talk, a prophet or a
  Church resource must appear on a page listed in that lesson's `sources[]`.
  Quote under 15 words; paraphrase the rest.
- Scripture citations in standard Latter-day Saint format. Old Testament
  passages use the King James Version as published in the LDS edition.
- **If a fetch fails, stop and report it.** Do not improvise from general
  knowledge of the topic. A lesson built from memory is worse than no lesson.
- Cache every page fetched into `_sources/YYYY-MM/<slug>.md` and point the
  lesson's `sources[].cached` at it, so a rebuild doesn't refetch and it stays
  possible to see exactly what a lesson was built from.

### Lesson design

- **One eternal truth and one invitation per Sunday.** Not a survey of the
  chapter. Fewer, deeper — never stretch to two truths to fill slides.
- Discussion over lecture. Questions with more than one defensible answer.
  Nothing that reads like a quiz, nothing condescending, and never a question
  that could put a quiet kid on the spot in an embarrassing way.
- Terse bullets to scan on a phone, not paragraphs.
- Quorum meeting is 25 minutes and the presidency may need some of it for
  quorum business, so plan **20–22 minutes**. Per-section minutes and the total
  both render on the page.
- The audience is 6–8 young men, ages 11–13. Flag what will confuse an
  11-year-old with `"hard": true`; don't skip it.
- Where the lesson gives a chart or a find-it-in-the-verse task, keep it. This
  age needs something to do with their hands.
- Every lesson lands on Jesus Christ — that's `invite.christ`, and it is the
  closing slide.
- **Mark your own work.** Anything you came up with — an object lesson, a hook,
  an extra question — gets `"origin": "advisor"` so the page renders it
  `Advisor's option`. It has to be obvious what came from the curriculum and
  what came from an agent.

## The two states

A badge on the index and the lesson page, from `status`:

- **`complete`** — the magazine lesson page exists; its questions and
  activities are in place.
- **`guide-draft`** — built from the FSY guide chapter alone, because that
  month's magazine isn't published yet. Chapter, eternal truth, invitation,
  promised blessings and the chapter's own scripture cross-references (the
  top-level `scriptures[]`) only. **No invented discussion questions** — the
  page says plainly that the magazine's questions are still to come.
- **`awaiting-source`** — queued, nothing built, no JSON file needed. The index
  shows the row greyed and unclickable.

## A regeneration run

1. Read the magazine index at
   `https://www.churchofjesuschrist.org/study/magazines/for-the-strength-of-youth?lang=eng`
   to see which issues exist.
2. Upgrade any `guide-draft` whose magazine lessons have since published.
3. **Leave `complete` lessons untouched** unless told otherwise.
4. Cache what you fetched into `_sources/`.
5. Report what changed.

## The present view

Slides are derived from the JSON by `buildSlides()` in `lesson.js`, never
authored separately. Order: title → `open.hook` → scripture → one slide per
`discussion[].question` (the question and nothing else) → the activity or chart
→ `invitation` → a closing slide pointing to Jesus Christ.

**Capped at 10 slides.** The fixed slides are built first and questions take
whatever room is left; if a lesson has more questions than fit, the extras are
dropped from the deck — never from the outline — and a `console.warn` says so.
A lesson with more than about five questions is a lesson doing too much.

`Esc` returns to the outline. Arrow keys, space, PageUp/Down, Home/End, a click
on either half and a horizontal swipe all navigate. Both ends clamp.

Note `overscroll-behavior` in `deck.css`: without it a right-swipe on a phone
chains to the viewport and Chromium runs its history-back gesture, dropping you
out of the deck mid-lesson. This shipped broken once. Don't remove it.

## Conventions

- Bump the `?v=` on `lesson.css`, `deck.css` and `lesson.js` in **every** page
  of the section whenever any of them changes. GitHub Pages caches aggressively
  and a half-updated section looks like a CSS bug.
- Relative links throughout, so the folder can be dropped anywhere on the site.
- Fonts and Bootstrap Icons come from the same CDNs the rest of the site uses.
  Use an icon that exists; a missing glyph fails silently as a blank box.
- The deck uses the system sans stack, not the section's condensed face, which
  is too narrow to read at 6vmin across a room.
- Serving over http is assumed — `fetch` on local JSON is fine. **`file://` is
  out of scope** and will fail CORS.
- Render text with the `h()` helper's `text:`, not `html:`. Curriculum prose
  carries ampersands and quotation marks.

## Testing

No test suite in the published tree. There is a static server and a browser:

```
python3 -m http.server 8000     # from the repository root
# http://localhost:8000/church/deacons/
```

There is also an optional Playwright check at
`.github/checks/deacons-lessons.mjs` — excluded from the Pages artifact, so it
never ships. It needs fixtures and an ad-hoc `npm i playwright`; see the header
comment. It caught the swipe bug above. Delete it if it stops paying for itself.

Check, at minimum:

- both views reachable, and each linkable on its own URL (`&view=present`)
- the deck: arrow keys, space, click halves, swipe, `Esc`, and **the last slide
  does not advance into nothing**
- a lesson with no `discussion[]` (a guide draft) renders and decks correctly
- 360px wide: no horizontal page scroll in either view
- every scripture reference is a link; an unlinked one renders amber on purpose,
  as a visible gap in the data rather than a silent one
- no placeholder text anywhere, and the `Advisor's option` marks are where they
  should be

---

## The prompt

To add a month of lessons:

> Add the lessons for `<month, year>` under `battydev.com/church/deacons`,
> following `church/deacons/AGENTS.md` and the schema in
> `church/deacons/lessons/README.md`. Read both before fetching anything.
>
> Fetch the real curriculum first — the FSY guide chapter for that month and
> each Sunday's magazine lesson page, reached by following the links on the
> issue contents page, never by constructing a URL. Cache what you fetch into
> `_sources/`. If a fetch fails, stop and tell me rather than writing from
> memory.
>
> One eternal truth and one invitation per Sunday, 20–22 minutes, discussion
> over lecture. Mark anything you wrote yourself as `origin: "advisor"`.
>
> Then verify it in a browser against the checklist in AGENTS.md, and tell me
> what each lesson lands on and how long it runs.
