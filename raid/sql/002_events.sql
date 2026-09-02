-- BattyRaid, migration 002 -- events, signups and role composition.
--
-- Builds on 001_schema.sql. Same rule as there: the page is a rendering layer
-- and is assumed hostile, so every visibility decision below is enforced by
-- RLS, not by which tab raid.js happens to draw.
--
-- THE ESCALATION THIS SCHEMA HAS TO AVOID
--
-- Anyone may create an event, and an event's creator must be able to see who
-- is free when. Those two facts together are a privilege escalation waiting to
-- happen: if "creator" meant "can read public.raid_availability by name", then
-- any member could read the whole company's named availability simply by
-- creating a throwaway event, and the member/leader split in 001 would be
-- decorative.
--
-- So creator visibility is scoped by CONSENT, per event:
--
--   * raid_availability (the weekly grid from 001) is untouched. It stays
--     self-or-leader. Creating an event grants no access to it whatsoever.
--   * raid_event_responses -- "I can make THIS event at these hours" -- is
--     readable by the responder, that event's creator, and leaders. Nobody
--     else, including other members who signed up to the same event.
--   * responding is the act of consent. A member who does not respond to your
--     event tells you nothing.
--
-- The second split worth knowing: a SIGNUP is visible to every member, a
-- RESPONSE is not. Signing up is joining a roster, which is inherently shared
-- with the people you are raiding alongside. Saying which hours you happen to
-- be free is a schedule, and is disclosed only to the person organising.

-- ---------------------------------------------------------------------------
-- raid_event_types -- duty composition presets
-- ---------------------------------------------------------------------------
-- Reference data for prefilling an event's composition, mirroring what Duty
-- Finder would ask for. NULL in tanks/healers/dps means "no composition
-- requirement"; NULL party_size means unlimited.
--
-- The event copies these numbers at creation rather than referencing them
-- forever, so editing this catalogue later cannot silently rewrite the roster
-- rules of an event that people have already signed up to.
create table public.raid_event_types (
  code       text primary key,
  label      text not null,
  tanks      smallint check (tanks   >= 0),
  healers    smallint check (healers >= 0),
  dps        smallint check (dps     >= 0),
  party_size smallint check (party_size > 0),
  sort_order smallint not null default 0
);

insert into public.raid_event_types (code, label, tanks, healers, dps, party_size, sort_order) values
  ('full_party',   'Full Party (8)',            2, 2, 4,    8, 10),
  ('savage',       'Savage Raid (8)',           2, 2, 4,    8, 20),
  ('ultimate',     'Ultimate (8)',              2, 2, 4,    8, 30),
  ('extreme',      'Extreme Trial (8)',         2, 2, 4,    8, 40),
  ('normal_raid',  'Normal Raid (8)',           2, 2, 4,    8, 50),
  ('light_party',  'Light Party (4)',           1, 1, 2,    4, 60),
  ('dungeon',      'Dungeon (4)',               1, 1, 2,    4, 70),
  ('alliance',     'Alliance Raid (24)',        6, 6, 12,  24, 80),
  ('deep_dungeon', 'Deep Dungeon (4)',       null, null, null, 4, 90),
  ('treasure',     'Treasure Maps (8)',      null, null, null, 8, 100),
  ('frontline',    'Frontline (24)',         null, null, null, 24, 110),
  ('crystalline',  'Crystalline Conflict (5)', null, null, null, 5, 120),
  ('field_ops',    'Field Operations (48)',  null, null, null, 48, 130),
  ('unrestricted', 'Unrestricted',           null, null, null, null, 999);

-- ---------------------------------------------------------------------------
-- raid_events
-- ---------------------------------------------------------------------------
-- mode = 'poll'  -- creator offers a date window, people mark hours they can
--                   make, creator then locks one in
-- mode = 'fixed' -- creator names the time up front and people just sign up
create table public.raid_events (
  id             uuid primary key default gen_random_uuid(),
  created_by     uuid not null references public.raid_members (id) on delete cascade,
  title          text not null check (length(btrim(title)) between 1 and 120),
  description    text check (length(description) <= 2000),
  event_type     text references public.raid_event_types (code),

  -- Copied from the type at creation, then freely editable by the creator.
  -- NULL means "no requirement for this role".
  tanks_needed   smallint check (tanks_needed   >= 0),
  healers_needed smallint check (healers_needed >= 0),
  dps_needed     smallint check (dps_needed     >= 0),
  party_size     smallint check (party_size > 0),   -- NULL = unlimited

  mode           text not null check (mode in ('poll', 'fixed')),
  poll_start     date,
  poll_days      smallint not null default 14 check (poll_days between 1 and 28),
  scheduled_at   timestamptz,
  status         text not null default 'open'
                   check (status in ('open', 'scheduled', 'cancelled')),
  created_at     timestamptz not null default now(),

  -- A fixed-time event has a time from the start; a polled one gets its time
  -- when the creator locks it in. Either way, 'scheduled' without a time is
  -- meaningless and must not be representable.
  constraint raid_events_fixed_has_time
    check (mode <> 'fixed' or scheduled_at is not null),
  constraint raid_events_scheduled_has_time
    check (status <> 'scheduled' or scheduled_at is not null)
);

create index raid_events_status_idx    on public.raid_events (status, scheduled_at);
create index raid_events_created_by_idx on public.raid_events (created_by);

-- ---------------------------------------------------------------------------
-- raid_event_signups -- the participant record
-- ---------------------------------------------------------------------------
-- One row per person per event. This is both "I am coming" and "here are the
-- roles I can fill", and it carries the signup ORDER that decides who makes
-- the roster and who is a backup.
--
-- seq is an identity column rather than a timestamp because two signups in the
-- same millisecond must still have a defined order -- "who was first" is the
-- whole basis of the backup queue, so it cannot be a tie.
create table public.raid_event_signups (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.raid_events (id) on delete cascade,
  member_id     uuid not null references public.raid_members (id) on delete cascade,

  -- Which roles this person is willing to fill. Multiple is the useful case:
  -- someone who can tank OR dps lets the roster solver fill a gap.
  roles         text[] not null check (
                  cardinality(roles) between 1 and 3
                  and roles <@ array['tank', 'healer', 'dps']::text[]
                ),

  -- Set by the creator or a leader to pin someone into a specific role,
  -- overriding the automatic assignment. Members cannot write this -- see the
  -- raid_guard_signup trigger.
  assigned_role text check (assigned_role in ('tank', 'healer', 'dps')),

  seq           bigint generated always as identity,
  note          text check (length(note) <= 500),
  created_at    timestamptz not null default now(),

  unique (event_id, member_id)
);

create index raid_event_signups_event_idx on public.raid_event_signups (event_id, seq);

-- ---------------------------------------------------------------------------
-- raid_event_responses -- "I can make it at these hours"
-- ---------------------------------------------------------------------------
-- Only for poll-mode events. The FK is to the signup, not to the event, so a
-- response cannot exist without its participant record: marking times IS
-- signing up, which is what makes "schedule it for that time with those
-- people" a single coherent action rather than two lists to reconcile.
--
-- starts_at is an absolute hour, not a weekly slot. An event happens on a
-- date; the recurring weekly grid in 001 answers a different question.
create table public.raid_event_responses (
  event_id  uuid not null,
  member_id uuid not null,
  starts_at timestamptz not null check (date_trunc('hour', starts_at) = starts_at),

  primary key (event_id, member_id, starts_at),
  foreign key (event_id, member_id)
    references public.raid_event_signups (event_id, member_id) on delete cascade
);

create index raid_event_responses_event_idx on public.raid_event_responses (event_id, starts_at);

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER for the same reason raid_is_leader() is: this is called
-- from inside the RLS policies ON raid_events, and an invoker-rights function
-- reading that table from within its own policy would recurse.
--
-- It answers only about the calling user and returns a single boolean.
create or replace function public.raid_can_manage_event(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.raid_events e
    where e.id = p_event
      and (e.created_by = (select auth.uid()) or public.raid_is_leader())
  );
$$;

revoke all on function public.raid_can_manage_event(uuid) from public, anon;
grant execute on function public.raid_can_manage_event(uuid) to authenticated;

-- Identity columns are what the policies key off. Pin them so an UPDATE cannot
-- re-point a row at another event or another member, and keep created_by out
-- of the creator's own reach so an event cannot be handed off by accident.
create or replace function public.raid_guard_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.id         := old.id;
  new.created_by := old.created_by;
  return new;
end;
$$;

create trigger raid_events_guard
  before update on public.raid_events
  for each row execute function public.raid_guard_event();

-- assigned_role is the creator's call, not the participant's. RLS can gate
-- which rows you may write but not which columns, so as in 001 the column
-- guard is a trigger.
create or replace function public.raid_guard_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  privileged boolean := (select auth.uid()) is null
                        or public.raid_can_manage_event(coalesce(new.event_id, old.event_id));
begin
  if tg_op = 'INSERT' then
    if not privileged then
      new.assigned_role := null;
    end if;
  else
    new.id        := old.id;
    new.event_id  := old.event_id;
    new.member_id := old.member_id;
    new.seq       := old.seq;
    if not privileged then
      new.assigned_role := old.assigned_role;
    end if;
  end if;
  return new;
end;
$$;

create trigger raid_event_signups_guard
  before insert or update on public.raid_event_signups
  for each row execute function public.raid_guard_signup();

revoke all on function public.raid_guard_event()  from public, anon, authenticated;
revoke all on function public.raid_guard_signup() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------------
alter table public.raid_event_types     enable row level security;
alter table public.raid_events          enable row level security;
alter table public.raid_event_signups   enable row level security;
alter table public.raid_event_responses enable row level security;

-- Events are for signed-in members. The anonymous public keeps exactly the
-- surface 001 gave it -- the aggregate weekly heatmap -- and gains nothing
-- here: no event titles, no times, no names.
revoke all on public.raid_event_types     from anon;
revoke all on public.raid_events          from anon;
revoke all on public.raid_event_signups   from anon;
revoke all on public.raid_event_responses from anon;

-- raid_event_types ------------------------------------------------------
-- Read-only reference data. No write policy at all: the catalogue is seeded by
-- migration and edited by migration.
create policy raid_event_types_select on public.raid_event_types
  for select to authenticated
  using (true);

-- raid_events -----------------------------------------------------------
create policy raid_events_select on public.raid_events
  for select to authenticated
  using (true);

-- Anyone may create an event, but only as themselves.
create policy raid_events_insert on public.raid_events
  for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy raid_events_update on public.raid_events
  for update to authenticated
  using (public.raid_can_manage_event(id))
  with check (public.raid_can_manage_event(id));

create policy raid_events_delete on public.raid_events
  for delete to authenticated
  using (public.raid_can_manage_event(id));

-- raid_event_signups ----------------------------------------------------
-- Visible to every member: a roster is shared with the people on it.
create policy raid_event_signups_select on public.raid_event_signups
  for select to authenticated
  using (true);

create policy raid_event_signups_insert on public.raid_event_signups
  for insert to authenticated
  with check (member_id = (select auth.uid()));

create policy raid_event_signups_update on public.raid_event_signups
  for update to authenticated
  using (member_id = (select auth.uid()) or public.raid_can_manage_event(event_id))
  with check (member_id = (select auth.uid()) or public.raid_can_manage_event(event_id));

-- The creator needs delete to remove a no-show; the member needs it to drop.
create policy raid_event_signups_delete on public.raid_event_signups
  for delete to authenticated
  using (member_id = (select auth.uid()) or public.raid_can_manage_event(event_id));

-- raid_event_responses --------------------------------------------------
-- The consent boundary described at the top of this file. Note what is absent:
-- no policy lets one member read another member's response, even when both
-- have signed up to the same event.
create policy raid_event_responses_select on public.raid_event_responses
  for select to authenticated
  using (
    member_id = (select auth.uid())
    or public.raid_can_manage_event(event_id)
  );

create policy raid_event_responses_insert on public.raid_event_responses
  for insert to authenticated
  with check (member_id = (select auth.uid()));

create policy raid_event_responses_delete on public.raid_event_responses
  for delete to authenticated
  using (member_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- raid_member_directory -- names for the shared roster
-- ---------------------------------------------------------------------------
-- THE SECOND AUDITED EXCEPTION IN THIS SCHEMA, and the reason it exists:
--
-- 001 made raid_members readable only by yourself or a leader. That was right
-- when the only named view was the leader's. It stops working the moment a
-- roster is shared: raid_event_signups is visible to every member, but joining
-- it to raid_members silently drops every row whose member you cannot read, so
-- a plain member saw a roster of anonymous UUIDs -- and an event's own creator
-- could not resolve the name of somebody who had responded to his poll.
--
-- The fix is a deliberately narrow projection rather than opening the table.
-- security_invoker = off means this runs as the owner and bypasses RLS on
-- raid_members, so keep the column list to what a roster needs to render:
--
--   id, display_name, avatar_url, role
--
-- Not discord_id, not created_at, and above all nothing about availability --
-- the weekly grid and the event responses are untouched by this and remain
-- exactly as restricted as 001 and the policies above make them. Knowing WHO
-- is in the company was never the secret; knowing WHEN each of them is free is.
--
-- authenticated only. The anonymous public still gets names from nowhere.
create view public.raid_member_directory
with (security_invoker = off) as
  select id, display_name, avatar_url, role
  from public.raid_members;

revoke all on public.raid_member_directory from public, anon;
grant select on public.raid_member_directory to authenticated;

comment on view public.raid_member_directory is
  'Narrow, RLS-bypassing projection of raid_members for rendering shared rosters. Names only -- never join availability through this.';
