-- Automated event ingestion: additive migration (ADR-001, spec section 4).
-- Creates the private `ingestion` schema, the provenance table public.event_ingestion_links
-- and the service-role-only publisher ingestion.publish_candidate().
-- Does not alter any existing table, column, enum or function.
-- Apply to an isolated database first; see docs/architecture/automated-event-ingestion-repository-audit.md.

create extension if not exists pgcrypto;
create extension if not exists postgis;
create schema if not exists ingestion;
revoke all on schema ingestion from public, anon, authenticated;
grant usage on schema ingestion to service_role;

create table ingestion.sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_url text not null unique,
  source_type text not null check (source_type in ('organizer','venue','aggregator','platform')),
  adapter text not null check (adapter in ('jsonld','ics','html','playwright')),
  trust_state text not null default 'probation' check (trust_state in ('probation','trusted','disabled')),
  enabled boolean not null default true,
  discovery_only boolean not null default false,
  crawl_delay_ms integer not null default 2000 check (crawl_delay_ms >= 1000),
  configuration jsonb not null default '{}'::jsonb,
  valid_events integer not null default 0,
  rejected_events integer not null default 0,
  failed_runs integer not null default 0,
  successful_runs integer not null default 0,
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table ingestion.runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null check (run_type in ('collection','discovery','replay','verification')),
  status text not null default 'running' check (status in ('running','succeeded','partial','failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  sources_attempted integer not null default 0,
  sources_succeeded integer not null default 0,
  observations_found integer not null default 0,
  candidates_created integer not null default 0,
  candidates_published integer not null default 0,
  candidates_review integer not null default 0,
  error_summary text,
  metadata jsonb not null default '{}'::jsonb,
  check (finished_at is null or finished_at >= started_at)
);
create table ingestion.observations (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references ingestion.sources(id),
  run_id uuid not null references ingestion.runs(id),
  external_event_id text,
  source_url text not null,
  raw_payload jsonb not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  parser_version text not null,
  observed_at timestamptz not null default now(),
  unique (source_id, source_url, content_hash)
);
create table ingestion.candidates (
  id uuid primary key default gen_random_uuid(),
  primary_source_id uuid not null references ingestion.sources(id),
  canonical_key text not null unique check (canonical_key ~ '^[0-9a-f]{64}$'),
  source_url text not null,
  external_event_id text,
  title text not null,
  description text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text not null default 'America/New_York' check (timezone = 'America/New_York'),
  organizer_name text,
  venue_name text,
  address text,
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  category_slugs text[] not null default '{}'::text[],
  vendor_count integer check (vendor_count is null or vendor_count >= 0),
  vendor_evidence jsonb not null default '[]'::jsonb,
  validation_reasons jsonb not null default '[]'::jsonb,
  score integer not null default 0 check (score between 0 and 100),
  is_market boolean not null default false,
  location_verified boolean not null default false,
  vendor_verified boolean not null default false,
  cancelled boolean not null default false,
  duplicate_state text not null default 'unchecked'
    check (duplicate_state in ('unchecked','clear','possible','confirmed')),
  status text not null default 'pending'
    check (status in ('pending','validating','ready','needs_review','approved','rejected','published')),
  manual_override boolean not null default false,
  approved_by uuid references auth.users(id),
  published_event_id uuid unique references public.events(id),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create table ingestion.candidate_sources (
  candidate_id uuid not null references ingestion.candidates(id) on delete cascade,
  observation_id uuid not null references ingestion.observations(id) on delete cascade,
  match_reason text not null,
  created_at timestamptz not null default now(),
  primary key (candidate_id, observation_id)
);
create table ingestion.source_discoveries (
  id uuid primary key default gen_random_uuid(),
  discovered_url text not null unique,
  parent_source_id uuid references ingestion.sources(id),
  evaluation text not null default 'pending'
    check (evaluation in ('pending','compatible','unsupported','restricted','rejected')),
  reason text,
  adapter_detected text check (adapter_detected is null or adapter_detected in ('jsonld','ics','html','playwright')),
  registered_source_id uuid references ingestion.sources(id),
  discovered_at timestamptz not null default now(),
  evaluated_at timestamptz
);
create table ingestion.reviews (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references ingestion.candidates(id),
  reviewer_id uuid not null references auth.users(id),
  decision text not null check (decision in ('approve','reject','request_review')),
  reason text not null check (length(trim(reason)) > 0),
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table ingestion.publication_audit (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references ingestion.candidates(id),
  event_id uuid references public.events(id),
  action text not null check (action in ('shadow_approved','published','skipped_duplicate','blocked','archived')),
  reason text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.event_ingestion_links (
  event_id uuid primary key references public.events(id) on delete cascade,
  candidate_id uuid not null unique references ingestion.candidates(id),
  source_id uuid not null references ingestion.sources(id),
  organizer_display_name text,
  management_state text not null default 'ingestion' check (management_state in ('ingestion','manual','claimed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_sources_trust_enabled on ingestion.sources(trust_state,enabled);
create index idx_runs_started_at on ingestion.runs(started_at desc);
create index idx_observations_source_observed on ingestion.observations(source_id,observed_at desc);
create index idx_candidates_status_score on ingestion.candidates(status,score desc);
create index idx_candidates_starts_at on ingestion.candidates(starts_at);
create index idx_candidates_source on ingestion.candidates(primary_source_id);
create index idx_candidates_location on ingestion.candidates(latitude,longitude);
create index idx_candidates_updated_at on ingestion.candidates(updated_at desc, id desc);
create index idx_candidate_sources_observation on ingestion.candidate_sources(observation_id);
create index idx_reviews_candidate on ingestion.reviews(candidate_id,created_at desc);
create index idx_audit_candidate on ingestion.publication_audit(candidate_id,created_at desc);
create index idx_ingestion_links_source on public.event_ingestion_links(source_id);

alter table ingestion.sources enable row level security;
alter table ingestion.runs enable row level security;
alter table ingestion.observations enable row level security;
alter table ingestion.candidates enable row level security;
alter table ingestion.candidate_sources enable row level security;
alter table ingestion.source_discoveries enable row level security;
alter table ingestion.reviews enable row level security;
alter table ingestion.publication_audit enable row level security;
alter table public.event_ingestion_links enable row level security;
revoke all on all tables in schema ingestion from public,anon,authenticated;
revoke all on public.event_ingestion_links from public,anon,authenticated;
grant select,insert,update,delete on all tables in schema ingestion to service_role;
grant select,insert,update,delete on public.event_ingestion_links to service_role;

-- Collapses a title/address to lowercase alphanumerics so near-identical spellings lock together.
create or replace function ingestion.normalize_slot_text(p_value text)
returns text language sql immutable set search_path = ''
as $$
  select pg_catalog.btrim(
    pg_catalog.regexp_replace(pg_catalog.lower(coalesce(p_value, '')), '[^a-z0-9]+', ' ', 'g')
  );
$$;
revoke all on function ingestion.normalize_slot_text(text) from public,anon,authenticated;
grant execute on function ingestion.normalize_slot_text(text) to service_role;

-- The publisher is created through dynamic SQL so PostGIS calls are qualified with the schema where the
-- extension is actually installed (public or extensions) instead of an unverified assumption.
-- It is invoked ONLY by a trusted service-role backend; manual approval is recorded first by an admin API.
do $migration$
declare
  v_postgis_schema text;
  v_sql text;
begin
  select n.nspname into v_postgis_schema
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'postgis';
  if v_postgis_schema is null then
    raise exception 'PostGIS extension is required';
  end if;

  v_sql := $tmpl$
create or replace function ingestion.publish_candidate(
  p_candidate_id uuid,
  p_min_score integer,
  p_center_lat double precision,
  p_center_lng double precision,
  p_radius_miles double precision,
  p_horizon_days integer,
  p_manual boolean default false
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v ingestion.candidates%rowtype;
  s ingestion.sources%rowtype;
  existing_id uuid;
  new_id uuid;
  v_now timestamptz := pg_catalog.now();
  v_claim_role text;
  v_local_date date;
  v_slot_address text;
  v_slot_title text;
begin
  -- Defence in depth on top of EXECUTE grants: a request authenticated as any other role is refused.
  v_claim_role := nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
  if v_claim_role is null then
    v_claim_role := (nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::pg_catalog.jsonb) ->> 'role';
  end if;
  if v_claim_role is not null and v_claim_role <> 'service_role' then
    raise exception 'Service role required';
  end if;

  if p_min_score is null or p_min_score not between 70 and 100
     or p_radius_miles is null or p_radius_miles not between 1 and 100
     or p_horizon_days is null or p_horizon_days not between 1 and 365
     or p_center_lat is null or p_center_lat not between -90 and 90
     or p_center_lng is null or p_center_lng not between -180 and 180 then
    raise exception 'Invalid publication configuration';
  end if;

  select * into v from ingestion.candidates where id = p_candidate_id;
  if not found then raise exception 'Candidate not found'; end if;
  if v.published_event_id is not null then return v.published_event_id; end if;

  -- Lock the physical slot (normalised address + Eastern calendar date) first, then the canonical identity.
  -- Different candidates for one physical event can carry different canonical keys, so the identity hash
  -- alone cannot serialise them. The lock order is fixed (slot, then canonical key) to avoid deadlocks.
  if v.address is not null and v.starts_at is not null then
    v_local_date := (v.starts_at at time zone 'America/New_York')::date;
    v_slot_address := ingestion.normalize_slot_text(v.address);
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('slot|' || v_slot_address || '|' || v_local_date::text, 0)
    );
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v.canonical_key, 0));

  select * into v from ingestion.candidates where id = p_candidate_id for update;
  if v.published_event_id is not null then return v.published_event_id; end if;

  select * into s from ingestion.sources where id = v.primary_source_id;
  if not found or not s.enabled or s.trust_state = 'disabled' then
    raise exception 'Source unavailable';
  end if;
  if p_manual then
    if v.status <> 'approved' or v.approved_by is null then
      raise exception 'Candidate requires recorded admin approval';
    end if;
  else
    if s.trust_state <> 'trusted' or v.status <> 'ready' or v.score < p_min_score then
      raise exception 'Automatic publication not permitted';
    end if;
  end if;

  if pg_catalog.length(pg_catalog.btrim(v.title)) < 5
     or v.description is null
     or pg_catalog.length(pg_catalog.btrim(v.description)) < 20
     or v.address is null
     or pg_catalog.length(pg_catalog.btrim(v.address)) < 10
     or v.starts_at is null or v.ends_at is null
     or v.ends_at <= v.starts_at
     or v.starts_at < v_now
     or v.starts_at >= v_now + pg_catalog.make_interval(days => p_horizon_days)
     or v.latitude is null or v.longitude is null
     or not v.location_verified or not v.vendor_verified
     or not v.is_market or v.cancelled
     or v.duplicate_state <> 'clear' then
    raise exception 'Candidate failed hard publication gates';
  end if;
  if not @@PG@@.ST_DWithin(
    @@PG@@.ST_SetSRID(@@PG@@.ST_MakePoint(v.longitude,v.latitude),4326)::@@PG@@.geography,
    @@PG@@.ST_SetSRID(@@PG@@.ST_MakePoint(p_center_lng,p_center_lat),4326)::@@PG@@.geography,
    p_radius_miles * 1609.344
  ) then raise exception 'Event is outside radius'; end if;

  select l.event_id into existing_id
  from public.event_ingestion_links l
  join ingestion.candidates c on c.id = l.candidate_id
  where c.canonical_key = v.canonical_key
  limit 1;
  if existing_id is not null then
    raise exception 'Existing published event identity';
  end if;

  -- Conservative production check, repeated while holding the locks, covering manually created events:
  -- same normalised address within 3 hours, or same normalised title on the same Eastern calendar date.
  -- Fuzzy matching ran earlier during validation; anything uncertain here is blocked, never published.
  v_slot_title := ingestion.normalize_slot_text(v.title);
  if exists (
    select 1 from public.events e
    where e.status is distinct from 'archived'
      and (
        (e.address is not null
          and ingestion.normalize_slot_text(e.address) = v_slot_address
          and e.starts_at between v.starts_at - interval '3 hours' and v.starts_at + interval '3 hours')
        or (e.title is not null
          and ingestion.normalize_slot_text(e.title) = v_slot_title
          and (e.starts_at at time zone 'America/New_York')::date = v_local_date)
      )
  ) then raise exception 'Possible existing production duplicate'; end if;

  -- Existing events triggers call PostGIS functions unqualified and inherit this function's empty
  -- search_path, so it is widened only around the event write (transaction-local, restored below).
  perform pg_catalog.set_config('search_path', '@@PGPATH@@', true);
  insert into public.events (
    title,description,starts_at,ends_at,address,latitude,longitude,
    event_url,image_url,status,is_market,is_featured,
    org_id,vendor_id,market_id,series_id
  ) values (
    v.title,v.description,v.starts_at,v.ends_at,v.address,v.latitude,v.longitude,
    v.source_url,null,'draft',true,false,null,null,null,null
  ) returning id into new_id;

  insert into public.event_ingestion_links (
    event_id,candidate_id,source_id,organizer_display_name,management_state
  ) values (new_id,v.id,s.id,v.organizer_name,'ingestion');

  insert into public.event_categories(event_id,category_id)
  select new_id,c.id from public.categories c
  where c.slug = any(v.category_slugs)
  on conflict do nothing;

  update public.events set status = 'published' where id = new_id;
  perform pg_catalog.set_config('search_path', '', true);

  -- Fail closed if the existing geometry trigger did not populate the map column.
  if exists (select 1 from public.events e where e.id = new_id and e.geom is null) then
    raise exception 'Event geometry was not populated';
  end if;

  update ingestion.candidates set
    status = 'published',published_event_id = new_id,updated_at = pg_catalog.now()
  where id = v.id;
  insert into ingestion.publication_audit(candidate_id,event_id,action,reason)
  values (v.id,new_id,'published',case when p_manual then 'manual_approval' else 'trusted_source' end);
  return new_id;
end;
$$;
$tmpl$;

  v_sql := pg_catalog.replace(v_sql, '@@PGPATH@@', pg_catalog.quote_ident(v_postgis_schema) || ', pg_temp');
  v_sql := pg_catalog.replace(v_sql, '@@PG@@', pg_catalog.quote_ident(v_postgis_schema));
  execute v_sql;
end
$migration$;

revoke all on function ingestion.publish_candidate(
  uuid,integer,double precision,double precision,double precision,integer,boolean
) from public,anon,authenticated;
grant execute on function ingestion.publish_candidate(
  uuid,integer,double precision,double precision,double precision,integer,boolean
) to service_role;
