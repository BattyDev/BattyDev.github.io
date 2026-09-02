-- LOCAL TEST HARNESS ONLY -- do not run this against the Supabase project.
--
-- Supabase already provides all of this (the auth schema, auth.uid(), the anon
-- / authenticated / service_role roles and their default grants). This file
-- recreates just enough of it on a stock Postgres so that 001_schema.sql can be
-- applied and 01_rls_proof.sql can exercise the policies with real role
-- impersonation, without needing the hosted project to exist yet.
--
-- The definitions below are copied to match Supabase's behaviour, in
-- particular: auth.uid() reads the sub claim out of the request.jwt.claims GUC,
-- and anon/authenticated receive blanket table grants that RLS is then relied
-- on to filter. That last part matters -- it is what makes the explicit
-- "revoke ... from anon" in 001_schema.sql a real test rather than a no-op.

create schema if not exists auth;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth   to anon, authenticated, service_role;

-- Supabase's default privileges: new tables in public are granted to the API
-- roles, and RLS is what actually restricts them.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;

-- Stand-in for auth.users. Only the columns this schema touches.
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  raw_app_meta_data  jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- Verbatim behaviour of Supabase's auth.uid(): the sub claim of the request
-- JWT, or NULL when there is no JWT (SQL editor, migrations, service_role).
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  );
$$;

grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
