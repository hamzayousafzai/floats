-- =========================================================
-- Floats MVP Database Schema (Supabase / Postgres)
-- Version: 2.0 (Updated 2025-09-08)
-- =========================================================
-- Features:
-- - Asynchronous geocoding for events via pg_net trigger
-- - PostGIS geography points for spatial queries
-- - Trigram for fuzzy search on vendor names
-- - RLS with public read, protected writes
-- - Admin role table (app_admins)
-- - RPC function for optimized map searches
-- =========================================================

-- Extensions
create extension if not exists postgis;
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;
create extension if not exists pg_net; -- For calling Edge Functions from triggers

-- Timestamp helper trigger to update updated_at automatically
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================
-- USERS / PROFILES / ADMINS
-- =========================================================
-- Profiles reference Supabase auth.users (UUID)
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function set_updated_at();

alter table public.profiles enable row level security;

create policy "Public read profiles" on public.profiles for select to anon, authenticated using (true);
create policy "User upsert own profile" on public.profiles for insert to authenticated with check (user_id = auth.uid());
create policy "User update own profile" on public.profiles for update to authenticated using (user_id = auth.uid());

-- Admin table to grant special privileges
create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;
-- Admins can see who other admins are
create policy "Admins can read admins" on public.app_admins for select to authenticated using (
  exists(select 1 from public.app_admins where user_id = auth.uid())
);

-- =========================================================
-- VENDORS
-- =========================================================
create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  category text,
  social jsonb,
  photo_url text,
  geom geography(Point, 4326),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger vendors_set_updated_at before update on public.vendors for each row execute function set_updated_at();
create index if not exists vendors_name_trgm on public.vendors using gin (name gin_trgm_ops);
create index if not exists vendors_geom_gix on public.vendors using gist (geom);
alter table public.vendors enable row level security;
create policy "Public read vendors" on public.vendors for select to anon, authenticated using (true);
create policy "Auth create vendors" on public.vendors for insert to authenticated with check (true);
create policy "Owner update vendors" on public.vendors for update to authenticated using (created_by = auth.uid());
create policy "Owner delete vendors" on public.vendors for delete to authenticated using (created_by = auth.uid());

-- =========================================================
-- EVENTS (a vendor appearing at a time/place)
-- =========================================================
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  market_id uuid references public.markets(id) on delete set null,
  title text,
  status text default 'scheduled',
  address text,
  
  -- Geocoding columns
  latitude double precision,
  longitude double precision,
  geom geography(Point, 4326) generated always as (ST_MakePoint(longitude, latitude)::geography) stored,

  starts_at timestamptz not null,
  ends_at   timestamptz,
  image_url text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger events_set_updated_at before update on public.events for each row execute function set_updated_at();
create index if not exists events_geom_gix on public.events using gist (geom);
create index if not exists events_starts_idx on public.events (starts_at);
create index if not exists events_vendor_idx on public.events (vendor_id);
alter table public.events enable row level security;
create policy "Public read events" on public.events for select to anon, authenticated using (true);
-- Writes are restricted to admins for now

-- Geocoding Trigger Function
create or replace function public.on_event_address_change()
returns trigger
language plpgsql
security definer -- Allows the function to use pg_net with the service_role_key
as $$
begin
  if (
    (TG_OP = 'INSERT' and new.address is not null and new.latitude is null) or
    (TG_OP = 'UPDATE' and new.address is not null and new.latitude is null and new.address is distinct from old.address)
  ) then
    perform net.http_post(
      -- IMPORTANT: Replace <YOUR_PROJECT_REF> with your actual project ref
      url:='https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/geocode-event-address'::text,
      headers:=jsonb_build_object('Content-Type', 'application/json'),
      body:=jsonb_build_object('id', new.id, 'address', new.address)
    );
  end if;
  return new;
end;
$$;

-- Attach the trigger to the events table
create trigger geocode_event_address
after insert or update on public.events
for each row execute function on_event_address_change();

-- =========================================================
-- FAVORITES
-- =========================================================
create table if not exists public.favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, vendor_id)
);

alter table public.favorites enable row level security;
create policy "Owner can manage favorites" on public.favorites for all to authenticated using (user_id = auth.uid());

-- =========================================================
-- VIEWS
-- =========================================================
create or replace view public.next_event_per_vendor as
select distinct on (e.vendor_id)
  e.vendor_id,
  e.id as event_id,
  e.starts_at,
  e.ends_at,
  e.address,
  e.geom
from public.events e
where e.starts_at > now()
order by e.vendor_id, e.starts_at asc;

grant select on public.next_event_per_vendor to anon, authenticated;

-- =========================================================
-- RPC FUNCTIONS
-- =========================================================
create or replace function public.map_events_bbox_when(
  p_min_lng double precision,
  p_min_lat double precision,
  p_max_lng double precision,
  p_max_lat double precision,
  p_when text,
  p_tz text default 'America/New_York'
)
returns table (
  event_id uuid,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  address text,
  latitude double precision,
  longitude double precision,
  vendor_id uuid,
  vendor_name text,
  vendor_slug text
)
language sql
stable
as $$
with now_local as (
  select now() at time zone p_tz as nl
),
bounds_local as (
  select
    lower(coalesce(p_when, 'today')) as w,
    nl,
    case
      when lower(coalesce(p_when,'')) in ('today') then date_trunc('day', nl)
      when lower(coalesce(p_when,'')) in ('this-week','week') then date_trunc('week', nl)
      when lower(coalesce(p_when,'')) in ('this-month','month') then date_trunc('month', nl)
      when lower(coalesce(p_when,'')) in ('weekend') then (((nl)::date + (((6 - extract(dow from nl))::int + 7) % 7))::timestamp)
      else nl
    end as start_local,
    case
      when lower(coalesce(p_when,'')) in ('today') then date_trunc('day', nl) + interval '1 day - 1 millisecond'
      when lower(coalesce(p_when,'')) in ('this-week','week') then date_trunc('week', nl) + interval '6 days 23:59:59.999'
      when lower(coalesce(p_when,'')) in ('this-month','month') then date_trunc('month', nl) + interval '1 month - 1 millisecond'
      when lower(coalesce(p_when,'')) in ('weekend') then (((nl)::date + (((6 - extract(dow from nl))::int + 7) % 7))::timestamp) + interval '1 day 23:59:59.999'
      else timestamp '2099-12-31 23:59:59.999'
    end as end_local
  from now_local
),
bounds_utc as (
  select
    (start_local at time zone p_tz) as start_utc,
    (end_local   at time zone p_tz) as end_utc
  from bounds_local
),
filtered as (
  select
    e.id,
    e.title,
    e.starts_at,
    e.ends_at,
    e.address,
    e.latitude,
    e.longitude,
    e.vendor_id
  from public.events e
  cross join bounds_utc bu
  where e.starts_at between bu.start_utc and bu.end_utc
    and e.latitude  is not null
    and e.longitude is not null
    and e.longitude between p_min_lng and p_max_lng
    and e.latitude  between p_min_lat and p_max_lat
),
ranked as (
  select
    f.*,
    v.name as vendor_name,
    v.slug as vendor_slug,
    row_number() over (partition by f.vendor_id order by f.starts_at asc) rn
  from filtered f
  left join public.vendors v on v.id = f.vendor_id
)
select
  id as event_id,
  title,
  starts_at,
  ends_at,
  address,
  latitude,
  longitude,
  vendor_id,
  vendor_name,
  vendor_slug
from ranked
where rn = 1
order by starts_at asc
limit 200;
$$;

grant execute on function public.map_events_bbox_when(double precision,double precision,double precision,double precision,text,text) to anon, authenticated;

-- (Removed old/unused tables and functions like markets, market_vendors, active_events view, map_search_events function for clarity)
