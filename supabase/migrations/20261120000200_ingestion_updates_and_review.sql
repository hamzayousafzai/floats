-- Automated event ingestion, part 2 (ownership-safe updates). Additive; applies after
-- 20261120000100_automated_event_ingestion.sql. See docs/architecture/automated-event-ingestion-spec.md section 7.
--
-- ingestion.update_imported_event(): the ONLY writer of ingested events after publication. It is service-role-only and
-- changes verified fields (title, description, times, address, coordinates) or archives on verified cancellation, and only
-- while the event is still owned by ingestion. A host, claim or manual edit disables automated updates immediately.
--
-- Notification side effects (comment only; NOT verified against a live database): the repository contains the schema
-- dump and function dumps but not a trigger listing for public.events. From those, public.events carries updated_at,
-- geom and geocode triggers, and public.enqueue_notifications_for_series_followers() is a no-op stub called only from
-- admin_create_events_with_series (imported events have series_id null). Before enabling live publication or archival,
-- list the real triggers (select tgname from pg_trigger where tgrelid = 'public.events'::regclass and not tgisinternal)
-- on the target project and confirm none send user-visible notifications. Tracked as BLOCKED in the launch checklist.

alter table ingestion.publication_audit drop constraint if exists publication_audit_action_check;
alter table ingestion.publication_audit
  add constraint publication_audit_action_check
  check (action in ('shadow_approved','published','skipped_duplicate','blocked','archived','updated'));

-- At most one `running` run per run type: the database-level lock that prevents overlapping workers.
-- Workers close abandoned (stale) runs before starting, so a crashed worker cannot block collection forever.
create unique index if not exists uq_runs_one_running_per_type on ingestion.runs (run_type) where status = 'running';

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
create or replace function ingestion.update_imported_event(
  p_event_id uuid,
  p_changes jsonb,
  p_cancellation_evidence text,
  p_center_lat double precision,
  p_center_lng double precision,
  p_radius_miles double precision
)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_link public.event_ingestion_links%rowtype;
  v_event public.events%rowtype;
  v_cand ingestion.candidates%rowtype;
  v_src ingestion.sources%rowtype;
  v_claim_role text;
  v_now timestamptz := pg_catalog.now();
  v_allowed text[] := array['title','description','starts_at','ends_at','address','latitude','longitude'];
  v_changes jsonb := coalesce(p_changes, '{}'::pg_catalog.jsonb);
  v_bad text;
  v_title text;
  v_description text;
  v_starts timestamptz;
  v_ends timestamptz;
  v_address text;
  v_lat double precision;
  v_lng double precision;
  v_before jsonb;
  v_after jsonb;
  v_local_date date;
  v_slot_address text;
  v_slot_title text;
begin
  v_claim_role := nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
  if v_claim_role is null then
    v_claim_role := (nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::pg_catalog.jsonb) ->> 'role';
  end if;
  if v_claim_role is not null and v_claim_role <> 'service_role' then
    raise exception 'Service role required';
  end if;

  if p_radius_miles is null or p_radius_miles not between 1 and 100
     or p_center_lat is null or p_center_lat not between -90 and 90
     or p_center_lng is null or p_center_lng not between -180 and 180 then
    raise exception 'Invalid update configuration';
  end if;
  if pg_catalog.jsonb_typeof(v_changes) <> 'object' then
    raise exception 'Invalid update request';
  end if;
  select k into v_bad from pg_catalog.jsonb_object_keys(v_changes) k where k <> all (v_allowed) limit 1;
  if v_bad is not null then
    raise exception 'Unsupported change field';
  end if;
  if p_cancellation_evidence is not null then
    if v_changes <> '{}'::pg_catalog.jsonb then raise exception 'Invalid update request'; end if;
    if pg_catalog.length(pg_catalog.btrim(p_cancellation_evidence)) not between 10 and 1000 then
      raise exception 'Cancellation evidence required';
    end if;
  end if;

  -- Unlocked read, only to derive the slot for the advisory locks.
  select * into v_link from public.event_ingestion_links where event_id = p_event_id;
  if not found then return 'not_imported'; end if;
  select * into v_event from public.events where id = p_event_id;
  if not found then return 'not_imported'; end if;
  select * into v_cand from ingestion.candidates where id = v_link.candidate_id;

  v_address := case when v_changes ? 'address' then v_changes ->> 'address' else v_event.address end;
  v_starts := case when v_changes ? 'starts_at' then (v_changes ->> 'starts_at')::timestamptz else v_event.starts_at end;
  if v_address is not null and v_starts is not null then
    v_local_date := (v_starts at time zone 'America/New_York')::date;
    v_slot_address := ingestion.normalize_slot_text(v_address);
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('slot|' || v_slot_address || '|' || v_local_date::text, 0)
    );
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_cand.canonical_key, 0));

  -- Authoritative locked reads: ownership is decided on these rows.
  select * into v_link from public.event_ingestion_links where event_id = p_event_id for update;
  if not found then return 'not_imported'; end if;
  select * into v_event from public.events where id = p_event_id for update;
  select * into v_cand from ingestion.candidates where id = v_link.candidate_id for update;

  if v_link.management_state <> 'ingestion' then return 'not_managed'; end if;

  if v_event.org_id is not null or v_event.vendor_id is not null
     or v_event.market_id is not null or v_event.series_id is not null then
    update public.event_ingestion_links set management_state = 'claimed', updated_at = v_now where event_id = p_event_id;
    insert into ingestion.publication_audit(candidate_id,event_id,action,reason,details)
    values (v_cand.id, p_event_id, 'blocked', 'host_owned', '{}'::pg_catalog.jsonb);
    return 'host_owned';
  end if;

  -- The candidate row mirrors what ingestion last wrote. Any difference means someone edited the event by hand.
  if v_event.title is distinct from v_cand.title
     or v_event.description is distinct from v_cand.description
     or v_event.starts_at is distinct from v_cand.starts_at
     or v_event.ends_at is distinct from v_cand.ends_at
     or v_event.address is distinct from v_cand.address
     or v_event.latitude is distinct from v_cand.latitude
     or v_event.longitude is distinct from v_cand.longitude then
    update public.event_ingestion_links set management_state = 'manual', updated_at = v_now where event_id = p_event_id;
    insert into ingestion.publication_audit(candidate_id,event_id,action,reason,details)
    values (v_cand.id, p_event_id, 'blocked', 'manually_modified', '{}'::pg_catalog.jsonb);
    return 'manually_modified';
  end if;

  select * into v_src from ingestion.sources where id = v_link.source_id;
  if not found or not v_src.enabled or v_src.trust_state = 'disabled' then return 'source_unavailable'; end if;

  if v_event.status::text = 'archived' then return 'already_archived'; end if;
  if v_event.status::text <> 'published' then return 'not_published'; end if;
  if v_event.starts_at <= v_now then return 'event_started'; end if;

  if p_cancellation_evidence is not null then
    perform pg_catalog.set_config('search_path', '@@PGPATH@@', true);
    update public.events set status = 'archived' where id = p_event_id;
    perform pg_catalog.set_config('search_path', '', true);
    update ingestion.candidates set cancelled = true, updated_at = v_now where id = v_cand.id;
    update public.event_ingestion_links set updated_at = v_now where event_id = p_event_id;
    insert into ingestion.publication_audit(candidate_id,event_id,action,reason,details)
    values (v_cand.id, p_event_id, 'archived', 'verified_cancellation',
            pg_catalog.jsonb_build_object('evidence', pg_catalog.btrim(p_cancellation_evidence)));
    return 'archived';
  end if;

  if v_changes = '{}'::pg_catalog.jsonb then return 'unchanged'; end if;

  v_title := case when v_changes ? 'title' then v_changes ->> 'title' else v_event.title end;
  v_description := case when v_changes ? 'description' then v_changes ->> 'description' else v_event.description end;
  v_ends := case when v_changes ? 'ends_at' then (v_changes ->> 'ends_at')::timestamptz else v_event.ends_at end;
  v_lat := case when v_changes ? 'latitude' then (v_changes ->> 'latitude')::double precision else v_event.latitude end;
  v_lng := case when v_changes ? 'longitude' then (v_changes ->> 'longitude')::double precision else v_event.longitude end;

  if v_title is not distinct from v_event.title and v_description is not distinct from v_event.description
     and v_starts is not distinct from v_event.starts_at and v_ends is not distinct from v_event.ends_at
     and v_address is not distinct from v_event.address and v_lat is not distinct from v_event.latitude
     and v_lng is not distinct from v_event.longitude then
    return 'unchanged';
  end if;

  if v_title is null or pg_catalog.length(pg_catalog.btrim(v_title)) < 5
     or v_description is null or pg_catalog.length(pg_catalog.btrim(v_description)) < 20
     or v_address is null or pg_catalog.length(pg_catalog.btrim(v_address)) < 10
     or v_starts is null or v_ends is null or v_ends <= v_starts or v_starts < v_now
     or v_lat is null or v_lng is null
     or v_lat not between -90 and 90 or v_lng not between -180 and 180 then
    insert into ingestion.publication_audit(candidate_id,event_id,action,reason,details)
    values (v_cand.id, p_event_id, 'blocked', 'update_gates_failed', '{}'::pg_catalog.jsonb);
    return 'gates_failed';
  end if;

  if not @@PG@@.ST_DWithin(
    @@PG@@.ST_SetSRID(@@PG@@.ST_MakePoint(v_lng,v_lat),4326)::@@PG@@.geography,
    @@PG@@.ST_SetSRID(@@PG@@.ST_MakePoint(p_center_lng,p_center_lat),4326)::@@PG@@.geography,
    p_radius_miles * 1609.344
  ) then
    insert into ingestion.publication_audit(candidate_id,event_id,action,reason,details)
    values (v_cand.id, p_event_id, 'blocked', 'update_outside_radius', '{}'::pg_catalog.jsonb);
    return 'outside_radius';
  end if;

  v_slot_title := ingestion.normalize_slot_text(v_title);
  v_slot_address := ingestion.normalize_slot_text(v_address);
  v_local_date := (v_starts at time zone 'America/New_York')::date;
  if exists (
    select 1 from public.events e
    where e.id <> p_event_id
      and e.status is distinct from 'archived'
      and (
        (e.address is not null
          and ingestion.normalize_slot_text(e.address) = v_slot_address
          and e.starts_at between v_starts - interval '3 hours' and v_starts + interval '3 hours')
        or (e.title is not null
          and ingestion.normalize_slot_text(e.title) = v_slot_title
          and (e.starts_at at time zone 'America/New_York')::date = v_local_date)
      )
  ) then
    insert into ingestion.publication_audit(candidate_id,event_id,action,reason,details)
    values (v_cand.id, p_event_id, 'blocked', 'update_possible_duplicate', '{}'::pg_catalog.jsonb);
    return 'possible_duplicate';
  end if;

  v_before := pg_catalog.jsonb_build_object(
    'title', v_event.title, 'description', v_event.description, 'starts_at', v_event.starts_at, 'ends_at', v_event.ends_at,
    'address', v_event.address, 'latitude', v_event.latitude, 'longitude', v_event.longitude);
  v_after := pg_catalog.jsonb_build_object(
    'title', v_title, 'description', v_description, 'starts_at', v_starts, 'ends_at', v_ends,
    'address', v_address, 'latitude', v_lat, 'longitude', v_lng);

  -- Existing events triggers call PostGIS functions unqualified; widen the search_path only around the write.
  perform pg_catalog.set_config('search_path', '@@PGPATH@@', true);
  update public.events set
    title = v_title, description = v_description, starts_at = v_starts, ends_at = v_ends,
    address = v_address, latitude = v_lat, longitude = v_lng
  where id = p_event_id;
  perform pg_catalog.set_config('search_path', '', true);

  if exists (select 1 from public.events e where e.id = p_event_id and e.geom is null) then
    raise exception 'Event geometry was not populated';
  end if;

  update ingestion.candidates set
    title = v_title, description = v_description, starts_at = v_starts, ends_at = v_ends,
    address = v_address, latitude = v_lat, longitude = v_lng, updated_at = v_now
  where id = v_cand.id;
  update public.event_ingestion_links set updated_at = v_now where event_id = p_event_id;
  insert into ingestion.publication_audit(candidate_id,event_id,action,reason,details)
  values (v_cand.id, p_event_id, 'updated', 'verified_source_update',
          pg_catalog.jsonb_build_object('before', v_before, 'after', v_after));
  return 'updated';
end;
$$;
$tmpl$;

  v_sql := pg_catalog.replace(v_sql, '@@PGPATH@@', pg_catalog.quote_ident(v_postgis_schema) || ', pg_temp');
  v_sql := pg_catalog.replace(v_sql, '@@PG@@', pg_catalog.quote_ident(v_postgis_schema));
  execute v_sql;
end
$migration$;

revoke all on function ingestion.update_imported_event(uuid,jsonb,text,double precision,double precision,double precision)
  from public,anon,authenticated;
grant execute on function ingestion.update_imported_event(uuid,jsonb,text,double precision,double precision,double precision)
  to service_role;

-- ingestion.apply_review(): the ONLY writer of administrator review decisions. One transaction: authorize the reviewer,
-- lock the candidate, reject stale reads, validate the status transition, record the review with the real admin ID, and
-- write the revalidated candidate. It never publishes. Approval additionally requires the hard gates to be resolved
-- (computed by the application from the same facts; ingestion.publish_candidate() re-checks them at publication).
create or replace function ingestion.apply_review(
  p_candidate_id uuid,
  p_reviewer_id uuid,
  p_decision text,
  p_reason text,
  p_changes jsonb,
  p_expected_updated_at timestamptz,
  p_fields jsonb,
  p_hard_gates_passed boolean
)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_cand ingestion.candidates%rowtype;
  v_claim_role text;
  v_now timestamptz := pg_catalog.now();
  v_changes jsonb := coalesce(p_changes, '{}'::pg_catalog.jsonb);
  v_status text;
  v_title text;
  v_description text;
  v_starts timestamptz;
  v_ends timestamptz;
  v_address text;
  v_lat double precision;
  v_lng double precision;
  v_categories text[];
  v_reasons jsonb;
  v_known text[] := array['title','description','starts_at','ends_at','address','organizer_name','venue_name',
    'latitude','longitude','category_slugs','vendor_count','validation_reasons','score','is_market',
    'location_verified','vendor_verified','cancelled','duplicate_state'];
  v_bad text;
begin
  v_claim_role := nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
  if v_claim_role is null then
    v_claim_role := (nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::pg_catalog.jsonb) ->> 'role';
  end if;
  if v_claim_role is not null and v_claim_role <> 'service_role' then
    raise exception 'Service role required';
  end if;

  if p_decision is null or p_decision not in ('approve','reject','request_review')
     or p_reason is null or pg_catalog.length(pg_catalog.btrim(p_reason)) not between 1 and 1000
     or p_expected_updated_at is null
     or p_hard_gates_passed is null
     or p_fields is null or pg_catalog.jsonb_typeof(p_fields) <> 'object'
     or pg_catalog.jsonb_typeof(v_changes) <> 'object' then
    raise exception 'Invalid review request';
  end if;

  select k into v_bad from pg_catalog.jsonb_object_keys(p_fields) as k where k <> all (v_known) limit 1;
  if v_bad is not null then
    raise exception 'Unsupported review field';
  end if;

  if p_reviewer_id is null or not exists (select 1 from public.app_admins a where a.user_id = p_reviewer_id) then
    raise exception 'Administrator required';
  end if;

  select * into v_cand from ingestion.candidates where id = p_candidate_id for update;
  if not found then
    raise exception 'Candidate not found';
  end if;
  if v_cand.updated_at is distinct from p_expected_updated_at then
    raise exception 'Candidate changed';
  end if;

  if p_decision = 'approve' then
    if v_cand.status <> 'needs_review' then raise exception 'Invalid status transition'; end if;
    v_status := 'approved';
  elsif p_decision = 'reject' then
    if v_cand.status <> 'needs_review' then raise exception 'Invalid status transition'; end if;
    v_status := 'rejected';
  else
    if v_cand.status not in ('ready','needs_review') then raise exception 'Invalid status transition'; end if;
    v_status := 'needs_review';
  end if;
  if v_cand.published_event_id is not null then
    raise exception 'Invalid status transition';
  end if;

  v_title := coalesce(p_fields ->> 'title', v_cand.title);
  v_description := case when p_fields ? 'description' then p_fields ->> 'description' else v_cand.description end;
  v_starts := case when p_fields ? 'starts_at' then (p_fields ->> 'starts_at')::timestamptz else v_cand.starts_at end;
  v_ends := case when p_fields ? 'ends_at' then (p_fields ->> 'ends_at')::timestamptz else v_cand.ends_at end;
  v_address := case when p_fields ? 'address' then p_fields ->> 'address' else v_cand.address end;
  v_lat := case when p_fields ? 'latitude' then (p_fields ->> 'latitude')::double precision else v_cand.latitude end;
  v_lng := case when p_fields ? 'longitude' then (p_fields ->> 'longitude')::double precision else v_cand.longitude end;
  v_categories := case when p_fields ? 'category_slugs'
    then array(select pg_catalog.jsonb_array_elements_text(p_fields -> 'category_slugs')) else v_cand.category_slugs end;
  v_reasons := case when p_fields ? 'validation_reasons' then p_fields -> 'validation_reasons' else v_cand.validation_reasons end;

  if v_title is null or pg_catalog.length(pg_catalog.btrim(v_title)) = 0 then
    raise exception 'Invalid review request';
  end if;

  if v_status = 'approved' then
    if not p_hard_gates_passed
       or pg_catalog.length(pg_catalog.btrim(v_title)) < 5
       or v_starts is null or v_ends is null or v_ends <= v_starts
       or v_address is null or pg_catalog.length(pg_catalog.btrim(v_address)) < 10
       or v_lat is null or v_lng is null
       or not coalesce((p_fields ->> 'location_verified')::boolean, v_cand.location_verified)
       or not coalesce((p_fields ->> 'vendor_verified')::boolean, v_cand.vendor_verified)
       or coalesce((p_fields ->> 'cancelled')::boolean, v_cand.cancelled)
       or coalesce(p_fields ->> 'duplicate_state', v_cand.duplicate_state) <> 'clear' then
      raise exception 'Hard gates unresolved';
    end if;
  end if;

  update ingestion.candidates set
    title = v_title,
    description = v_description,
    starts_at = v_starts,
    ends_at = v_ends,
    address = v_address,
    organizer_name = case when p_fields ? 'organizer_name' then p_fields ->> 'organizer_name' else organizer_name end,
    venue_name = case when p_fields ? 'venue_name' then p_fields ->> 'venue_name' else venue_name end,
    latitude = v_lat,
    longitude = v_lng,
    category_slugs = v_categories,
    vendor_count = case when p_fields ? 'vendor_count' then (p_fields ->> 'vendor_count')::integer else vendor_count end,
    validation_reasons = v_reasons,
    score = coalesce((p_fields ->> 'score')::integer, score),
    is_market = coalesce((p_fields ->> 'is_market')::boolean, is_market),
    location_verified = coalesce((p_fields ->> 'location_verified')::boolean, location_verified),
    vendor_verified = coalesce((p_fields ->> 'vendor_verified')::boolean, vendor_verified),
    cancelled = coalesce((p_fields ->> 'cancelled')::boolean, cancelled),
    duplicate_state = coalesce(p_fields ->> 'duplicate_state', duplicate_state),
    status = v_status,
    manual_override = manual_override or v_status = 'rejected' or v_changes <> '{}'::pg_catalog.jsonb,
    approved_by = case when v_status = 'approved' then p_reviewer_id else null end,
    updated_at = v_now
  where id = v_cand.id;

  insert into ingestion.reviews(candidate_id, reviewer_id, decision, reason, changes)
  values (v_cand.id, p_reviewer_id, p_decision, pg_catalog.btrim(p_reason), v_changes);

  return v_status;
end;
$$;

revoke all on function ingestion.apply_review(uuid,uuid,text,text,jsonb,timestamptz,jsonb,boolean)
  from public,anon,authenticated;
grant execute on function ingestion.apply_review(uuid,uuid,text,text,jsonb,timestamptz,jsonb,boolean)
  to service_role;
