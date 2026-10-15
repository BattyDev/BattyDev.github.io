-- BattyDev · Baby — migration `baby_account_order` on project battydevsite
--
-- Account colours on /baby/savings are assigned by list order, so that order
-- has to be stable as accounts are added: oldest first, never alphabetical
-- (alphabetical would repaint every existing account when a new one sorted
-- in ahead of it). baby_snapshot() is redefined with only the accounts
-- ordering changed; see 001_baby_schema.sql for the rest of its commentary.

alter table public.baby_accounts add column created_at timestamptz not null default now();

create or replace function public.baby_snapshot() returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare s public.baby_settings;
begin
  if not public.baby_is_member() then
    raise exception 'not on the baby allow-list' using errcode = '42501';
  end if;
  select * into s from public.baby_settings;
  return jsonb_build_object(
    'sample',  coalesce(s.sample, false),
    'updated', s.updated_at,
    'pregnancy', jsonb_build_object(
      'due',      s.due,
      'nickname', s.nickname,
      'done',         coalesce((select jsonb_agg(task_id order by done_at) from public.baby_tasks_done), '[]'),
      'appointments', coalesce((select jsonb_agg(jsonb_build_object('date', date, 'label', label, 'note', note) order by date)
                                from public.baby_appointments), '[]'),
      'moments',      coalesce((select jsonb_agg(jsonb_build_object('date', date, 'text', text) order by date)
                                from public.baby_moments), '[]')
    ),
    'savings', jsonb_build_object(
      'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'note', note) order by created_at, id)
                            from public.baby_accounts), '[]'),
      'goals',    coalesce((select jsonb_agg(jsonb_build_object(
                              'id', id, 'name', name, 'icon', icon, 'target', target,
                              'weeksBeforeDue', weeks_before_due, 'needBy', need_by, 'note', note,
                              'bought', case when bought_date is null then null
                                             else jsonb_build_object('date', bought_date, 'paid', bought_paid) end)
                            order by id) from public.baby_goals), '[]'),
      'entries',  coalesce((select jsonb_agg(jsonb_build_object(
                              'date', date, 'amount', amount, 'goal', goal_id, 'account', account_id,
                              'kind', kind, 'note', note) order by date, id)
                            from public.baby_entries), '[]')
    )
  );
end $$;
