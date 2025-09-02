-- =========================================================
-- Floats MVP Database Schema (Supabase / Postgres)
-- =========================================================
-- Features:
-- - PostGIS points for events/markets/vendors (geography(Point,4326))
-- - Trigram for fuzzy search on vendor names
-- - RLS with public read of discovery data, protected writes
-- - Favorites tied to authenticated user
-- - Profiles linked to auth.users
-- - Helpful indexes for geo + search
-- =========================================================

-- Extensions
create extension if not exists postgis;
create extension if not exists pg_trgm;
create extension if not exists pgcrypto; -- for gen_random_uuid()

-- Timestamp helper trigger to update updated_at automatically
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================
-- USERS / PROFILES
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

-- Read: public profiles are safe to read
create policy "Public read profiles"
on public.profiles
for select
to anon, authenticated
using (true);

-- Users can manage their own profile
create policy "User upsert own profile"
on public.profiles
for insert
to authenticated
with check (user_id = auth.uid());

create policy "User update own profile"
on public.profiles
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- =========================================================
-- VENDORS
-- =========================================================
create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  category text, -- e.g., 'jewelry', 'vintage', ...
  social jsonb,  -- { "instagram": "...", "tiktok": "...", "website": "..." }
  photo_url text,

  -- Optional "home base" location for the vendor profile map pin
  geom geography(Point, 4326),

  created_by uuid references auth.users(id), -- null for admin/manual seeds
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger vendors_set_updated_at
before update on public.vendors
for each row execute function set_updated_at();

-- Search index
create index if not exists vendors_name_trgm on public.vendors using gin (name gin_trgm_ops);
-- Geo index (even if optional)
create index if not exists vendors_geom_gix on public.vendors using gist (geom);

alter table public.vendors enable row level security;

-- Public can read vendors (discovery content)
create policy "Public read vendors"
on public.vendors
for select
to anon, authenticated
using (true);

-- Only authenticated can insert; if you later allow vendor self-serve, enforce ownership
create policy "Auth create vendors"
on public.vendors
for insert
to authenticated
with check (created_by = auth.uid() or created_by is null);

-- Allow owner (or admins via future role) to update/delete
create policy "Owner update vendors"
on public.vendors
for update
to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

create policy "Owner delete vendors"
on public.vendors
for delete
to authenticated
using (created_by = auth.uid());

-- =========================================================
-- MARKETS (multi-vendor events/locations)
-- =========================================================
create table if not exists public.markets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  address text,
  geom geography(Point, 4326), -- market location
  map_layout_url text,         -- optional custom layout image or vector
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger markets_set_updated_at
before update on public.markets
for each row execute function set_updated_at();

create index if not exists markets_geom_gix on public.markets using gist (geom);

alter table public.markets enable row level security;

create policy "Public read markets"
on public.markets
for select
to anon, authenticated
using (true);

-- Keep writes restricted for now (admin-only). You can open later.

-- =========================================================
-- EVENTS (a vendor appearing at a time/place; can be standalone or at a market)
-- =========================================================
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  market_id uuid references public.markets(id) on delete set null,

  title text,                 -- e.g., "Pop-up at Hiwire Brewing"
  status text default 'scheduled', -- 'scheduled' | 'confirmed' | 'canceled'
  address text,

  -- Use geography(Point,4326) for performant ST_DWithin, bbox queries, etc.
  geom geography(Point, 4326) not null,

  starts_at timestamptz not null,
  ends_at   timestamptz not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint events_time_valid check (ends_at > starts_at)
);

create trigger events_set_updated_at
before update on public.events
for each row execute function set_updated_at();

-- Geo index
create index if not exists events_geom_gix on public.events using gist (geom);
-- Time filter helpers
create index if not exists events_starts_idx on public.events (starts_at);
create index if not exists events_ends_idx on public.events (ends_at);
-- Vendor lookup
create index if not exists events_vendor_idx on public.events (vendor_id);

alter table public.events enable row level security;

-- Public can read events (discovery content)
create policy "Public read events"
on public.events
for select
to anon, authenticated
using (true);

-- Writes restricted (admin-only for MVP); open later for vendor self-serve.

-- =========================================================
-- MARKET <-> VENDOR linking (for directories, not required for an actual event)
-- =========================================================
create table if not exists public.market_vendors (
  market_id uuid not null references public.markets(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (market_id, vendor_id)
);

alter table public.market_vendors enable row level security;

create policy "Public read market_vendors"
on public.market_vendors
for select
to anon, authenticated
using (true);

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

-- Only the owner can see their favorites
create policy "Owner read favorites"
on public.favorites
for select
to authenticated
using (user_id = auth.uid());

-- Only the owner can insert/delete their own favorites
create policy "Owner insert favorites"
on public.favorites
for insert
to authenticated
with check (user_id = auth.uid());

create policy "Owner delete favorites"
on public.favorites
for delete
to authenticated
using (user_id = auth.uid());

-- =========================================================
-- VIEWS (optional helpers)
-- =========================================================
-- Active events RIGHT NOW (useful for "Happening Now" filter)
create or replace view public.active_events as
select
  e.*,
  v.name as vendor_name,
  v.slug as vendor_slug
from public.events e
join public.vendors v on v.id = e.vendor_id
where now() between e.starts_at and e.ends_at;

grant select on public.active_events to anon, authenticated;

-- Next upcoming event per vendor (simple helper for Explore list)
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

create or replace function public.map_search_events(
  p_min_lng double precision,
  p_min_lat double precision,
  p_max_lng double precision,
  p_max_lat double precision,
  p_time_filter text
)
returns table (
  id uuid,
  vendor_slug text,
  vendor_name text,
  title text,
  lat double precision,
  lng double precision,
  starts_at timestamptz,
  ends_at timestamptz,
  address text
) language sql stable as $$
  with filtered as (
    select e.id, v.slug as vendor_slug, v.name as vendor_name, e.title,
           ST_Y((e.geom::geometry)) as lat,
           ST_X((e.geom::geometry)) as lng,
           e.starts_at, e.ends_at, e.address
    from public.events e
    join public.vendors v on v.id = e.vendor_id
    where e.geom && ST_MakeEnvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326)
      and (
        case p_time_filter
          when 'now' then tstzrange(e.starts_at, e.ends_at, '[]') @> now()
          when 'today' then e.starts_at::date = now()::date
          when 'weekend' then extract(isodow from e.starts_at) in (6,7)
          else true
        end
      )
  )
  select * from filtered;
$$;

grant execute on function public.map_search_events(double precision,double precision,double precision,double precision,text) to anon, authenticated;
