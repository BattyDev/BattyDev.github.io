-- FC Events, migration 006 -- preferred job order.
--
-- A character on the Lodestone carries every job it has ever levelled, in the
-- game's own order. That says nothing about what the person actually wants to
-- play: somebody with a capped Warrior they are bored of and a level 90 Sage
-- they are enjoying looks, to this site, like a tank. So a member can put their
-- own jobs in the order they would rather be asked to play them, and the page
-- reads the top of that list rather than guessing from levels.
--
-- Stored as an ordered array on the claim rather than as a table of (character,
-- job, position) rows. The order IS the value -- there is nothing else to say
-- about a job here, no per-row attributes to grow into, and reordering becomes
-- one write instead of renumbering every row. A join table would be the right
-- shape if positions ever needed to be queried or constrained individually;
-- they do not.
--
-- The array holds job NAMES, and is deliberately not constrained to a fixed
-- list of them. Square Enix adds jobs every expansion, and a CHECK against
-- today's list would turn the next one into a failed write for whoever levels
-- it first. Same reasoning as the timezone column in 005: cap the size, let the
-- client offer only real values, and let anything unrecognised fall through the
-- renderer harmlessly.

alter table public.raid_characters
  add column job_order text[]
    check (
      job_order is null
      or (cardinality(job_order) <= 60
          -- Per-element length, without a subquery (not allowed in CHECK).
          and length(array_to_string(job_order, ',')) <= 1500)
    );

comment on column public.raid_characters.job_order is
  'Job names in the member''s preferred order. Partial and possibly stale: jobs levelled since are appended by the client at render time, and names no longer on the character are ignored.';

-- ---------------------------------------------------------------------------
-- the policy this needs, which turned out to be missing
-- ---------------------------------------------------------------------------
-- 001 gave raid_characters INSERT and DELETE for the claimant, and ALL for a
-- leader, but never UPDATE for the claimant -- because until now a claim had
-- nothing about it worth changing. It does now, and without this a member
-- cannot write their own preference at all.
--
-- WITH CHECK is what stops this becoming a way to hand a character to somebody
-- else: the row must still belong to the caller after the update as well as
-- before it. Reassigning a claim stays a leader's job, through
-- raid_characters_all_leader, which is where the "let a leader correct a bad
-- claim" requirement has always lived.
--
-- lodestone_id stays writable by the owner, which sounds worse than it is: they
-- could already delete the claim and insert another, so this grants nothing new
-- and the unique constraint still stops them taking a character somebody else
-- has claimed.
create policy raid_characters_update_self on public.raid_characters
  for update to authenticated
  using (member_id = (select auth.uid()))
  with check (member_id = (select auth.uid()));
