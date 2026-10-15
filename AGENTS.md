# AGENTS.md — battydev.com

Instructions for any coding agent (Claude, ChatGPT/Codex, or anything else)
working in this repository. This is the only agent-instructions file at the
root on purpose: there is no CLAUDE.md, so every tool reads the same rules.
Directories with their own rules carry their own `AGENTS.md`, and the nearest
one wins for files under it.

## What this is

A personal static site: GitHub Pages, served at battydev.com (see `CNAME`).
Vanilla HTML/CSS/JS. **No build step:** the file in the repo is the file that
is served. Keep it that way unless the owner asks otherwise.

**This repository is public.** Everything committed, including history,
branch names, commit messages and PR text, can be read by anyone. Write
everything with that in mind.

| Path | What | Notes |
|---|---|---|
| `index.html` | Landing page | Lists the public projects only. |
| `brackets/` | Fighting-game brackets | Lives in `BattyDev/batty-brackets`; assembled in at deploy. See `docs/brackets-split.md`. |
| `palworld/`, `ffxiv/` | Game dashboards | Linked from the landing page. |
| `guides/` | Unlisted write-ups | Own `AGENTS.md`. |
| `fcevents/` (`raid/` redirects) | FC event scheduler | Own `README.md`; Supabase project `battydevsite`, tables prefixed `raid_`. |
| `health/` | Private health dashboard | Not linked. Supabase project BattyHealth, protected by RLS. |
| `baby/` | Private pregnancy + savings pages | Not linked. Supabase project `battydevsite`, tables prefixed `baby_`, readable only by an allow-list. Own `AGENTS.md`; **read it before touching anything there.** |

## Deploying

`.github/workflows/pages.yml` builds and deploys on every push to `main`.
Work happens on a branch and lands through a pull request; never push to
`main` directly.

## Conventions

- Private sections (`health/`, `baby/`) are never linked from `index.html` and
  carry `<meta name="robots" content="noindex, nofollow">`. Being unlinked is
  not protection, because the repository is public: the real protection is
  RLS in the database.
- `battydevsite` is shared by several features, so every table and function
  carries its feature's prefix (`raid_`, `bkt_`, `baby_`). Its auth lets
  strangers create accounts, so a private feature's RLS must check an
  allow-list, never just "is signed in".
- Never commit secrets, private keys, service-role keys, or personal data in
  plaintext. Publishable (anon) Supabase keys are fine; they are designed to
  be public, and RLS does the protecting.
- Sections copy the shared look (the "home bar" chrome, dark aqua palette,
  Roboto Condensed) rather than importing each other's CSS, so one section can
  change without breaking another.
- Dates in the browser: parse `YYYY-MM-DD` as a *local* date (see `parseDate`
  in `health/health.js`), never with `new Date('YYYY-MM-DD')`, which is UTC
  and shows the previous day in US time zones.
- Bump the `?v=` query on a CSS/JS include when you change that file, so
  returning visitors do not get a stale cached copy.
- Explain the *why* in comments, the way the existing files do.
