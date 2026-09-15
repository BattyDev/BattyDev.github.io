# AGENTS.md — /guides

Scope: **this directory only.** `guides/` is a self-contained section of a
static personal site. It shares no code with `brackets/`, `fcevents/` or the
game dashboards — only the look, which it copies rather than imports.

## What it is

An unlisted shelf of HTML write-ups at `battydev.com/guides`. Three levels:

```
guides/
  index.html              /guides                 topic shelf
  guides.css                                      the whole section's skin
  guide.js                                        the section pager
  AGENTS.md                                       this file
  ffxiv/
    index.html            /guides/ffxiv           one topic
    beastmaster.html      a guide
    treasure-trove.html   a guide
    treasure-trove.js     one guide's own widgets
    raids/
      index.html          /guides/ffxiv/raids     a sub-shelf
      eden/
        index.html        /guides/ffxiv/raids/eden
        edens-gate-full-party.html
        edens-gate-unsynced.html
        edens-gate.css    styles for this pair of guides
        edens-gate.js     their shared widgets
        diagrams/*.svg    animated mechanic diagrams
```

A topic can nest. `raids/` is a shelf of shelves because one raid series holds
several write-ups and flattening them onto `ffxiv/index.html` would bury the job
and grind guides under a wall of fight names. A nested shelf is the same
`index.html` + cards pattern, one `../` deeper, with the extra level added to the
breadcrumb. Do not nest for the sake of it -- two guides on a subject is a card,
not a shelf.

Unindexed, not private. The landing page links here, and every page carries
`<meta name="robots" content="noindex, nofollow">` — reachable by anyone on the
site, not surfaced in search. There is no gate and nothing secret behind it. Do
not add a login; if something needs one, it belongs in `/health`, not here.

No build step. Vanilla HTML, one stylesheet, one script. The deployed thing is
the source, and a guide must stay readable as a file.

## Adding a topic

A folder with an `index.html`, plus a card on `guides/index.html`. Copy
`ffxiv/index.html` — it is the whole pattern. Update the `1 guide` / `2 guides`
count on the hub card by hand; nothing computes it.

## Adding a guide

One HTML file in the topic folder, plus a card on that topic's `index.html`.

`guide.js` turns a guide into a pager by reading the document, not a config.
It needs exactly four things:

1. `<main data-guide="topic-slug">` — the slug keys this guide's saved
   position in `localStorage`, so it must be unique across the section.
2. `<nav class="rail" id="rail">`, left **empty**. The chips are built from
   the sections.
3. One `<section class="phase" id="..." data-label="...">` per page, in
   reading order, each containing an `<h1>`. The `id` is the deep link; the
   `data-label` is the rail chip's text, so keep it to a few words.
4. A `.pager` block with `.prev`, `.count` and `.next`.

Everything else follows: rail chips, prev/next, `←`/`→`, hash deep links,
remembered position, and a print stylesheet that lays every section out flat.

**Anything outside the `.phase` sections stays on screen across all of them.**
That is where live state belongs — see the tracker in `treasure-trove.html`.
A thing the reader returns to is not part of any one section.

Write the prose in HTML, not in a JSON blob rendered by script. It stays
diffable, printable, and — because `guide.js` only hides sections once it has
wired itself up — readable with script off, where the sections simply stack.

### Per-guide styles

Same rule as scripts. Anything that is one guide's shape rather than the
section's skin goes in a sibling `.css` loaded **after** `guides.css`, so the
custom properties are in scope and nothing restates a colour by value.
`edens-gate.css` is the worked example: a role matrix and a diagram figure, used
by two guides and by nothing else in the section. Putting it in `guides.css`
would mean every page in the section carrying raid furniture, and a `?v=` bump
across the whole shelf every time a raid guide is edited.

### Diagrams

A picture of a mechanic belongs in a `diagrams/` folder beside the guide, as a
standalone `.svg` -- one file, shared by every guide that needs it, diffable and
openable on its own. Three things were learned the hard way building the Eden's
Gate pair, and all three are invisible in the markup:

- **Embed with `<object type="image/svg+xml">`, not `<img>`.** An `<img>`-loaded
  SVG renders in secure static mode: the page's `prefers-reduced-motion` never
  reaches it, and nothing outside it can stop it looping, which fails WCAG 2.2.2
  on its own. `<object>` is a real same-origin document, so the file's own
  reduced-motion rules apply and the page can reach in and pause it. Give it
  `role="img"`, an `aria-label`, and fallback content.
- **Author the resolved state, animate towards it.** Without animation an element
  sits where the markup puts it. If that is the *start* of the motion, the still
  frame teaches the wrong thing -- eight players stacked in the middle of the
  attack they are supposed to be spread out for. Put the end position in the base
  rule and let the keyframes travel to it.
- **Pin caption widths with `textLength`.** The section's font does not exist
  inside the image and the fallback is about a third wider, so text sized by eye
  clips at the viewBox or collides across a two-panel diagram. `textLength` with
  `lengthAdjust="spacingAndGlyphs"` makes the box the contract instead of the
  font.

An `<object>` inside a `display:none` `.phase` does not load until the pager
shows that phase, so any script that reaches into one must do it on that embed's
own `load` event rather than once at startup.

### Per-guide scripts

If a guide needs behaviour of its own, put it in a sibling `.js` beside the
guide and load it **after** `guide.js`. Do not add guide-specific logic to
`guide.js`; it is generic and stays that way. `treasure-trove.js` is the
worked example: countdown, tracker, current-week highlighting, a checklist
that clears itself weekly.

Guard every `localStorage` read and write in `try`/`catch`. Private mode
throws on write rather than failing quietly, and none of this state is worth
a broken page.

### Conventions

- Bump the `?v=` on `guides.css` and `guide.js` in **every** page of the
  section whenever either changes. GitHub Pages caches aggressively and a
  half-updated section looks like a CSS bug.
- Fonts and Bootstrap Icons come from the same CDNs the rest of the site uses.
  Use an icon that exists — check before inventing a name; a missing glyph
  fails silently as a blank box.
- The skin is the landing page's aqua and green, not FFXIV gold, because the
  topics under here will not all be games.

## Testing

No test suite. There is a static server and a browser, and that is enough for
a section this size — but **use them before claiming a guide works.**

```
python3 -m http.server 8000     # from the repository root
# http://localhost:8000/guides/
```

Check, at minimum:

- every section reachable by rail, pager and arrow keys
- a deep link (`#some-section`) opens that section, at the top of the page,
  with its heading clear of the sticky home bar
- script disabled: all sections visible, stacked, rail and pager gone
- 360px wide: no horizontal page scroll (wide tables scroll inside
  `.scroll-x`, not the body)
- any saved state survives a reload, and a fresh profile starts clean
- the home bar's `stamp` is short. "Unrestricted party" overflowed 360px; the
  bar has no room for a phrase

Both bugs this section has actually shipped were invisible to a glance at the
markup: a deep link landing 46px under the sticky header, and a focus ring
drawn on the heading after every mouse click. Open it and look.

---

## The prompt

To turn a document, a Claude artifact, or a pile of notes into a guide here,
hand an agent the source and this:

> Add this as a new guide under `battydev.com/guides`, following
> `guides/AGENTS.md`.
>
> **Source:** <paste the markdown, or the artifact URL, or the file path>
> **Topic:** <ffxiv | a new topic folder>
>
> Read `guides/AGENTS.md` first, then an existing guide — `beastmaster.html`
> for straight prose, `treasure-trove.html` if this one needs live state — and
> match the section's conventions rather than inventing new ones.
>
> Break the source into sections that each stand alone as a screen, ordered
> the way it should be read. Aim for something like 5–10; a section that
> scrolls for pages wants splitting, and three bullets does not deserve its
> own chip. Keep the source's substance intact — every fact, number, table and
> link survives, and its framing and voice stay as written. You are re-laying
> it out, not rewriting it and not summarising it.
>
> Restyle to the section's skin. If the source carries its own colours,
> typography or layout, drop them; if it has interactive parts worth keeping,
> port them to a sibling `.js` and put anything the reader returns to outside
> the `.phase` sections so it stays on screen.
>
> Then add the guide's card to the topic index, bump the topic's guide count
> on the hub, and bump the `?v=` on `guides.css` / `guide.js` across the
> section if either changed.
>
> Verify it in a browser against the checklist in AGENTS.md before telling me
> it works, and report anything in the source you could not carry over.

Two things that recur and are worth stating in the request when they apply:

- **Dated content.** Anything with a deadline, a weekly reset or a countdown
  should compute from the clock rather than hardcode "this week" — otherwise
  it is wrong by the next reset and nobody notices. Say so explicitly.
- **Personal framing.** These guides are written for one player's actual
  progress ("finished Shadowbringers but not Endwalker"). That is the point of
  them. Keep it; do not generalise it into a wiki page.
