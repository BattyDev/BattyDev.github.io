# Raid Nights — battydev.com/raid

Raid availability scheduler for the Wild Hearts FC. Members log the hours they
can raid; the company finds the overlap.

Static page on GitHub Pages + Supabase as the backend, same shape as `/health`.
No build step, no server.

Backed by the **`battydevsite`** Supabase project (`bbqauqqymjxqcyurxmna`),
which is the shared backend for the whole site. Because it is shared, every
object this feature owns is prefixed `raid_` — `members`, `characters` and
`availability` are exactly the names the next sub-site would want, and
squatting them in `public` would make that someone's problem later. Anything
added here should follow the same convention.

`/health` keeps its own separate project (BattyHealth) and is not touched by
any of this.

## The visibility split

Three audiences, enforced in Postgres — not in `raid.js`:

| Who | Sees |
|---|---|
| Anonymous public | An aggregate heatmap only. No table privilege at all. |
| A signed-in member | Their own availability rows, and nothing else. |
| A leader | Every member's availability, by name. |

This is deliberately the **inverse** of `/health`, where views are
`security_invoker = on` so they inherit the caller's RLS. Here
`raid_heatmap()` is `SECURITY DEFINER` and intentionally bypasses row
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
| `config.js` | Supabase URL + publishable key. Both public by design. |
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
`raid_availability` — writes are inserts and deletes only.

## Setup

Steps 1, 2 and 6 are already done — the project exists, the schema is applied,
and `config.js` points at it. What remains is the Discord side and naming the
leaders.

1. ~~Create the Supabase project.~~ Done: `battydevsite`
   (`bbqauqqymjxqcyurxmna`), separate from BattyHealth.

2. ~~Apply `sql/001_schema.sql`.~~ Done, as migration `raid_scheduler_schema`.
   Do *not* run anything under `sql/test/` against it — that is local-harness
   scaffolding which fakes objects Supabase already provides.

3. **Create a Discord application** at
   <https://discord.com/developers/applications>. Under OAuth2, add a redirect
   URI of `https://bbqauqqymjxqcyurxmna.supabase.co/auth/v1/callback`.

4. **Enable the Discord provider** in Supabase → Authentication → Providers,
   and paste the Discord client ID and client secret there. The secret goes in
   the Supabase dashboard and nowhere else — never into this repo.

5. **Allow the redirect** in Supabase → Authentication → URL Configuration →
   Redirect URLs: `https://battydev.com/raid/`.

6. ~~Fill in `config.js`.~~ Done. Both values there are public by design and
   safe to commit; the service role key is not, and must never appear here.

7. **Name the leaders.** After each leader has signed in once, promote them:

   ```sql
   update public.raid_members set role = 'leader'
   where discord_id in ('<discord user id>', '…');
   ```

   Run this from the SQL editor — `auth.uid()` is NULL there, which the
   `raid_guard_member_role` trigger treats as a privileged context. A member
   cannot promote themselves; a leader can promote others.

## About the security advisor warnings

Supabase's linter flags `raid_heatmap()`, `raid_stats()` and `raid_is_leader()`
as "SECURITY DEFINER function is executable by anon/authenticated". All three
are intentional and are the design described above — the linter cannot tell a
deliberate aggregate boundary from an accident. Do not "fix" them by switching
to SECURITY INVOKER: that would make the public heatmap return nothing, and
would make `raid_is_leader()` recurse inside its own policy.

What *would* be a real finding is a missing-RLS warning on any `raid_` table.
There are none.

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
view) is done, and the schema is live on `battydevsite`. The page cannot
actually sign anyone in until the Discord steps above are finished; until then
the public heatmap renders and reads empty. Character linking and the adventurer-plate skin are phase 2;
the Discord slash command — HTTP interactions via a Supabase Edge Function,
Ed25519 signature verified, deferring inside the 3-second reply window — is
phase 3. The `raid_characters` table and its policies are already in the schema
so phase 2 does not need a second migration.
