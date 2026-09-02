-- BattyRaid, migration 003 -- make character claims visible to the company.
--
-- 001 gave raid_characters a self-or-leader SELECT policy, matching how
-- raid_availability is treated. That was the wrong analogy. A claim is not a
-- schedule: it is the mapping from a Discord login to an FFXIV character, and
-- its entire purpose is for the rest of the company to know who is who. An
-- event roster that reads "cedho_1998 — Tank" instead of "Cedho Nalen — Tank"
-- has thrown away the only thing linking a character was for.
--
-- So SELECT opens to every signed-in member. Note what does NOT change:
--
--   * WRITES stay exactly as they were. A member may claim and unclaim only
--     their own characters (raid_characters_insert_self / _delete_self), and
--     only a leader may touch someone else's to correct a bad claim
--     (raid_characters_all_leader). Self-asserted, leader-correctable, as
--     specified.
--   * anon still holds no privilege on the table at all -- the REVOKE in 001
--     stands, so the anonymous public learns no names here any more than it
--     does anywhere else.
--   * raid_availability and raid_event_responses are untouched. Knowing which
--     character somebody plays says nothing about when they are free.
--
-- This needs no new view. Unlike raid_member_directory in 002, there are no
-- columns here to hold back -- id, member_id, lodestone_id, character_name and
-- world are all things the claim exists to publish -- so a plain policy does
-- the job and the schema gains no third RLS-bypassing object.

drop policy raid_characters_select_self on public.raid_characters;

create policy raid_characters_select on public.raid_characters
  for select to authenticated
  using (true);

comment on table public.raid_characters is
  'Self-asserted FFXIV character claims. Readable by every member (that is the point); writable only by the claimant, or by a leader correcting a bad claim.';
