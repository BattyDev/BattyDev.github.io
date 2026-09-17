# _sources

Raw fetched curriculum text, one file per page, for provenance. A lesson's
`sources[].cached` points at the file it was built from, so a rebuild doesn't
require refetching and it's possible to see exactly what a lesson came from.

Layout: `_sources/YYYY-MM/<slug>.md`, e.g.
`_sources/2026-09/03-third-sunday.md`. Keep the page's own headings and
wording; this is a transcript, not a summary. Head each file with the URL and
the date fetched.

## Nothing is cached yet

`www.churchofjesuschrist.org` is blocked by the egress policy of the
environment this section was scaffolded in, so no curriculum page has been
fetched. The pages still needed for the September 2026 lessons:

- FSY guide, chapter 9 —
  `https://www.churchofjesuschrist.org/study/manual/for-the-strength-of-youth/09-you-are-blessed-by-priesthood?lang=eng`
  (confirm the title reads "9. You are blessed by priesthood keys and
  authority" — the 2022 edition still resolves under the same path)
- September 2026 magazine contents —
  `https://www.churchofjesuschrist.org/study/ftsoy/2026/09?lang=eng`
- Third Sunday lesson, for 9/20 — **follow the link from the contents page**
- Last Sunday lesson, Aaronic Priesthood version, for 9/27 — **follow the link
  from the contents page**
- Every cross-reference those two lesson pages link to (Guide to the
  Scriptures, Preach My Gospel, Gospel Topics, general conference talks)

Do not construct those last two URLs; see `../lessons/README.md`.
