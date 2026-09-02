-- LOCAL TEST HARNESS ONLY. Run after 01_rls_proof.sql, which seeds the members
-- and leaves test.as_role() in place.
--
-- Proves the event layer in 002_events.sql, and in particular the escalation it
-- is designed to prevent: creating an event must NOT become a way to read the
-- company's named weekly availability.
--
-- Cast:
--   Batty   11111111...  leader
--   Cedho   22222222...  member -- creates the event
--   Tataru  33333333...  member -- responds to it
--   Yshtola 55555555...  member -- uninvolved, must learn nothing

\set ON_ERROR_STOP on

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('55555555-5555-5555-5555-555555555555', 'yshtola@example.com', '{"provider":"discord"}',
   '{"provider_id":"100000000000000005","full_name":"Yshtola"}');

-- 01_rls_proof.sql ends with Batty promoting Tataru, to prove a leader can
-- promote. Put her back to 'member' so the cast below is unambiguous -- several
-- cases here turn on the difference between a plain member and a leader, and a
-- second leader in the fixture would quietly make them pass for the wrong
-- reason. Done as the owner (auth.uid() IS NULL = privileged).
update public.raid_members set role = 'member'
  where discord_id = '100000000000000003';

\echo ''
\echo '=== cast ==='
select display_name, role from public.raid_members order by display_name;

-- Cedho creates a poll-mode event, through the policies.
select test.as_role('authenticated', '22222222-2222-2222-2222-222222222222', $q$
  with e as (
    insert into public.raid_events
      (id, created_by, title, event_type, tanks_needed, healers_needed, dps_needed,
       party_size, mode, poll_start)
    values ('aaaaaaaa-0000-0000-0000-00000000aaaa',
            '22222222-2222-2222-2222-222222222222',
            'Savage reclear', 'savage', 2, 2, 4, 8, 'poll', date '2026-09-07')
    returning title
  ) select title from e
$q$) as "member created an event";

select test.as_role('authenticated', '22222222-2222-2222-2222-222222222222', $q$
  with s as (
    insert into public.raid_event_signups (event_id, member_id, roles)
    values ('aaaaaaaa-0000-0000-0000-00000000aaaa',
            '22222222-2222-2222-2222-222222222222', array['healer'])
    returning 1),
  r as (
    insert into public.raid_event_responses (event_id, member_id, starts_at)
    select 'aaaaaaaa-0000-0000-0000-00000000aaaa',
           '22222222-2222-2222-2222-222222222222',
           unnest(array[timestamptz '2026-09-08 23:00+00', timestamptz '2026-09-09 23:00+00'])
    returning 1)
  select (select count(*) from s) || ' signup, ' || (select count(*) from r) || ' hours'
$q$) as "creator signed up + marked hours";

select test.as_role('authenticated', '33333333-3333-3333-3333-333333333333', $q$
  with s as (
    insert into public.raid_event_signups (event_id, member_id, roles)
    values ('aaaaaaaa-0000-0000-0000-00000000aaaa',
            '33333333-3333-3333-3333-333333333333', array['tank','dps'])
    returning 1),
  r as (
    insert into public.raid_event_responses (event_id, member_id, starts_at)
    select 'aaaaaaaa-0000-0000-0000-00000000aaaa',
           '33333333-3333-3333-3333-333333333333',
           unnest(array[timestamptz '2026-09-08 23:00+00'])
    returning 1)
  select (select count(*) from s) || ' signup, ' || (select count(*) from r) || ' hours'
$q$) as "responder signed up + marked hours";

\echo ''
\echo '=== F. THE ESCALATION: does creating an event leak the weekly grid? ==='
\echo '    Yshtola creates her own event, then tries to read what 001 protects.'

select test.as_role('authenticated', '55555555-5555-5555-5555-555555555555', $q$
  with e as (
    insert into public.raid_events (id, created_by, title, mode, scheduled_at, status)
    values ('bbbbbbbb-0000-0000-0000-00000000bbbb',
            '55555555-5555-5555-5555-555555555555',
            'Totally normal event', 'fixed', timestamptz '2026-09-10 23:00+00', 'scheduled')
    returning title
  ) select title from e
$q$) as "outsider created her own event";

select 'read raid_availability by name' as attempt,
       test.as_role('authenticated', '55555555-5555-5555-5555-555555555555',
         $q$ select coalesce(string_agg(distinct m.display_name, ', '), '(no rows)')
             from public.raid_availability a
             join public.raid_member_directory m on m.id = a.member_id $q$) as result
union all select 'read raid_availability row count',
       test.as_role('authenticated', '55555555-5555-5555-5555-555555555555',
         $q$ select count(*)::text from public.raid_availability $q$)
union all select 'read the OTHER event''s responses',
       test.as_role('authenticated', '55555555-5555-5555-5555-555555555555',
         $q$ select count(*)::text from public.raid_event_responses
             where event_id = 'aaaaaaaa-0000-0000-0000-00000000aaaa' $q$)
union all select 'edit someone else''s event',
       test.as_role('authenticated', '55555555-5555-5555-5555-555555555555',
         $q$ with u as (update public.raid_events set title = 'hijacked'
             where id = 'aaaaaaaa-0000-0000-0000-00000000aaaa' returning title)
             select coalesce(string_agg(title, ','), '0 rows affected') from u $q$)
union all select 'delete someone else''s event',
       test.as_role('authenticated', '55555555-5555-5555-5555-555555555555',
         $q$ with d as (delete from public.raid_events
             where id = 'aaaaaaaa-0000-0000-0000-00000000aaaa' returning 1)
             select count(*)::text || ' deleted' from d $q$)
union all select 'hand own event to another creator (guard pins it)',
       test.as_role('authenticated', '55555555-5555-5555-5555-555555555555',
         $q$ with u as (update public.raid_events
             set created_by = '11111111-1111-1111-1111-111111111111'
             where id = 'bbbbbbbb-0000-0000-0000-00000000bbbb'
             returning (created_by = '55555555-5555-5555-5555-555555555555')::text)
             select 'still hers: ' || u.bool from u u(bool) $q$);

\echo ''
\echo '=== G. responses: responder, creator and leader -- nobody else ==='

select 'creator (Cedho) sees named responses' as attempt,
       test.as_role('authenticated', '22222222-2222-2222-2222-222222222222',
         $q$ select string_agg(m.display_name || '@' || to_char(r.starts_at at time zone 'UTC','Dy HH24h'), ', '
                               order by m.display_name, r.starts_at)
             from public.raid_event_responses r
             join public.raid_member_directory m on m.id = r.member_id
             where r.event_id = 'aaaaaaaa-0000-0000-0000-00000000aaaa' $q$) as result
union all select 'leader (Batty) sees named responses',
       test.as_role('authenticated', '11111111-1111-1111-1111-111111111111',
         $q$ select string_agg(distinct m.display_name, ', ')
             from public.raid_event_responses r
             join public.raid_member_directory m on m.id = r.member_id
             where r.event_id = 'aaaaaaaa-0000-0000-0000-00000000aaaa' $q$)
union all select 'responder (Tataru) sees only her own',
       test.as_role('authenticated', '33333333-3333-3333-3333-333333333333',
         $q$ select coalesce(string_agg(distinct m.display_name, ', '), '(no rows)')
             from public.raid_event_responses r
             join public.raid_member_directory m on m.id = r.member_id
             where r.event_id = 'aaaaaaaa-0000-0000-0000-00000000aaaa' $q$)
union all select 'uninvolved member (Yshtola) sees none',
       test.as_role('authenticated', '55555555-5555-5555-5555-555555555555',
         $q$ select coalesce(string_agg(member_id::text, ', '), '(no rows)')
             from public.raid_event_responses
             where event_id = 'aaaaaaaa-0000-0000-0000-00000000aaaa' $q$)
union all select 'Yshtola signs up, then tries again',
       test.as_role('authenticated', '55555555-5555-5555-5555-555555555555',
         $q$ with s as (insert into public.raid_event_signups (event_id, member_id, roles)
             values ('aaaaaaaa-0000-0000-0000-00000000aaaa',
                     '55555555-5555-5555-5555-555555555555', array['dps'])
             returning 1)
             select (select count(*) from s)::text ||
                    ' signup; other members'' responses visible: ' ||
                    (select count(*) from public.raid_event_responses
                     where event_id = 'aaaaaaaa-0000-0000-0000-00000000aaaa'
                       and member_id <> '55555555-5555-5555-5555-555555555555')::text $q$);

\echo ''
\echo '=== H. signups are shared; assigned_role is the manager''s alone ==='

select 'plain member sees the full roster, by name' as attempt,
       test.as_role('authenticated', '55555555-5555-5555-5555-555555555555',
         $q$ select string_agg(m.display_name || ' [' || array_to_string(s.roles, '/') || ']', ', '
                               order by s.seq)
             from public.raid_event_signups s
             join public.raid_member_directory m on m.id = s.member_id
             where s.event_id = 'aaaaaaaa-0000-0000-0000-00000000aaaa' $q$) as result
union all select 'signup order is stable (by seq)',
       test.as_role('authenticated', '55555555-5555-5555-5555-555555555555',
         $q$ select string_agg(m.display_name, ' -> ' order by s.seq)
             from public.raid_event_signups s
             join public.raid_member_directory m on m.id = s.member_id
             where s.event_id = 'aaaaaaaa-0000-0000-0000-00000000aaaa' $q$)
union all select 'plain member pins their OWN assigned_role',
       test.as_role('authenticated', '55555555-5555-5555-5555-555555555555',
         $q$ with u as (update public.raid_event_signups set assigned_role = 'tank'
             where event_id = 'aaaaaaaa-0000-0000-0000-00000000aaaa'
               and member_id = '55555555-5555-5555-5555-555555555555'
             returning coalesce(assigned_role, '(still null)'))
             select * from u $q$)
union all select 'plain member edits ANOTHER member''s signup',
       test.as_role('authenticated', '55555555-5555-5555-5555-555555555555',
         $q$ with u as (update public.raid_event_signups set roles = array['tank']
             where event_id = 'aaaaaaaa-0000-0000-0000-00000000aaaa'
               and member_id = '33333333-3333-3333-3333-333333333333'
             returning 1)
             select count(*)::text || ' rows affected' from u $q$)
union all select 'member changes their own roles (allowed)',
       test.as_role('authenticated', '33333333-3333-3333-3333-333333333333',
         $q$ with u as (update public.raid_event_signups set roles = array['tank','healer']
             where event_id = 'aaaaaaaa-0000-0000-0000-00000000aaaa'
               and member_id = '33333333-3333-3333-3333-333333333333'
             returning array_to_string(roles, '/'))
             select * from u $q$)
union all select 'creator pins a member''s assigned_role',
       test.as_role('authenticated', '22222222-2222-2222-2222-222222222222',
         $q$ with u as (update public.raid_event_signups set assigned_role = 'tank'
             where event_id = 'aaaaaaaa-0000-0000-0000-00000000aaaa'
               and member_id = '33333333-3333-3333-3333-333333333333'
             returning coalesce(assigned_role, '(null)'))
             select * from u $q$)
union all select 'member signs up AS someone else',
       test.as_role('authenticated', '55555555-5555-5555-5555-555555555555',
         $q$ with s as (insert into public.raid_event_signups (event_id, member_id, roles)
             values ('bbbbbbbb-0000-0000-0000-00000000bbbb',
                     '33333333-3333-3333-3333-333333333333', array['dps'])
             returning 1) select count(*)::text from s $q$);

\echo ''
\echo '=== I. scheduling: creator locks a time; leader can manage any event ==='

select 'creator schedules the winning hour' as attempt,
       test.as_role('authenticated', '22222222-2222-2222-2222-222222222222',
         $q$ with u as (update public.raid_events
             set scheduled_at = timestamptz '2026-09-08 23:00+00', status = 'scheduled'
             where id = 'aaaaaaaa-0000-0000-0000-00000000aaaa'
             returning status || ' @ ' || to_char(scheduled_at at time zone 'UTC','YYYY-MM-DD HH24:00'))
             select * from u $q$) as result
union all select 'who is free at the chosen hour (creator view)',
       test.as_role('authenticated', '22222222-2222-2222-2222-222222222222',
         $q$ select string_agg(m.display_name, ', ' order by m.display_name)
             from public.raid_event_responses r
             join public.raid_member_directory m on m.id = r.member_id
             where r.event_id = 'aaaaaaaa-0000-0000-0000-00000000aaaa'
               and r.starts_at = timestamptz '2026-09-08 23:00+00' $q$)
union all select 'leader edits a member''s event',
       test.as_role('authenticated', '11111111-1111-1111-1111-111111111111',
         $q$ with u as (update public.raid_events set title = 'Savage reclear (moved)'
             where id = 'aaaaaaaa-0000-0000-0000-00000000aaaa' returning title)
             select * from u $q$)
union all select 'leader removes a no-show',
       test.as_role('authenticated', '11111111-1111-1111-1111-111111111111',
         $q$ with d as (delete from public.raid_event_signups
             where event_id = 'aaaaaaaa-0000-0000-0000-00000000aaaa'
               and member_id = '55555555-5555-5555-5555-555555555555' returning 1)
             select count(*)::text || ' removed' from d $q$);

\echo ''
\echo '=== J. the member directory exposes names -- and nothing else ==='

select 'a plain member can read the directory' as attempt,
       test.as_role('authenticated', '55555555-5555-5555-5555-555555555555',
         $q$ select string_agg(display_name, ', ' order by display_name)
             from public.raid_member_directory $q$) as result
union all select 'the directory carries no discord_id column',
       test.as_role('authenticated', '55555555-5555-5555-5555-555555555555',
         $q$ select coalesce(string_agg(column_name, ', ' order by ordinal_position), '(none)')
             from information_schema.columns
             where table_schema = 'public' and table_name = 'raid_member_directory' $q$)
union all select 'raid_members itself is still self-only',
       test.as_role('authenticated', '55555555-5555-5555-5555-555555555555',
         $q$ select string_agg(display_name, ', ') from public.raid_members $q$)
union all select 'and it still yields no availability',
       test.as_role('authenticated', '55555555-5555-5555-5555-555555555555',
         $q$ select count(*)::text || ' availability rows'
             from public.raid_member_directory m
             join public.raid_availability a on a.member_id = m.id $q$);

\echo ''
\echo '=== K. the anonymous public gained nothing from any of this ==='

select 'read raid_events' as attempt,
       test.as_role('anon', null, $q$ select count(*)::text from public.raid_events $q$) as result
union all select 'read raid_event_signups',
       test.as_role('anon', null, $q$ select count(*)::text from public.raid_event_signups $q$)
union all select 'read raid_event_responses',
       test.as_role('anon', null, $q$ select count(*)::text from public.raid_event_responses $q$)
union all select 'read raid_event_types',
       test.as_role('anon', null, $q$ select count(*)::text from public.raid_event_types $q$)
union all select 'read raid_member_directory',
       test.as_role('anon', null, $q$ select count(*)::text from public.raid_member_directory $q$)
union all select 'call raid_can_manage_event()',
       test.as_role('anon', null,
         $q$ select public.raid_can_manage_event('aaaaaaaa-0000-0000-0000-00000000aaaa')::text $q$)
union all select 'still gets the weekly heatmap, counts only',
       test.as_role('anon', null,
         $q$ select string_agg(slot || ':' || available, '  ' order by slot) from public.raid_heatmap() $q$);

\echo ''
\echo '=== L. character claims after 003: readable by all, writable by few ==='

-- Tataru claims a character of her own, so there are two claims in play.
select test.as_role('authenticated', '33333333-3333-3333-3333-333333333333', $q$
  with i as (insert into public.raid_characters (member_id, lodestone_id, character_name, world)
    values ('33333333-3333-3333-3333-333333333333', '27685561', 'Azathio Magnus', 'Malboro')
    returning 1) select count(*)::text from i
$q$) as "member claimed a character";

select 'a plain member reads every claim' as attempt,
       test.as_role('authenticated', '55555555-5555-5555-5555-555555555555',
         $q$ select string_agg(character_name, ', ' order by character_name)
             from public.raid_characters $q$) as result
union all select 'and can join them to names for a roster',
       test.as_role('authenticated', '55555555-5555-5555-5555-555555555555',
         $q$ select string_agg(m.display_name || ' = ' || c.character_name, ', ' order by c.character_name)
             from public.raid_characters c
             join public.raid_member_directory m on m.id = c.member_id $q$)
union all select 'but cannot claim a character FOR someone else',
       test.as_role('authenticated', '55555555-5555-5555-5555-555555555555',
         $q$ with i as (insert into public.raid_characters (member_id, lodestone_id, character_name, world)
             values ('33333333-3333-3333-3333-333333333333', '9999999', 'Impostor Mcfake', 'Malboro')
             returning 1) select count(*)::text from i $q$)
union all select 'and cannot unclaim someone else''s',
       test.as_role('authenticated', '55555555-5555-5555-5555-555555555555',
         $q$ with d as (delete from public.raid_characters
             where member_id = '33333333-3333-3333-3333-333333333333' returning 1)
             select count(*)::text || ' deleted' from d $q$)
union all select 'a second claim on the same character is refused',
       test.as_role('authenticated', '55555555-5555-5555-5555-555555555555',
         $q$ with i as (insert into public.raid_characters (member_id, lodestone_id, character_name, world)
             values ('55555555-5555-5555-5555-555555555555', '27685561', 'Azathio Magnus', 'Malboro')
             returning 1) select count(*)::text from i $q$)
union all select 'a leader corrects a bad claim',
       test.as_role('authenticated', '11111111-1111-1111-1111-111111111111',
         $q$ with u as (update public.raid_characters
             set member_id = '55555555-5555-5555-5555-555555555555'
             where lodestone_id = '27685561' returning character_name)
             select * from u $q$)
union all select 'a leader removes one entirely',
       test.as_role('authenticated', '11111111-1111-1111-1111-111111111111',
         $q$ with d as (delete from public.raid_characters
             where lodestone_id = '27685561' returning 1)
             select count(*)::text || ' deleted' from d $q$)
union all select 'anon still gets nothing',
       test.as_role('anon', null, $q$ select count(*)::text from public.raid_characters $q$)
union all select 'and a claim still reveals no availability',
       test.as_role('authenticated', '55555555-5555-5555-5555-555555555555',
         $q$ select count(*)::text || ' availability rows'
             from public.raid_characters c
             join public.raid_availability a on a.member_id = c.member_id $q$);
