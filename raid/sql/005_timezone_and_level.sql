-- BattyRaid, migration 005 -- a member's timezone, and an event's level.
--
-- Both came out of using the thing for real.
--
-- TIMEZONE. Every time on the page was rendered in whatever zone the browser
-- reported, and labelled only with that zone's IANA name in small text on one
-- panel. That is ambiguous in exactly the situation this app exists for: an FC
-- spread across several zones agreeing on an hour. Storing the choice, rather
-- than reading the browser every time, also means a member who raids from a
-- laptop that travels sees consistent times.
--
-- Nothing about the storage format changes. raid_availability.slot is still an
-- hour of the UTC week and raid_event_responses.starts_at is still an absolute
-- instant -- the timezone is a rendering preference and nothing else, which is
-- what keeps two members in different zones agreeing on the same real moment.
--
-- LEVEL. A raid has an item or job level people need to be at, and an organiser
-- had no way to say so. Two shapes are wanted and they are not the same claim:
-- "you must be 100 to come" versus "this is tuned for 100, come anyway". So the
-- number and the strength of the requirement are separate columns.

-- ---------------------------------------------------------------------------
-- raid_members.timezone
-- ---------------------------------------------------------------------------
-- An IANA zone name ("America/New_York"). NULL means "not chosen yet", and the
-- page falls back to whatever the browser reports, then saves that so the value
-- stops being implicit.
--
-- Deliberately not constrained to a list: the IANA database gains and renames
-- zones, and a CHECK here would turn that into a failed write for somebody in a
-- newly-named zone. The client only ever offers names from
-- Intl.supportedValuesOf('timeZone'), and a bad value degrades to times
-- rendered in the browser's own zone rather than to an error.
alter table public.raid_members
  add column timezone text check (timezone is null or length(timezone) between 3 and 64);

comment on column public.raid_members.timezone is
  'IANA zone name for rendering only. Availability is stored in UTC regardless.';

-- No policy change: raid_members_update_self already lets a member write their
-- own row, and raid_guard_member_role pins id, discord_id and role, so this
-- column is writable by its owner and by nobody else.

-- ---------------------------------------------------------------------------
-- raid_events.min_level / level_rule
-- ---------------------------------------------------------------------------
-- 1..100 covers job levels; item level is quoted in the description, where it
-- belongs, because it moves every patch and would date the column.
alter table public.raid_events
  add column min_level smallint check (min_level between 1 and 100),
  add column level_rule text not null default 'recommended'
    check (level_rule in ('required', 'recommended'));

comment on column public.raid_events.min_level is
  'Job level for the duty. NULL means no level stated.';
comment on column public.raid_events.level_rule is
  'Whether min_level bars a signup or merely advises it. Advisory either way -- the page shows a warning, it does not refuse the row.';

-- The level is deliberately NOT enforced against signups in the database. It
-- would need the signer-up's character claim and their current job level, which
-- comes from a JSON file republished on a schedule -- so a check constraint
-- would reject people for being briefly stale, and a leader could not wave in
-- somebody they know is ready. The page warns; a human decides.
