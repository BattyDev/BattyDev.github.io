-- LOCAL TEST HARNESS ONLY.
--
-- Proves the visibility split in 001_schema.sql is enforced by the database
-- rather than by the page, using real Postgres role impersonation: each case
-- runs under SET LOCAL ROLE with a request.jwt.claims GUC standing in for the
-- caller's JWT, exactly as PostgREST sets it for a Supabase request.
--
-- What has to hold:
--   anon    -- no table access at all; the heatmap function and nothing else
--   member  -- reads and writes only their own rows, cannot reach anyone else's
--   leader  -- reads every row, and can correct another member's claim
--
-- Run: psql -f 00_supabase_shim.sql -f ../001_schema.sql -f 01_rls_proof.sql

\set ON_ERROR_STOP on

create schema if not exists test;

-- Runs one query under an impersonated role, returning either its single-value
-- result or the error it raised. The plpgsql exception block gives each case an
-- implicit savepoint, so a permission denial fails that case instead of
-- aborting the whole script -- which is the point, since half these cases are
-- expected to be refused.
create or replace function test.as_role(as_role text, sub uuid, q text)
returns text
language plpgsql
as $$
declare
  res text;
begin
  begin
    perform set_config(
      'request.jwt.claims',
      case when sub is null then ''
           else json_build_object('sub', sub, 'role', as_role)::text end,
      true
    );
    execute format('set local role %I', as_role);
    execute q into res;
    reset role;
    return coalesce(res, '(null)');
  exception when others then
    reset role;
    return 'REFUSED: ' || split_part(replace(sqlerrm, E'\n', ' '), ' for ', 1);
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- seed
-- ---------------------------------------------------------------------------
-- Inserting into auth.users only -- public.raid_members rows come from the
-- on_auth_user_created_raid trigger, which is how a real Discord login provisions a
-- member. If the members rows appear below, that trigger works.
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'batty@example.com', '{"provider":"discord"}',
   '{"provider_id":"100000000000000001","full_name":"Batty","avatar_url":"https://cdn.discordapp.com/a1.png"}'),
  ('22222222-2222-2222-2222-222222222222', 'cedho@example.com', '{"provider":"discord"}',
   '{"provider_id":"100000000000000002","full_name":"Cedho Nalen","avatar_url":"https://cdn.discordapp.com/a2.png"}'),
  ('33333333-3333-3333-3333-333333333333', 'tataru@example.com', '{"provider":"discord"}',
   '{"provider_id":"100000000000000003","full_name":"Tataru","avatar_url":"https://cdn.discordapp.com/a3.png"}');

-- battydevsite is shared, so a signup through any other provider must NOT be
-- enrolled as an FC member. This one should leave no raid_members row behind.
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('44444444-4444-4444-4444-444444444444', 'someone@example.com', '{"provider":"email"}',
   '{"full_name":"Passer By"}');

-- Leader bootstrap, as the owner would do it from the SQL editor. auth.uid() is
-- NULL here, which guard_member_role() treats as a privileged context.
update public.raid_members set role = 'leader'
  where discord_id = '100000000000000001';

\echo ''
\echo '=== provisioning: members created by the auth.users trigger ==='
select discord_id, display_name, role from public.raid_members order by discord_id;

\echo '--- the non-Discord signup was not enrolled (expect 0) ---'
select count(*) as non_discord_members_created
from public.raid_members where id = '44444444-4444-4444-4444-444444444444';

-- Availability written by each member THROUGH THE POLICIES, not seeded as the
-- owner -- so these inserts are themselves the first test that a member can
-- write their own rows.
select test.as_role('authenticated', '11111111-1111-1111-1111-111111111111', $q$
  with ins as (
    insert into public.raid_availability (member_id, slot)
    select '11111111-1111-1111-1111-111111111111', unnest(array[42,43,44,90])
    returning 1
  ) select count(*)::text from ins
$q$) as "leader wrote own slots";

select test.as_role('authenticated', '22222222-2222-2222-2222-222222222222', $q$
  with ins as (
    insert into public.raid_availability (member_id, slot)
    select '22222222-2222-2222-2222-222222222222', unnest(array[42,43,66])
    returning 1
  ) select count(*)::text from ins
$q$) as "member A wrote own slots";

select test.as_role('authenticated', '33333333-3333-3333-3333-333333333333', $q$
  with ins as (
    insert into public.raid_availability (member_id, slot)
    select '33333333-3333-3333-3333-333333333333', unnest(array[42,90])
    returning 1
  ) select count(*)::text from ins
$q$) as "member B wrote own slots";

-- A character claim each, for the leader-correction case further down.
select test.as_role('authenticated', '22222222-2222-2222-2222-222222222222', $q$
  with ins as (
    insert into public.raid_characters (member_id, lodestone_id, character_name, world)
    values ('22222222-2222-2222-2222-222222222222', '2299082', 'Cedho Nalen', 'Malboro')
    returning 1
  ) select count(*)::text from ins
$q$) as "member A claimed a character";

\echo ''
\echo '=== ground truth (as owner, RLS bypassed) ==='
select m.display_name, m.role, count(a.slot) as slots
from public.raid_members m
left join public.raid_availability a on a.member_id = m.id
group by m.display_name, m.role order by m.display_name;

-- ---------------------------------------------------------------------------
-- the proof
-- ---------------------------------------------------------------------------
\echo ''
\echo '=== A. anonymous public ==='

select 'read availability rows' as attempt,
       test.as_role('anon', null,
         $q$ select count(*)::text from public.raid_availability $q$) as result
union all select 'read members',
       test.as_role('anon', null,
         $q$ select count(*)::text from public.raid_members $q$)
union all select 'read characters',
       test.as_role('anon', null,
         $q$ select count(*)::text from public.raid_characters $q$)
union all select 'call raid_is_leader()',
       test.as_role('anon', null,
         $q$ select public.raid_is_leader()::text $q$)
union all select 'call raid_heatmap()  <- the one allowed path',
       test.as_role('anon', null,
         $q$ select string_agg(slot || ':' || available, '  ' order by slot)
             from public.raid_heatmap() $q$)
union all select 'call raid_stats()',
       test.as_role('anon', null,
         $q$ select 'members=' || members || ' respondents=' || respondents
             from public.raid_stats() $q$);

\echo ''
\echo '--- what the heatmap function actually returns (its whole result type) ---'
select * from public.raid_heatmap();

\echo ''
\echo '=== B. member A (Cedho, role=member) ==='

select 'SELECT * FROM availability (unfiltered)' as attempt,
       test.as_role('authenticated', '22222222-2222-2222-2222-222222222222',
         $q$ select coalesce(string_agg(distinct m.display_name, ', '), '(no rows)')
             from public.raid_availability a join public.raid_members m on m.id = a.member_id $q$) as "whose rows come back"
union all select 'own slot count',
       test.as_role('authenticated', '22222222-2222-2222-2222-222222222222',
         $q$ select count(*)::text from public.raid_availability $q$)
union all select 'SELECT * FROM members (unfiltered)',
       test.as_role('authenticated', '22222222-2222-2222-2222-222222222222',
         $q$ select string_agg(display_name, ', ' order by display_name) from public.raid_members $q$)
union all select 'read member B''s rows by explicit id',
       test.as_role('authenticated', '22222222-2222-2222-2222-222222222222',
         $q$ select count(*)::text from public.raid_availability
             where member_id = '33333333-3333-3333-3333-333333333333' $q$)
union all select 'INSERT a slot for member B',
       test.as_role('authenticated', '22222222-2222-2222-2222-222222222222',
         $q$ with ins as (insert into public.raid_availability (member_id, slot)
             values ('33333333-3333-3333-3333-333333333333', 7) returning 1)
             select count(*)::text from ins $q$)
union all select 'DELETE member B''s rows',
       test.as_role('authenticated', '22222222-2222-2222-2222-222222222222',
         $q$ with del as (delete from public.raid_availability
             where member_id = '33333333-3333-3333-3333-333333333333' returning 1)
             select count(*)::text from del $q$)
union all select 'self-promote to leader',
       test.as_role('authenticated', '22222222-2222-2222-2222-222222222222',
         $q$ with up as (update public.raid_members set role = 'leader'
             where id = '22222222-2222-2222-2222-222222222222' returning role)
             select role from up $q$)
union all select 'demote the actual leader',
       test.as_role('authenticated', '22222222-2222-2222-2222-222222222222',
         $q$ with up as (update public.raid_members set role = 'member'
             where id = '11111111-1111-1111-1111-111111111111' returning role)
             select coalesce(string_agg(role, ','), '0 rows affected') from up $q$)
union all select 'read another member''s character claim',
       test.as_role('authenticated', '33333333-3333-3333-3333-333333333333',
         $q$ select coalesce(string_agg(character_name, ', '), '(no rows)')
             from public.raid_characters $q$);

\echo ''
\echo '=== C. leader (Batty, role=leader) ==='

select 'SELECT * FROM availability (unfiltered)' as attempt,
       test.as_role('authenticated', '11111111-1111-1111-1111-111111111111',
         $q$ select string_agg(distinct m.display_name, ', ')
             from public.raid_availability a join public.raid_members m on m.id = a.member_id $q$) as result
union all select 'total rows visible',
       test.as_role('authenticated', '11111111-1111-1111-1111-111111111111',
         $q$ select count(*)::text from public.raid_availability $q$)
union all select 'SELECT * FROM members',
       test.as_role('authenticated', '11111111-1111-1111-1111-111111111111',
         $q$ select string_agg(display_name, ', ' order by display_name) from public.raid_members $q$)
union all select 'named availability for slot 42',
       test.as_role('authenticated', '11111111-1111-1111-1111-111111111111',
         $q$ select string_agg(m.display_name, ', ' order by m.display_name)
             from public.raid_availability a join public.raid_members m on m.id = a.member_id
             where a.slot = 42 $q$)
union all select 'correct a bad character claim (reassign to member B)',
       test.as_role('authenticated', '11111111-1111-1111-1111-111111111111',
         $q$ with up as (update public.raid_characters
             set member_id = '33333333-3333-3333-3333-333333333333'
             where lodestone_id = '2299082' returning character_name)
             select character_name from up $q$)
union all select 'promote member B to leader',
       test.as_role('authenticated', '11111111-1111-1111-1111-111111111111',
         $q$ with up as (update public.raid_members set role = 'leader'
             where id = '33333333-3333-3333-3333-333333333333' returning role)
             select role from up $q$);

\echo ''
\echo '=== D. after the leader reassigned it, member A can no longer see the claim ==='
select 'member A characters' as attempt,
       test.as_role('authenticated', '22222222-2222-2222-2222-222222222222',
         $q$ select coalesce(string_agg(character_name, ', '), '(no rows)')
             from public.raid_characters $q$) as result
union all select 'member B characters',
       test.as_role('authenticated', '33333333-3333-3333-3333-333333333333',
         $q$ select coalesce(string_agg(character_name, ', '), '(no rows)')
             from public.raid_characters $q$);

\echo ''
\echo '=== E. anon still sees only counts, after all of the above ==='
select test.as_role('anon', null,
  $q$ select string_agg(slot || ':' || available, '  ' order by slot)
      from public.raid_heatmap() $q$) as "anon heatmap";
