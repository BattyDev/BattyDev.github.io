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
| A signed-in member | Their own availability; every event and roster; other members' names and character claims. |
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
| `sql/003_character_visibility.sql` | Opens character claims to members (SELECT only) |
| `sql/004_last_leader_guard.sql` | Refuses to remove the last leader from inside the app |
| `sql/005_timezone_and_level.sql` | A member's timezone; an event's required/recommended level |
| `functions/announce-event/index.ts` | Edge Function that posts an event to Discord |
| `sql/test/00_supabase_shim.sql` | Local-only: fakes Supabase's auth schema and roles |
| `sql/test/01_rls_proof.sql` | Local-only: proves the availability split with role impersonation |
| `sql/test/02_events_proof.sql` | Local-only: proves the event/consent split, the escalation, and claims |
| `sql/test/ui-harness.js` | Local-only: drives the page in Chromium with a stubbed client |

## Timezones

Every time on the page is drawn in the member's chosen zone, saved on their
`raid_members` row so it follows them between machines. On first sign-in the
browser's zone is detected and written down, so the value is never implicit.

It is a **rendering preference only**. `raid_availability.slot` stays an hour of
the UTC week and `raid_event_responses.starts_at` stays an absolute instant —
which is exactly what keeps two members in different zones agreeing on the same
real moment. Changing your zone moves which grid cells light up; it does not
touch a single stored row, and the harness asserts both halves of that.

All zone maths goes through `Intl.DateTimeFormat.formatToParts`, because it is
the only thing in the platform that knows the IANA rules — `Date`'s own local
methods only ever speak the browser's zone, which is the thing being replaced.
Converting a wall-clock time to an instant takes two passes: reading the fields
as UTC is wrong by the offset, and the offset *at that wrong instant* can itself
be off by an hour across a DST boundary, so it is re-read at the corrected
instant. Calendar arithmetic is done at UTC noon so adding days cannot slip
across a boundary and change the date.

Absolute times are formatted with `timeZoneName: 'short'`, so an event reads
`Tue, Sep 8, 7:00 PM EDT` rather than leaving the reader to guess.

## How a slot is stored

`slot` is an hour of the **UTC** week: `utcDayOfWeek * 24 + utcHour`, day 0 =
Sunday. Storing UTC is what makes the aggregate mean anything — two members in
different timezones who are free at the same real moment have to land on the
same slot. The page converts to and from the viewer's local time.

The row *is* the fact: a `(member_id, slot)` row means "free then". There is no
boolean to fall out of sync, which is why there is no UPDATE policy on
`raid_availability` — writes are inserts and deletes only.

Both grids save on an explicit button, not on a timer. The autosave they replace
**dropped hours**: it re-read the grid *after* its awaits to decide what was
safely stored, so anything painted during the round-trip was marked saved
without ever having been sent, and the next diff then found nothing to do. The
button removes the overlap; snapshotting the set at send time removes the bug
itself. They are independent fixes and neither relies on the other.

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

   A leader **can** step down, but not if they are the last one: migration 004
   raises *"cannot remove the last leader — promote somebody else first"*. That
   is not a security rule — a member still cannot promote themselves — it stops
   a one-click lockout, since with no leaders left nobody can promote anybody
   and the only way back is the SQL editor. From the SQL editor itself
   (`auth.uid()` NULL) the demotion still goes through.

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

## Character linking

A member claims one or more FFXIV characters off the published FC roster.
Self-asserted by design — there is no verification step and none is wanted —
but the `unique (lodestone_id)` constraint means a character can be claimed only
once, so a wrong claim **blocks rather than duplicates**, and a leader can
reassign or remove it.

Migration 003 opens `raid_characters` SELECT to every member. 001 had given it a
self-or-leader policy by analogy with availability, and that was the wrong
analogy: a claim is not a schedule, it is the mapping from a Discord login to a
character, and a roster reading `cedho_1998 — Tank` instead of
`Cedho Nalen — Tank` has thrown away the only thing linking was for. Writes are
unchanged, and `anon` still holds no privilege on the table.

That needed no new view — unlike `raid_member_directory`, every column here is
something the claim exists to publish, so a plain policy does it and the schema
gains no third RLS-bypassing object.

Nothing cosmetic is stored. Only the Lodestone id, name and world are kept;
portraits, titles, Grand Company and jobs are read from the roster JSON at
render time, so a plate stays current as that file is republished rather than
freezing whatever was true on the day someone clicked claim. A character who
later leaves the FC drops out of that JSON, so the plate falls back to the name
and world the claim itself stored rather than vanishing.

The plate skin is `/ffxiv`'s `.adventurer` — same Grand Company accents, corner
flourishes and job chips — so a character reads the same on both pages.

**Role suggestions.** The roster JSON's own `role` field says
combat/craft/gather, which answers a different question, so `JOB_ROLE` in
`raid.js` maps jobs to Duty Finder's tank/healer/DPS split. A character's
levelled combat jobs then preselect the role checkboxes on signup. It is a
suggestion that saves three clicks, never a constraint — the member still
submits, and the database only ever receives what they ticked.

## The two landings

A **signed-out** visitor gets `#welcome`: what the site is, a Discord sign-in,
and a Getting started button, with the public overlap one click away. It exists
because the heatmap alone — the only thing the public may see — is a wall of
squares that explains neither what this is nor what to do about it.

A **signed-in** member lands on Events, because that is the view with something
to act on. `welcome` is deliberately *not* honoured as a route for a signed-in
member: otherwise signing in from the welcome page would leave them standing on
the signed-out landing.

Getting started is a `<dialog>`, opened from either landing. As an in-flow panel
it rendered above whichever hero or list you pressed the button on; a modal also
brings focus trapping and Esc-to-close for free. It opens itself once for
somebody with no character and no hours logged, and not again after they close
it (`localStorage`, per browser — not worth a column).

## Linking an event

Every view lives in the URL hash, so a reload keeps you where you were, and an
event has a link of its own: `battydev.com/raid/#/event/<id>`, with a **Copy
link** button on the event. A hash rather than a path because this is GitHub
Pages — there is no server to route `/raid/event/<id>` back to the page.

**On unfurling in Discord, one honest limitation.** The page carries Open Graph
tags, so any link to it unfurls as a card — but those tags are *page-level*, not
per-event. Discord's crawler does not run JavaScript, and static hosting cannot
render per-event tags, so an event link previews as "Raid Nights · Wild Hearts"
rather than as that event's title, time and roster.

Two ways to get a per-event card, when it is wanted:

1. **The webhook** (already built). `announce-event` posts a full card — title,
   time in each reader's own timezone, composition, who is signed up — into the
   channel. Blocked only on the webhook URL.
2. **An Edge Function renderer.** A function that serves OG tags for one event
   and redirects humans to the page. Works today with no Discord permission, but
   the shareable URL becomes a `supabase.co` one rather than `battydev.com`,
   which is why it is not built yet — say the word.

## Announcing to Discord

The organiser panel on an event has an **Announce to Discord** button. It calls
the `announce-event` Edge Function, which posts an embed to an incoming webhook.

The webhook URL is a **bearer credential** — anyone holding it can post to the
channel forever, with no way to tell who did — so unlike the publishable key it
cannot live in `config.js`. It is a Supabase secret named `DISCORD_WEBHOOK_URL`,
readable only inside the function.

Authorisation is not re-implemented there. The function forwards the caller's
own JWT to Postgres and asks `raid_can_manage_event()` — the same check the
UPDATE policy on `raid_events` uses — so it cannot drift from the rest of the
app, and a caller without a valid JWT is refused. The embed also sets
`allowed_mentions: { parse: [] }`, so an event title can never be used to
@everyone the server.

It deliberately does **not** re-solve the seat assignment. That solver lives in
`raid.js`; a second copy here would drift, and Discord would quietly disagree
with the page about who is playing. The announcement carries what the database
holds directly — who signed up, in order, with the roles they offered and any
role the organiser pinned — and links to the page for the live roster.

To set the secret: Discord → Server Settings → Integrations → Webhooks → copy
the URL, then Supabase → Edge Functions → Secrets → add `DISCORD_WEBHOOK_URL`.
Until it is set, the button reports *"DISCORD_WEBHOOK_URL is not set"* rather
than failing silently.

## Running the checks

The SQL proof, against any local Postgres:

```sh
psql -f sql/test/00_supabase_shim.sql \
     -f sql/001_schema.sql \
     -f sql/002_events.sql \
     -f sql/003_character_visibility.sql \
     -f sql/004_last_leader_guard.sql \
     -f sql/005_timezone_and_level.sql \
     -f sql/test/01_rls_proof.sql \
     -f sql/test/02_events_proof.sql
```

The UI harness, which stubs the Supabase client so no network is needed:

```sh
cd sql/test && node ui-harness.js
```

## Status

Done and live on `battydevsite`: the availability layer (schema, RLS, Discord
login, weekly grid, heatmap vs. leader view), the events layer (creation, duty
presets, poll or fixed time, role signups, the roster solver, backups, organiser
pinning, cancel/reopen), and the `announce-event` Edge Function that pushes an
event to Discord.

The page cannot sign anyone in until the Discord steps above are finished; until
then the public heatmap renders and reads empty.

Also done: character linking and the adventurer-plate skin.

Blocked, both on the same thing:

- **Posting to Discord.** The `announce-event` function is deployed and the
  button is live, but `DISCORD_WEBHOOK_URL` is not set, so it reports
  *"DISCORD_WEBHOOK_URL is not set"* rather than posting. Creating a webhook
  needs Manage Server on the Discord side.
- **The Discord slash command** — HTTP interactions via an Edge Function, Ed25519
  signature verified, deferring inside the 3-second reply window. Installing an
  application into the server needs Manage Server too, so this is blocked by the
  same permission, not by anything in the code.
