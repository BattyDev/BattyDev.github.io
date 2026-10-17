-- FC Events, migration 007 -- the read surface for Discord slash commands.
--
-- WHAT IS DIFFERENT ABOUT THIS CALLER
--
-- Every other path into this database arrives with a Supabase JWT, so
-- auth.uid() answers "who is this" and the policies do the rest. A Discord
-- interaction has no JWT and never will: Discord posts to an HTTPS endpoint and
-- proves authenticity with an Ed25519 signature over the request body. The only
-- identity in that payload is a Discord user id.
--
-- So the Edge Function has to say "this is Discord user 1234" rather than
-- presenting a token. That is an ASSERTION, and the whole security question
-- here is who is allowed to make it.
--
-- WHY THIS IS SECURITY DEFINER AND GRANTED TO service_role ALONE
--
-- A function taking a discord_id as a parameter is, by construction, a function
-- that impersonates. If authenticated could call it, any signed-in member could
-- pass somebody else's Discord id and read as them. If anon could call it,
-- anyone on the internet could. PostgREST publishes anything EXECUTE-able at
-- /rpc/, and Supabase's default privileges hand EXECUTE to anon and
-- authenticated on every new function in public -- the same trap 001 documents
-- for raid_is_leader().
--
-- The grant below is therefore service_role only, reachable exclusively from
-- inside an Edge Function holding the service key. The trust boundary is the
-- Ed25519 check in that function: it is what turns "the body says user 1234"
-- into "Discord says user 1234". Nothing else may cross it.
--
-- WHY THE FUNCTION AND NOT THE FUNCTION'S CALLER DECIDES
--
-- The alternative was to let the Edge Function query with the service key and
-- filter in TypeScript. That would put the visibility rules in two places, in
-- two languages, free to drift -- and the rule for this project has been that
-- the database decides. So the SQL below re-states, in one place, exactly what
-- a signed-in member may see: events are FC-wide (raid_events_select is
-- `using (true)` for authenticated), and a person who has never signed in to
-- the site is not a member and sees nothing at all.
--
-- Note what is NOT here: no availability, no poll responses, no other member's
-- rows. The consent boundary from 002 is not weakened by adding a new
-- transport; a Discord command can reach strictly less than the page can.

-- ---------------------------------------------------------------------------
-- raid_discord_events -- what /events answers with
-- ---------------------------------------------------------------------------
-- Returns one jsonb document rather than a row set. The caller is building a
-- Discord embed inside a three-second reply window, and one round trip that
-- returns exactly the shape the embed needs beats three that have to be
-- stitched together in Deno.
--
-- The `linked` flag exists so the command can tell "you have never signed in"
-- apart from "there is nothing on". Both are empty lists; they need very
-- different replies, and deciding which in TypeScript would mean the Edge
-- Function guessing at membership -- the thing this function exists to answer.
create or replace function public.raid_discord_events(
  p_discord_id text,
  p_limit      int default 10
)
returns jsonb
language sql
stable
security definer
-- Pinned: a SECURITY DEFINER function that resolves unqualified names through
-- a caller-controlled search_path is the classic privilege-escalation route.
set search_path = public, pg_temp
as $$
  with me as (
    select id, display_name, role
    from public.raid_members
    where discord_id = p_discord_id
  ),
  upcoming as (
    select e.*
    from public.raid_events e
    where exists (select 1 from me)
      and e.status <> 'cancelled'
      -- An event an hour past its start is still the one people are asking
      -- about; one from last month is noise. Unscheduled events have no time
      -- to compare and are always current until somebody cancels them.
      and (e.scheduled_at is null or e.scheduled_at >= now() - interval '1 hour')
    order by
      -- Scheduled events first, soonest first; then polls still gathering
      -- times, oldest first, because those are the ones waiting on somebody.
      e.scheduled_at asc nulls last,
      e.created_at asc
    limit greatest(1, least(coalesce(p_limit, 10), 25))
  )
  select jsonb_build_object(
    'linked', exists (select 1 from me),
    'display_name', (select display_name from me),
    'is_leader', coalesce((select role = 'leader' from me), false),
    'events', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id',           u.id,
            'title',        u.title,
            'status',       u.status,
            'mode',         u.mode,
            'scheduled_at', u.scheduled_at,
            'min_level',    u.min_level,
            'level_rule',   u.level_rule,
            'tanks_needed',   u.tanks_needed,
            'healers_needed', u.healers_needed,
            'dps_needed',     u.dps_needed,
            'party_size',   u.party_size,
            'signups',      (select count(*) from public.raid_event_signups s
                             where s.event_id = u.id),
            -- Whether the ASKER is already on it, so the reply can say so
            -- rather than making them go and look.
            'signed_up',    exists (select 1 from public.raid_event_signups s
                                    where s.event_id = u.id
                                      and s.member_id = (select id from me))
          )
          -- jsonb_agg over an ordered subquery does not inherit the CTE's
          -- ORDER BY; state it again or the embed comes out shuffled.
          order by u.scheduled_at asc nulls last, u.created_at asc
        )
        from upcoming u
      ),
      '[]'::jsonb
    )
  );
$$;

comment on function public.raid_discord_events(text, int) is
  'Read surface for the Discord /events command. Takes an ASSERTED Discord user id, so it is granted to service_role only -- the Ed25519 check in the discord-interactions Edge Function is what makes the assertion trustworthy.';

-- The whole point. Revoke the default grants before granting the one role that
-- should have it: revoking from PUBLIC alone leaves anon and authenticated
-- holding their own explicit grants.
revoke all on function public.raid_discord_events(text, int)
  from public, anon, authenticated;
grant execute on function public.raid_discord_events(text, int) to service_role;
