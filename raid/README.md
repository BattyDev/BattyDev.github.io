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
| Anonymous public | An aggregate heatmap only. No table privilege at all — not on events either. |
| A signed-in member | Their own availability; every event and roster; other members' names. |
| An event's creator | Who can make **their** event, by name — and nothing more than a member otherwise. |
| A leader | Every member's availability, by name, and every event. |

This is deliberately the **inverse** of `/health`, where views are
`security_invoker = on` so they inherit the caller's RLS. Here
`raid_heatmap()` is `SECURITY DEFINER` and intentionally bypasses row
access — it is the one audited exception in the schema, and it returns
`{slot, available}` so there is no identity in its result type to leak.

Doing this split in JavaScript would not work: the publishable key is in the
page source, so anyone can re-run the queries themselves. `raid.js` hides the
"Company" tab from non-leaders as a courtesy; a non-leader who unhides it gets
an empty grid because the database returns them nothing.

## Events, and the escalation they nearly caused

Anyone can create an event, and a creator has to see who is free when. Those two
facts together are a privilege escalation: if "creator" meant "can read the
weekly availability by name", any member could read the whole company's schedule
by creating a throwaway event, and the member/leader split above would be
decorative.

So creator visibility is scoped by **consent, per event**:

- `raid_availability` (the weekly grid) is untouched — still self-or-leader.
  Creating an event grants nothing on it.
- `raid_event_responses` — "I can make *this* event at these hours" — is readable
  by the responder, that event's creator, and leaders. Nobody else, including
  other members signed up to the same event.
- Responding *is* the consent. Not responding tells the organiser nothing.

A second, smaller split: a **signup** is visible to every member, a **response**
is not. Joining a roster is inherently shared with the people you are raiding
alongside; saying which hours you happen to be free is a schedule.

`sql/test/02_events_proof.sql` tests exactly this, including the case where an
uninvolved member creates her own event and then tries to read everything above.

### How a seat is won

Signups carry the roles a person can fill and a `seq` — an identity column, not
a timestamp, because two signups in the same millisecond still need a defined
order and "who was first" is the whole basis of the backup queue.

Seat assignment is a bipartite matching (Kuhn's algorithm with capacities), not
a greedy pick. The difference shows up with three people: if someone who can
tank-or-DPS grabs a DPS seat, a later DPS-only signup has nowhere to go and the
party is short a tank with a spare body next to it. The solver walks signups in
priority order and, when someone's roles are all full, moves an already-seated
person sideways to free the seat — so the most seats possible get filled and
nobody who has a seat ever loses one.

Priority order is: people the organiser explicitly pinned, then people who said
they could make the scheduled hour, then signup order. Everyone left over is a
backup, in the same order.

## Files

| Path | What |
|---|---|
| `index.html` | Page shell and the three views |
| `raid.css` | Chrome lifted from `/ffxiv`, plus the week grid |
| `raid.js` | Rendering, auth, and the availability read/write |
| `config.js` | Supabase URL + publishable key. Both public by design. |
| `sql/001_schema.sql` | Members, availability, characters: RLS, triggers, aggregate functions |
| `sql/002_events.sql` | Events, signups, responses, duty presets, the member directory |
| `sql/test/00_supabase_shim.sql` | Local-only: fakes Supabase's auth schema and roles |
| `sql/test/01_rls_proof.sql` | Local-only: proves the availability split with role impersonation |
| `sql/test/02_events_proof.sql` | Local-only: proves the event/consent split, and the escalation |
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

## About the security advisor findings

Every current finding is one of the deliberate exceptions described above. The
linter cannot tell a designed boundary from an accident, so they are listed here
rather than "fixed".

**ERROR · `raid_member_directory` is a SECURITY DEFINER view.** Intentional, and
the reason is in `002_events.sql`: rosters are shared with every member, but
`raid_members` is self-or-leader, so joining a roster to it silently dropped
every row whose member you could not read — a plain member saw anonymous UUIDs,
and an event's own creator could not resolve the name of someone who had
responded to his poll. The view is a deliberately narrow projection: `id`,
`display_name`, `avatar_url`, `role`. Not `discord_id`, and above all nothing
about availability. Knowing *who* is in the company was never the secret;
knowing *when* each of them is free is.

**WARN · `raid_heatmap()`, `raid_stats()`, `raid_is_leader()`,
`raid_can_manage_event()` are executable SECURITY DEFINER functions.** All four
are intentional. Do not switch them to SECURITY INVOKER: the first two would
return nothing to the anonymous public, which is the entire point of them, and
the last two would recurse inside the very policies that call them.

What *would* be a real finding is a missing-RLS warning on any `raid_` table.
There are none — all seven have RLS enabled and 24 policies between them.

## Running the checks

The SQL proof, against any local Postgres:

```sh
psql -f sql/test/00_supabase_shim.sql \
     -f sql/001_schema.sql \
     -f sql/002_events.sql \
     -f sql/test/01_rls_proof.sql \
     -f sql/test/02_events_proof.sql
```

The UI harness, which stubs the Supabase client so no network is needed:

```sh
cd sql/test && node ui-harness.js
```

## Status

Done and live on `battydevsite`: the availability layer (schema, RLS, Discord
login, weekly grid, heatmap vs. leader view) and the events layer (creation,
duty presets, poll or fixed time, role signups, the roster solver, backups,
organiser pinning, cancel/reopen).

The page cannot sign anyone in until the Discord steps above are finished; until
then the public heatmap renders and reads empty.

Not built yet:

- **Pushing scheduled events to Discord.** Needs a channel webhook URL stored as
  a Supabase secret, then a small Edge Function to POST to it. Nothing in the
  schema blocks it.
- **Character linking and the adventurer-plate skin.** The `raid_characters`
  table and its policies are already in `001_schema.sql`, so this needs no
  further migration.
- **The Discord slash command** — HTTP interactions via an Edge Function, Ed25519
  signature verified, deferring inside the 3-second reply window.
