-- BattyDev · Baby — schema (migration `baby_schema` on project battydevsite)
--
-- battydevsite is shared with /fcevents (raid_*) and brackets (bkt_*), and
-- both of those let strangers create accounts: Discord sign-in for the FC,
-- guest email accounts for brackets. So "authenticated" means nothing here.
-- Every baby_ table is readable only by user ids listed in baby_members, and
-- nothing is writable from the browser at all: rows are written through the
-- Supabase MCP / SQL editor, which run as the postgres role and bypass RLS.
--
-- The page reads one thing: baby_snapshot(), the whole section as one JSON
-- document in the shape the pages were built around (see baby/AGENTS.md).
--
-- Privacy: real data (the due date above all) lives only in these tables.
-- Never put it in a migration, a seed file, or anything else in the repo.

-- ---------- who may read ----------

create table public.baby_members (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  label      text not null,
  created_at timestamptz not null default now()
);
comment on table public.baby_members is
  'Allow-list for every baby_ table. Managed from SQL only; no client policy can add a row.';

-- SECURITY DEFINER so policies can ask the question without the caller
-- needing (or getting) read access to the allow-list itself.
create function public.baby_is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.baby_members m where m.user_id = auth.uid());
$$;

-- ---------- pregnancy ----------

create table public.baby_settings (
  id         boolean primary key default true check (id),      -- exactly one row
  due        date not null,
  nickname   text not null default 'Baby',
  sample     boolean not null default false,                   -- shows the "sample data" banner
  updated_at timestamptz not null default now()
);

create table public.baby_appointments (
  id    bigint generated always as identity primary key,
  date  date not null,
  label text not null,
  note  text not null default ''
);

create table public.baby_moments (
  id   bigint generated always as identity primary key,
  date date not null,
  text text not null
);

-- Ids come from BABY_TASKS in baby/shared/weeks.js.
create table public.baby_tasks_done (
  task_id text primary key,
  done_at timestamptz not null default now()
);

-- ---------- savings (a ledger: balances are derived, never stored) ----------

create table public.baby_accounts (
  id   text primary key check (id ~ '^[a-z0-9-]+$'),
  name text not null,
  note text not null default ''
);

create table public.baby_goals (
  id               text primary key check (id ~ '^[a-z0-9-]+$'),
  name             text not null,
  icon             text not null default 'gift',             -- a key of BABY_ICONS
  target           numeric(10,2) not null check (target >= 0),
  weeks_before_due int check (weeks_before_due between 0 and 40),
  need_by          date,                                     -- wins over weeks_before_due
  note             text not null default '',
  bought_date      date,
  bought_paid      numeric(10,2)
);

create table public.baby_entries (
  id         bigint generated always as identity primary key,
  date       date not null default current_date,
  amount     numeric(10,2) not null check (amount <> 0),     -- negative takes money back out
  goal_id    text references public.baby_goals (id) on update cascade,   -- null = general fund
  account_id text not null references public.baby_accounts (id) on update cascade,
  kind       text not null default 'deposit' check (kind in ('deposit', 'purchase')),
  note       text not null default '',
  created_at timestamptz not null default now(),
  check (kind = 'deposit' or (amount > 0 and goal_id is not null))
);
create index baby_entries_date on public.baby_entries (date);

-- ---------- "updated" stamp ----------

-- Any write to any baby_ table bumps baby_settings.updated_at, which the
-- pages show in the header. Statement-level, so a batch insert bumps it once.
create function public.baby_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.baby_settings set updated_at = now();
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['baby_appointments','baby_moments','baby_tasks_done',
                           'baby_accounts','baby_goals','baby_entries'] loop
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each statement execute function public.baby_touch()', t || '_touch', t);
  end loop;
end $$;

-- ---------- access ----------

do $$
declare t text;
begin
  foreach t in array array['baby_members','baby_settings','baby_appointments','baby_moments',
                           'baby_tasks_done','baby_accounts','baby_goals','baby_entries'] loop
    execute format('alter table public.%I enable row level security', t);
    -- Supabase's default privileges grant everything to anon and authenticated
    -- on new tables. Take it all back, then give members SELECT and nothing else.
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.baby_is_member())',
                   t || '_member_read', t);
  end loop;
end $$;

-- ---------- the read surface ----------

-- SECURITY INVOKER: it reads through the caller's RLS like any query would.
-- The explicit check turns "you see nothing" into a clear error the page can
-- explain, instead of a page that looks empty.
create function public.baby_snapshot() returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare s public.baby_settings;
begin
  if not public.baby_is_member() then
    raise exception 'not on the baby allow-list' using errcode = '42501';
  end if;
  select * into s from public.baby_settings;
  return jsonb_build_object(
    'sample',  coalesce(s.sample, false),
    'updated', s.updated_at,                -- a timestamp; the browser shows it in local time
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
      'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'note', note) order by id)
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

revoke all on function public.baby_is_member() from public, anon;
revoke all on function public.baby_snapshot()  from public, anon;
revoke all on function public.baby_touch()     from public, anon, authenticated;
grant execute on function public.baby_is_member() to authenticated;
grant execute on function public.baby_snapshot()  to authenticated;
