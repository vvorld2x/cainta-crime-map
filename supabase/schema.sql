create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  role text not null default 'viewer' check (role in ('admin', 'officer', 'viewer')),
  created_at timestamptz not null default now()
);

create table public.incidents (
  id bigint generated always as identity primary key,
  incident_date date not null,
  incident_time time not null,
  crime_type text not null check (crime_type in (
    'Murder', 'Homicide', 'Physical Injury', 'Rape', 'Theft', 'Robbery',
    'Carnapping (MC)', 'Carnapping (MV)'
  )),
  barangay text not null check (barangay in (
    'San Andres (Poblacion)', 'San Isidro', 'San Juan', 'San Roque',
    'Santa Rosa', 'Santo Domingo', 'Santo Niño'
  )),
  location text not null default 'Not specified' check (char_length(location) <= 200),
  modus text not null default 'Unknown' check (char_length(modus) <= 200),
  status text not null default 'Under Investigation' check (status in (
    'Under Investigation', 'Ongoing Investigation', 'Solved', 'Cleared'
  )),
  lat double precision not null check (lat between 14.50 and 14.66),
  lng double precision not null check (lng between 121.05 and 121.20),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id)
);

create index incidents_active_idx on public.incidents (incident_date desc) where deleted_at is null;
create index incidents_deleted_idx on public.incidents (deleted_at) where deleted_at is not null;
create index incidents_barangay_idx on public.incidents (barangay);

create table public.audit_log (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id),
  action text not null check (char_length(action) <= 80),
  detail text not null default '' check (char_length(detail) <= 500),
  action_type text not null check (action_type in ('add', 'edit', 'exp')),
  created_at timestamptz not null default now()
);

create index audit_log_created_idx on public.audit_log (created_at desc);

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid()
$$;

revoke all on function public.current_app_role() from public, anon;
grant execute on function public.current_app_role() to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    left(coalesce(nullif(split_part(new.email, '@', 1), ''), 'user'), 80),
    'viewer'
  );
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.guard_incident_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'immutable columns cannot be changed';
  end if;
  if new.deleted_at is distinct from old.deleted_at then
    new.deleted_by := case when new.deleted_at is null then null else auth.uid() end;
  end if;
  return new;
end;
$$;

create trigger incidents_guard_update
before update on public.incidents
for each row execute function public.guard_incident_update();

create or replace function public.purge_deleted_incidents()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  if auth.uid() is not null and public.current_app_role() is distinct from 'admin' then
    raise exception 'not authorized';
  end if;
  delete from public.incidents where deleted_at is not null and deleted_at < now() - interval '24 hours';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_deleted_incidents() from public, anon;
grant execute on function public.purge_deleted_incidents() to authenticated;

alter table public.profiles enable row level security;
alter table public.incidents enable row level security;
alter table public.audit_log enable row level security;

alter table public.profiles force row level security;
alter table public.incidents force row level security;
alter table public.audit_log force row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.current_app_role()) = 'admin');

create policy profiles_admin_update on public.profiles
  for update to authenticated
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');

create policy incidents_select on public.incidents
  for select to authenticated
  using (
    (select public.current_app_role()) in ('admin', 'officer')
    or ((select public.current_app_role()) = 'viewer' and deleted_at is null)
  );

create policy incidents_insert on public.incidents
  for insert to authenticated
  with check (
    (select public.current_app_role()) in ('admin', 'officer')
    and created_by = (select auth.uid())
    and deleted_at is null
  );

create policy incidents_update on public.incidents
  for update to authenticated
  using ((select public.current_app_role()) in ('admin', 'officer'))
  with check ((select public.current_app_role()) in ('admin', 'officer'));

create policy incidents_delete on public.incidents
  for delete to authenticated
  using ((select public.current_app_role()) = 'admin');

create policy audit_select on public.audit_log
  for select to authenticated
  using ((select public.current_app_role()) in ('admin', 'officer'));

create policy audit_insert on public.audit_log
  for insert to authenticated
  with check (
    (select public.current_app_role()) in ('admin', 'officer')
    and user_id = (select auth.uid())
  );

revoke all on public.profiles from anon, authenticated;
revoke all on public.incidents from anon, authenticated;
revoke all on public.audit_log from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (role, display_name) on public.profiles to authenticated;
grant select on public.incidents to authenticated;
grant insert (incident_date, incident_time, crime_type, barangay, location, modus, status, lat, lng) on public.incidents to authenticated;
grant update (incident_date, incident_time, crime_type, barangay, location, modus, status, lat, lng, deleted_at) on public.incidents to authenticated;
grant delete on public.incidents to authenticated;
grant select on public.audit_log to authenticated;
grant insert (action, detail, action_type) on public.audit_log to authenticated;

revoke usage on sequence public.incidents_id_seq from anon, authenticated;
revoke usage on sequence public.audit_log_id_seq from anon, authenticated;
