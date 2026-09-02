# Raid Nights — battydev.com/raid

Raid availability scheduler for the Wild Hearts FC. Members log the hours they
can raid; the company finds the overlap.

Static page on GitHub Pages + Supabase as the backend, same shape as `/health`.
No build step, no server.

## The visibility split

Three audiences, enforced in Postgres — not in `raid.js`:

| Who | Sees |
|---|---|
| Anonymous public | An aggregate heatmap only. No table privilege at all. |
| A signed-in member | Their own availability rows, and nothing else. |
| A leader | Every member's availability, by name. |

This is deliberately the **inverse** of `/health`, where views are
`security_invoker = on` so they inherit the caller's RLS. Here
`availability_heatmap()` is `SECURITY DEFINER` and intentionally bypasses row
access — it is the one audited exception in the schema, and it returns
`{slot, available}` so there is no identity in its result type to leak.

Doing this split in JavaScript would not work: the publishable key is in the
page source, so anyone can re-run the queries themselves. `raid.js` hides the
"Company" tab from non-leaders as a courtesy; a non-leader who unhides it gets
an empty grid because the database returns them nothing.

## Files

| Path | What |
|---|---|
| `index.html` | Page shell and the three views |
| `raid.css` | Chrome lifted from `/ffxiv`, plus the week grid |
| `raid.js` | Rendering, auth, and the availability read/write |
| `config.js` | Supabase URL + publishable key. **Must be filled in.** |
| `sql/001_schema.sql` | Tables, RLS policies, triggers, the aggregate functions |
| `sql/test/00_supabase_shim.sql` | Local-only: fakes Supabase's auth schema and roles |
| `sql/test/01_rls_proof.sql` | Local-only: proves the split with role impersonation |
| `sql/test/ui-harness.js` | Local-only: drives the page in Chromium with a stubbed client |

## How a slot is stored

`slot` is an hour of the **UTC** week: `utcDayOfWeek * 24 + utcHour`, day 0 =
Sunday. Storing UTC is what makes the aggregate mean anything — two members in
different timezones who are free at the same real moment have to land on the
same slot. The page converts to and from the viewer's local time.

The row *is* the fact: a `(member_id, slot)` row means "free then". There is no
boolean to fall out of sync, which is why there is no UPDATE policy on
`availability` — writes are inserts and deletes only.

## Setup

1. **Create a Supabase project**, separate from BattyHealth. This app takes
   writes from people who are not the owner, so it must not share a database
   with the health data.

2. **Run `sql/001_schema.sql`** in that project's SQL editor. Do *not* run
   anything under `sql/test/` against it — that is local-harness scaffolding
   which fakes objects Supabase already provides.

3. **Create a Discord application** at
   <https://discord.com/developers/applications>. Add a redirect URI of
   `https://<project-ref>.supabase.co/auth/v1/callback`.

4. **Enable the Discord provider** in Supabase → Authentication → Providers,
   and paste the Discord client ID and client secret there. The secret goes in
   the Supabase dashboard and nowhere else — never into this repo.

5. **Allow the redirect** in Supabase → Authentication → URL Configuration →
   Redirect URLs: `https://battydev.com/raid/`.

6. **Fill in `config.js`** with the project URL and the *publishable* key
   (`sb_publishable_…`). Both are public by design and safe to commit; the
   service role key is not, and must never appear here.

7. **Name the leaders.** After each leader has signed in once, promote them:

   ```sql
   update public.members set role = 'leader'
   where discord_id in ('<discord user id>', '…');
   ```

   Run this from the SQL editor — `auth.uid()` is NULL there, which the
   `guard_member_role` trigger treats as a privileged context. A member cannot
   promote themselves; a leader can promote others.

## Running the checks

The SQL proof, against any local Postgres:

```sh
psql -f sql/test/00_supabase_shim.sql \
     -f sql/001_schema.sql \
     -f sql/test/01_rls_proof.sql
```

The UI harness, which stubs the Supabase client so no network is needed:

```sh
cd sql/test && node ui-harness.js
```

## Status

Phase 1 (schema, RLS, Discord login, availability grid, heatmap vs. leader
view) is done. Character linking and the adventurer-plate skin are phase 2;
the Discord slash command — HTTP interactions via a Supabase Edge Function,
Ed25519 signature verified, deferring inside the 3-second reply window — is
phase 3. The `characters` table and its policies are already in the schema so
phase 2 does not need a second migration.
