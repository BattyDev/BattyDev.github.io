-- BattyRaid -- raid availability scheduler for the Wild Hearts FC.
-- Target: a Supabase project SEPARATE from BattyHealth. This app takes writes
-- from people who are not the owner, so it must not share a database with the
-- health data.
--
-- The whole security model lives in this file. The page in ../index.html is a
-- rendering layer over it and is assumed hostile: anyone can open devtools,
-- read the publishable key out of the page source and issue their own queries
-- with it. So "leaders see names, the public sees a heatmap" is NOT a UI
-- decision here -- if it were, every name would be one network tab away.
-- Instead:
--
--   * a member can read and write only their own rows (keyed on auth.uid())
--   * a leader can read every row (gated on members.role = 'leader')
--   * the public heatmap comes from a SECURITY DEFINER function that returns
--     only {slot, count} aggregates -- anon holds no table privilege at all
--
-- Note this is the deliberate INVERSE of the /health project, where the views
-- are security_invoker = on so they inherit the caller's RLS. Here the
-- aggregate function intentionally bypasses row access. It is the one audited
-- exception in this schema, and it is why it returns counts and nothing else:
-- adding a name, a discord_id or a member_id to its result type would hand the
-- anonymous public the exact data RLS is protecting.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- members -- one row per Discord login
-- ---------------------------------------------------------------------------
-- Rows are created by the on_auth_user_created trigger below, never by the
-- client. There is deliberately no INSERT policy: a member who could insert
-- their own row could insert it with role = 'leader'.
create table public.members (
  id           uuid primary key references auth.users (id) on delete cascade,
  discord_id   text not null unique,
  display_name text not null default 'Adventurer',
  avatar_url   text,
  role         text not null default 'member' check (role in ('member', 'leader')),
  created_at   timestamptz not null default now()
);

comment on column public.members.discord_id is
  'Discord snowflake, from the OAuth provider. Stable across username changes.';
comment on column public.members.role is
  'Write-protected by the guard_member_role trigger -- only a leader may change it.';

-- ---------------------------------------------------------------------------
-- characters -- self-asserted FFXIV character claims
-- ---------------------------------------------------------------------------
-- No verification by design: a member picks their character(s) off the existing
-- FC roster and says "that's me". The unique constraint on lodestone_id is what
-- makes a bad claim correctable rather than merely duplicated -- one character
-- can be claimed by at most one member, and a leader can reassign or drop it.
create table public.characters (
  id             uuid primary key default gen_random_uuid(),
  member_id      uuid not null references public.members (id) on delete cascade,
  lodestone_id   text not null unique,
  character_name text not null,
  world          text,
  created_at     timestamptz not null default now()
);

create index characters_member_id_idx on public.characters (member_id);

-- ---------------------------------------------------------------------------
-- availability -- the weekly grid
-- ---------------------------------------------------------------------------
-- A slot is an hour of the UTC week: slot = utc_day_of_week * 24 + utc_hour,
-- with day 0 = Sunday to match JavaScript's getUTCDay(). Storing UTC rather
-- than local time is what makes the aggregate meaningful -- two members in
-- different timezones who are free at the same real moment land on the same
-- slot. The client converts to and from the viewer's local time for display.
--
-- Caveat worth knowing: this assumes whole-hour UTC offsets. A member in a
-- :30 or :45 zone (India, Nepal, parts of Australia) would be recorded to the
-- nearest hour. The Wild Hearts are on Malboro/Crystal, so everyone is on a
-- whole-hour North American offset and this does not bite today.
--
-- The row IS the fact: presence of (member, slot) means free. There is no
-- boolean to get out of sync, and no UPDATE policy below because there is
-- nothing to update -- writes are inserts and deletes only.
create table public.availability (
  member_id uuid     not null references public.members (id) on delete cascade,
  slot      smallint not null check (slot between 0 and 167),
  primary key (member_id, slot)
);

create index availability_slot_idx on public.availability (slot);

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER on purpose, and not for convenience: this function is called
-- from inside the RLS policies ON public.members. A plain (invoker) function
-- reading that table from within its own policy recurses and Postgres aborts
-- with "infinite recursion detected in policy". Running as the owner reads the
-- table without re-entering the policy.
--
-- It leaks nothing: it takes no argument, only ever looks up the *calling*
-- user, and returns a single boolean.
create or replace function public.is_leader()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.id = (select auth.uid()) and m.role = 'leader'
  );
$$;

-- Supabase's default privileges grant EXECUTE on every new function in public
-- to anon and authenticated, and PostgREST exposes anything so granted at
-- /rpc/. Revoking from PUBLIC alone does not undo a grant held explicitly by
-- anon, so anon is named here. Only availability_heatmap() and
-- availability_stats() are meant to be reachable without a login.
revoke all on function public.is_leader() from public, anon;
grant execute on function public.is_leader() to authenticated;

-- ---------------------------------------------------------------------------
-- member provisioning
-- ---------------------------------------------------------------------------
-- Discord's OAuth payload lands in raw_user_meta_data. provider_id is the
-- snowflake; full_name/name is the display name.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.members (id, discord_id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'provider_id',
      new.raw_user_meta_data ->> 'sub',
      new.id::text
    ),
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      'Adventurer'
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- The members UPDATE policy lets a member edit their own row -- which would
-- otherwise let them write role = 'leader' into it. RLS can gate which ROWS you
-- may write, not which COLUMNS, so the column guard is a trigger.
--
-- auth.uid() IS NULL means there is no end-user JWT: the SQL editor, a
-- migration, or the service_role key. Those contexts bypass RLS anyway, so
-- refusing them here would only break leader bootstrapping without adding
-- protection.
create or replace function public.guard_member_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  privileged boolean := (select auth.uid()) is null or public.is_leader();
begin
  if tg_op = 'INSERT' then
    if not privileged then
      new.role := 'member';
    end if;
  else
    if not privileged then
      new.role := old.role;
    end if;
    -- Identity columns are what every policy in this file keys off. Pin them
    -- so no caller can re-point their row at someone else.
    new.id         := old.id;
    new.discord_id := old.discord_id;
  end if;
  return new;
end;
$$;

create trigger members_guard_role
  before insert or update on public.members
  for each row execute function public.guard_member_role();

-- Both of the above are trigger functions and Postgres refuses to call them
-- directly, but they are SECURITY DEFINER and the default grants would still
-- publish them at /rpc/. Take the grant away rather than rely on that refusal.
revoke all on function public.handle_new_user()   from public, anon, authenticated;
revoke all on function public.guard_member_role() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------------
alter table public.members      enable row level security;
alter table public.characters   enable row level security;
alter table public.availability enable row level security;

-- Belt and braces over the policies. Supabase's default grants hand anon
-- SELECT on everything in public and rely on RLS to return zero rows; with the
-- privilege revoked outright, a permissive policy added here by mistake later
-- still cannot expose a row to the anonymous public.
revoke all on public.members      from anon;
revoke all on public.characters   from anon;
revoke all on public.availability from anon;

-- members ---------------------------------------------------------------
create policy members_select_self on public.members
  for select to authenticated
  using (id = (select auth.uid()));

create policy members_select_leader on public.members
  for select to authenticated
  using (public.is_leader());

create policy members_update_self on public.members
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy members_update_leader on public.members
  for update to authenticated
  using (public.is_leader())
  with check (public.is_leader());

-- characters ------------------------------------------------------------
create policy characters_select_self on public.characters
  for select to authenticated
  using (member_id = (select auth.uid()));

create policy characters_insert_self on public.characters
  for insert to authenticated
  with check (member_id = (select auth.uid()));

create policy characters_delete_self on public.characters
  for delete to authenticated
  using (member_id = (select auth.uid()));

-- FOR ALL, not FOR SELECT: correcting a bad claim means reassigning or
-- deleting a row that belongs to someone else.
create policy characters_all_leader on public.characters
  for all to authenticated
  using (public.is_leader())
  with check (public.is_leader());

-- availability ----------------------------------------------------------
create policy availability_select_self on public.availability
  for select to authenticated
  using (member_id = (select auth.uid()));

create policy availability_insert_self on public.availability
  for insert to authenticated
  with check (member_id = (select auth.uid()));

create policy availability_delete_self on public.availability
  for delete to authenticated
  using (member_id = (select auth.uid()));

create policy availability_select_leader on public.availability
  for select to authenticated
  using (public.is_leader());

-- Deliberately absent: any policy granting a member write access to another
-- member's availability, and any policy at all for anon.

-- ---------------------------------------------------------------------------
-- the public aggregate -- the one audited exception
-- ---------------------------------------------------------------------------
-- This is the only path by which an unauthenticated visitor learns anything.
-- SECURITY DEFINER means it runs as the owner and sees every availability row,
-- which is exactly the point: it counts them and throws the identities away
-- before returning. The result type is the security boundary, so keep it to
-- {slot, available} -- do not add a member_id, a name, or an array of who.
create or replace function public.availability_heatmap()
returns table (slot smallint, available integer)
language sql
stable
security definer
set search_path = ''
as $$
  select a.slot, count(*)::int as available
  from public.availability a
  group by a.slot
  order by a.slot;
$$;

revoke all on function public.availability_heatmap() from public;
grant execute on function public.availability_heatmap() to anon, authenticated;

-- Denominators for the heatmap, aggregated the same way and for the same
-- reason. respondents (people who logged anything) is the honest denominator
-- for "how much of the group is free"; members is shown alongside it so a low
-- response rate is visible rather than reading as low availability.
create or replace function public.availability_stats()
returns table (members integer, respondents integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*)::int from public.members),
    (select count(distinct a.member_id)::int from public.availability a);
$$;

revoke all on function public.availability_stats() from public;
grant execute on function public.availability_stats() to anon, authenticated;
