# Lesson data schema

One JSON file per Sunday, named `YYYY-MM-DD.json`, plus one row in
`manifest.json`. **All lesson content lives here and nowhere else.**
`lesson.html` + `assets/lesson.js` render it; `index.html` reads the manifest.
Adding a Sunday means adding a file and a manifest row — never editing HTML or
JS. Changing how a lesson looks means editing `assets/*.css` — never
regenerating content.

Future runs must use these field names rather than inventing new ones. If a
lesson genuinely needs a field that isn't here, add it to this file in the same
commit.

## `manifest.json`

An array, newest last. `index.html` sorts by date itself, so order is cosmetic.

```json
[
  { "date": "2026-09-20", "sunday": "third", "chapter": 9,
    "title": "You are blessed by priesthood keys and authority",
    "truth": "The one eternal truth, one line.",
    "status": "complete" }
]
```

| field | type | notes |
|---|---|---|
| `date` | string | `YYYY-MM-DD`, the Sunday. Also the JSON filename and the `?d=` value. |
| `sunday` | string | `fast` \| `second` \| `third` \| `last`. |
| `chapter` | number | FSY guide chapter. Matches the calendar month. |
| `title` | string | The chapter (or lesson) title, no leading number. |
| `truth` | string | One line. What the Sunday lands on. |
| `status` | string | See **Status** below. |

## Status

Rendered as a badge on both the index and the lesson page.

- **`complete`** — the magazine lesson page exists; its questions and
  activities are in place.
- **`guide-draft`** — built from the FSY guide chapter alone, because that
  month's magazine issue isn't published yet. Chapter, eternal truth,
  invitation, promised blessings and the chapter's own scripture
  cross-references only. **No invented discussion questions.** The page says
  plainly that the magazine's questions are still to come.
- **`awaiting-source`** — queued, nothing built. No lesson JSON file need
  exist; the index shows the row greyed and unclickable.

## `YYYY-MM-DD.json`

```json
{
  "date": "2026-09-20",
  "sunday": "third",
  "status": "complete",
  "chapter": { "number": 9, "title": "…", "url": "https://www.churchofjesuschrist.org/…" },
  "lesson": { "title": "…", "url": "https://www.churchofjesuschrist.org/…" },
  "title": "…",
  "truth": "…",
  "invitation": "…",
  "minutesTotal": 21,
  "atAGlance": "Two sentences.",
  "scriptures": [ { "ref": "Doctrine and Covenants 107:20", "url": "…", "excerpt": "…" } ],
  "background": [ { "text": "…", "hard": false } ],
  "open": { "minutes": 3, "hook": "…", "how": "…", "materials": ["…"] },
  "discussion": [
    { "minutes": 4, "question": "…",
      "scriptures": [ { "ref": "Doctrine and Covenants 13:1", "url": "…", "excerpt": "…" } ],
      "followUp": "…", "hopingFor": "…",
      "activity": { "title": "…", "instructions": "…", "rows": ["…"] } }
  ],
  "invite": { "minutes": 5, "ask": "…", "christ": "…", "blessings": ["…"] },
  "backPocket": {
    "extraQuestions": ["…", "…"],
    "ifDiscussionDies": "…",
    "ifShortOnTime": "…",
    "ifTimeLeft": "…",
    "hardQuestion": { "q": "…", "a": "…" }
  },
  "sources": [ { "kind": "guide", "title": "…", "url": "…", "fetched": "2026-09-17", "cached": "_sources/2026-09/…md" } ]
}
```

### Fields

**Top level**

| field | type | notes |
|---|---|---|
| `date`, `sunday`, `status` | | as in the manifest, and must agree with it. |
| `chapter` | object | `{number, title, url}` — the FSY *guide* chapter. |
| `lesson` | object | `{title, url}` — the *magazine* lesson page. Omit on a `guide-draft`. |
| `title` | string | Heading for this Sunday. |
| `truth` | string | **One** eternal truth. Never two. |
| `invitation` | string | **One** invitation, one line. The long form lives in `invite`. |
| `minutesTotal` | number | Target 20–22, not 25 — the presidency needs time for quorum business. |
| `atAGlance` | string | Two sentences for the *At a glance* section. |
| `scriptures` | array | The **chapter's own** scripture cross-references, same shape as `discussion[].scriptures`. Rendered under *At a glance*. Required on a `guide-draft`, which has no `discussion[]` to hang scriptures off and would otherwise carry none; optional on a `complete` lesson. |

**`background[]`** — *What I need to know first*. Each entry
`{ text, hard?, origin? }`. Set `hard: true` for anything that will confuse an
11-year-old; it renders with a warning marker. Flag hard things, don't skip
them.

**`open{}`** — *Open*. `{ minutes, hook, how?, materials?[], origin? }`.
`hook` is the attention-getter and is also the second slide, so keep it to one
sentence. `how` is the mechanics (what to hold up, what to write on the board).

**`discussion[]`** — *Core discussion*, in the order to ask them. One entry per
question, each `{ minutes, question, scriptures[], followUp, hopingFor,
activity?, origin? }`.

- `question` — the magazine lesson's own question, verbatim where possible.
- `scriptures[]` — `{ ref, url, excerpt? }`. `ref` in standard Latter-day
  Saint citation format; Old Testament passages are KJV as published in the LDS
  edition. `url` is the churchofjesuschrist.org scripture URL and is
  **required** — the renderer links `ref` with it and never guesses a URL, so a
  missing one ships an unlinked reference. `excerpt` is a short phrase (under
  15 words) used on the scripture slide.
- `followUp` — one follow-up so a one-word answer doesn't dead-end.
- `hopingFor` — what I'm hoping they discover. Advisor-facing; never on a slide.
- `activity` — `{ title, instructions, rows?[] }` for a chart or a
  find-it-in-the-verse task. Keep these; this age needs something to do with
  their hands. Gets its own slide.

The deck's scripture slide uses the first scripture it finds in
`discussion[]`, falling back to the first entry in the top-level
`scriptures[]`.

**`invite{}`** — *Invitation*. `{ minutes, ask, christ, blessings[], origin? }`.
`ask` is something a deacon could actually do this week. `christ` ties it
explicitly to Jesus Christ — every lesson lands there. `blessings[]` comes from
the chapter's **Promised Blessings**.

**`backPocket{}`** — `{ extraQuestions[], ifDiscussionDies, ifShortOnTime,
ifTimeLeft, hardQuestion{q,a} }`. `hardQuestion` is one a sharp deacon might
ask, with how I'd answer it.

**`sources[]`** — `{ kind, title, url, fetched?, cached? }`. `kind` is
`guide` | `magazine` | `scripture` | `resource`. Every page actually fetched
gets a row, and `cached` points at its text in `_sources/` so a rebuild doesn't
require refetching.

### `origin`

Put `"origin": "advisor"` on **anything you authored yourself** — an object
lesson, a hook, an extra question, a follow-up not in the material. The
renderer marks it `Advisor's option` in a muted style so it's obvious what came
from the curriculum and what didn't. Omit it (or use `"curriculum"`) for
material drawn from the fetched pages.

`origin` is accepted on `background[]` entries, `open`, any `discussion[]`
entry, `invite`, and on individual `backPocket.extraQuestions[]` entries (write
those as `{ "text": "…", "origin": "advisor" }` instead of a bare string when
they need marking).

## Rules that outrank convenience

- **Never fabricate a quotation.** Any talk, prophet or Church resource cited
  must appear on a page listed in `sources[]`. Quote under 15 words; paraphrase
  the rest.
- **Never construct a lesson URL.** Load the issue contents page and follow the
  links under "FSY Sunday Lessons". The paths are not consistent between
  months — in the October 2026 issue, October's lessons sit under
  `/2026/10/fsy-lessons/…` while November's sit under `/2026/10/…` with no
  `fsy-lessons` segment. A guessed slug fetches the wrong month or nothing.
- One eternal truth and one invitation per Sunday. Fewer, deeper. Don't stretch
  to two to fill slides.
- No *Come, Follow Me* material — that's Sunday School, a different class.
- On a last Sunday, use the **Aaronic Priesthood** version of the lesson, never
  the Young Women version.
- If a fetch fails, stop and say so. Don't improvise from general knowledge.
