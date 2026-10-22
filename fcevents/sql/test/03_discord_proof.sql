-- LOCAL TEST HARNESS ONLY. Run after 01_rls_proof.sql and 02_events_proof.sql,
-- which seed the members and leave test.as_role() in place.
--
-- Proves 007_discord_interactions.sql, and above all the thing that migration
-- is designed to prevent: raid_discord_events() takes an ASSERTED identity, so
-- if anybody but service_role can call it, it is an impersonation oracle.
--
-- Cast (discord_id, as provisioned by the auth trigger from provider_id):
--   Batty   100000000000000001  leader
--   Cedho   100000000000000002  member
--   Tataru  100000000000000003  member
--   Yshtola 100000000000000005  member

\set ON_ERROR_STOP on

-- Clean slate, as the table owner. 02 leaves events behind whose exact number
-- is not this file's business, and the counts below should be readable.
delete from public.raid_events;

-- Seed through the policies, as real members would, so the fixture cannot pass
-- for a reason the application could not reproduce.
select test.as_role('authenticated', '22222222-2222-2222-2222-222222222222', $q$
  with e as (
    insert into public.raid_events
      (id, created_by, title, event_type, tanks_needed, healers_needed, dps_needed,
       party_size, mode, scheduled_at, status, min_level, level_rule)
    values
      -- soonest
      ('bbbb0001-0000-0000-0000-00000000bbbb',
       '22222222-2222-2222-2222-222222222222', 'Soonest fixed', 'savage',
       2, 2, 4, 8, 'fixed', now() + interval '2 days', 'scheduled', 100, 'required'),
      -- later
      ('bbbb0002-0000-0000-0000-00000000bbbb',
       '22222222-2222-2222-2222-222222222222', 'Later fixed', 'savage',
       1, 1, 2, 4, 'fixed', now() + interval '9 days', 'scheduled', null, 'recommended'),
      -- cancelled: must never appear
      ('bbbb0003-0000-0000-0000-00000000bbbb',
       '22222222-2222-2222-2222-222222222222', 'Cancelled one', 'savage',
       2, 2, 4, 8, 'fixed', now() + interval '3 days', 'cancelled', null, 'recommended'),
      -- long past: must never appear
      ('bbbb0004-0000-0000-0000-00000000bbbb',
       '22222222-2222-2222-2222-222222222222', 'Last month', 'savage',
       2, 2, 4, 8, 'fixed', now() - interval '30 days', 'scheduled', null, 'recommended')
    returning 1)
  select count(*)::text || ' events' from e
$q$) as "fixture: four events created through the policies";

-- A poll with no time yet. Separate statement: it is 'open', not 'scheduled',
-- and mixing it above would trip raid_events_fixed_has_time.
select test.as_role('authenticated', '33333333-3333-3333-3333-333333333333', $q$
  with e as (
    insert into public.raid_events
      (id, created_by, title, mode, poll_start, status)
    values ('bbbb0005-0000-0000-0000-00000000bbbb',
            '33333333-3333-3333-3333-333333333333', 'Undated poll', 'poll',
            current_date, 'open')
    returning 1)
  select count(*)::text || ' event' from e
$q$) as "fixture: a poll with no time yet";

-- Cedho signs up to the soonest one. Yshtola does not.
select test.as_role('authenticated', '22222222-2222-2222-2222-222222222222', $q$
  with s as (
    insert into public.raid_event_signups (event_id, member_id, roles)
    values ('bbbb0001-0000-0000-0000-00000000bbbb',
            '22222222-2222-2222-2222-222222222222', array['healer'])
    returning 1)
  select count(*)::text || ' signup' from s
$q$) as "fixture: Cedho signed up to the soonest";

\echo ''
\echo '=== A. who may make an identity assertion at all ==='
-- The whole migration turns on these three rows. A PASS on the first two is
-- what stops the function being a way to read as somebody else.
select 'anon calls it' as case,
       test.as_role('anon', null,
         $q$ select public.raid_discord_events('100000000000000001')::text $q$) as result
union all
select 'a signed-in member calls it directly',
       test.as_role('authenticated', '33333333-3333-3333-3333-333333333333',
         $q$ select public.raid_discord_events('100000000000000001')::text $q$)
union all
select 'a LEADER calls it directly (still no)',
       test.as_role('authenticated', '11111111-1111-1111-1111-111111111111',
         $q$ select public.raid_discord_events('100000000000000002')::text $q$)
union all
select 'service_role calls it',
       test.as_role('service_role', null,
         $q$ select (public.raid_discord_events('100000000000000002') ->> 'linked') $q$);

\echo ''
\echo '=== B. an unlinked Discord user learns nothing ==='
select 'linked flag' as case,
       test.as_role('service_role', null,
         $q$ select (public.raid_discord_events('999999999999999999') ->> 'linked') $q$) as result
union all
select 'events returned',
       test.as_role('service_role', null,
         $q$ select jsonb_array_length(public.raid_discord_events('999999999999999999') -> 'events')::text $q$)
union all
select 'display_name returned',
       test.as_role('service_role', null,
         $q$ select coalesce(public.raid_discord_events('999999999999999999') ->> 'display_name', '(null)') $q$);

\echo ''
\echo '=== C. a member sees the FC-wide event list ==='
select 'linked' as case,
       test.as_role('service_role', null,
         $q$ select (public.raid_discord_events('100000000000000005') ->> 'linked') $q$) as result
union all
select 'name comes from the database, not the caller',
       test.as_role('service_role', null,
         $q$ select (public.raid_discord_events('100000000000000005') ->> 'display_name') $q$)
union all
select 'cancelled and long-past excluded (5 seeded, 3 live)',
       test.as_role('service_role', null,
         $q$ select jsonb_array_length(public.raid_discord_events('100000000000000005') -> 'events')::text $q$)
union all
select 'soonest first',
       test.as_role('service_role', null,
         $q$ select public.raid_discord_events('100000000000000005') -> 'events' -> 0 ->> 'title' $q$)
union all
select 'then the later one',
       test.as_role('service_role', null,
         $q$ select public.raid_discord_events('100000000000000005') -> 'events' -> 1 ->> 'title' $q$)
union all
select 'undated poll last',
       test.as_role('service_role', null,
         $q$ select public.raid_discord_events('100000000000000005') -> 'events' -> 2 ->> 'title' $q$)
union all
select 'no cancelled event anywhere in the list',
       test.as_role('service_role', null,
         $q$ select case when public.raid_discord_events('100000000000000005')::text like '%Cancelled one%'
                         then 'LEAKED' else 'absent' end $q$);

\echo ''
\echo '=== D. is_leader and signed_up are about the ASKER ==='
select 'Batty is a leader' as case,
       test.as_role('service_role', null,
         $q$ select (public.raid_discord_events('100000000000000001') ->> 'is_leader') $q$) as result
union all
select 'Yshtola is not',
       test.as_role('service_role', null,
         $q$ select (public.raid_discord_events('100000000000000005') ->> 'is_leader') $q$)
union all
select 'Cedho is on the soonest event',
       test.as_role('service_role', null,
         $q$ select public.raid_discord_events('100000000000000002') -> 'events' -> 0 ->> 'signed_up' $q$)
union all
select 'Yshtola is not, on the same event',
       test.as_role('service_role', null,
         $q$ select public.raid_discord_events('100000000000000005') -> 'events' -> 0 ->> 'signed_up' $q$)
union all
select 'but both see the same signup COUNT',
       test.as_role('service_role', null,
         $q$ select (public.raid_discord_events('100000000000000002') -> 'events' -> 0 ->> 'signups')
                 || '/' ||
                    (public.raid_discord_events('100000000000000005') -> 'events' -> 0 ->> 'signups') $q$);

\echo ''
\echo '=== E. the consent boundary is not widened by a new transport ==='
-- 002 is emphatic that one member may not read another member's poll hours.
-- This function must not become the back door. It returns no availability and
-- no responses at all -- assert on the whole document, not on a column list,
-- so adding a leaky key later fails this test.
select 'no availability in the payload' as case,
       test.as_role('service_role', null,
         $q$ select case when public.raid_discord_events('100000000000000001')::text
                              ~* '(availability|starts_at|response|slot)'
                         then 'LEAKED' else 'absent' end $q$) as result
union all
select 'no member ids of other people',
       test.as_role('service_role', null,
         $q$ select case when public.raid_discord_events('100000000000000005')::text
                              like '%22222222-2222-2222-2222-222222222222%'
                         then 'LEAKED' else 'absent' end $q$)
union all
select 'no discord ids echoed back',
       test.as_role('service_role', null,
         $q$ select case when public.raid_discord_events('100000000000000005')::text
                              like '%1000000000000000%'
                         then 'LEAKED' else 'absent' end $q$);

\echo ''
\echo '=== F. the limit cannot be used to hammer the database ==='
select 'a huge limit is clamped to 25' as case,
       test.as_role('service_role', null,
         $q$ select jsonb_array_length(public.raid_discord_events('100000000000000005', 999) -> 'events')::text
                 || ' (of 3 live)' $q$) as result
union all
select 'zero is clamped up to 1',
       test.as_role('service_role', null,
         $q$ select jsonb_array_length(public.raid_discord_events('100000000000000005', 0) -> 'events')::text $q$)
union all
select 'a negative limit does not error',
       test.as_role('service_role', null,
         $q$ select jsonb_array_length(public.raid_discord_events('100000000000000005', -5) -> 'events')::text $q$)
union all
select 'null falls back to the default',
       test.as_role('service_role', null,
         $q$ select jsonb_array_length(public.raid_discord_events('100000000000000005', null) -> 'events')::text $q$);
