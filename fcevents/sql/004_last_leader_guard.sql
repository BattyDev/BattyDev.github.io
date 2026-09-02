-- BattyRaid, migration 004 -- refuse to remove the last leader.
--
-- Found by running the 001 proof against the live project with a real account.
-- raid_guard_member_role treats a leader as privileged, which is correct: a
-- leader may change roles. But it also means a leader can demote THEMSELVES,
-- and when there is only one leader that leaves the company with none. Nobody
-- can then promote anybody, because promotion requires being a leader, so the
-- only way back is the SQL editor. For a company that manages itself through
-- the page, that is a lockout.
--
-- It was never a security hole -- a member still cannot promote themselves, and
-- 01_rls_proof.sql covers that -- but it is a one-click, hard-to-reverse
-- mistake, which is worth a guard of its own.
--
-- The check applies only when there IS an end-user JWT, i.e. to the app. With
-- auth.uid() NULL -- the SQL editor, a migration, the service role -- the
-- demotion goes through, because those contexts are already privileged enough
-- to restore whatever they break and may legitimately be restructuring.
--
-- An exception rather than silently pinning the value, unlike the rest of this
-- trigger: the other guards quietly correct a write the caller had no business
-- attempting, whereas stepping down is a reasonable thing to try, and somebody
-- who tries it deserves to be told why it did not happen.

create or replace function public.raid_guard_member_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  privileged boolean := (select auth.uid()) is null or public.raid_is_leader();
begin
  if tg_op = 'INSERT' then
    if not privileged then
      new.role := 'member';
    end if;
  else
    if not privileged then
      new.role := old.role;
    end if;
    -- Identity columns are what every policy in this schema keys off. Pin them
    -- so no caller can re-point their row at someone else.
    new.id         := old.id;
    new.discord_id := old.discord_id;

    -- The last leader cannot step down from inside the app.
    if old.role = 'leader'
       and new.role is distinct from 'leader'
       and (select auth.uid()) is not null
       and not exists (
         select 1 from public.raid_members m
         where m.role = 'leader' and m.id <> old.id
       )
    then
      raise exception
        'cannot remove the last leader -- promote somebody else first'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.raid_guard_member_role() from public, anon, authenticated;
