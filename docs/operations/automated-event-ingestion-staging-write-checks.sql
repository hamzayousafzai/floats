-- Automated event ingestion: staging WRITE checks (publication, deletion, ownership, role access). Everything is ROLLED BACK.
--
-- Run in the SQL editor (or psql with ON_ERROR_STOP) of the ISOLATED STAGING project, after the migrations are applied and
-- automated-event-ingestion-staging-checks.sql reports no FAIL. It creates one throwaway source and a few throwaway candidates and
-- events inside a single transaction, exercises publication, deletion and role access, prints the result table, and rolls back.
-- It has been executed only on the substitute test database (tests/ingestion/db-harness); never on a real Supabase project.
--
-- It REFUSES to run (raises an exception) when any function body references the production project, because publishing an event
-- fires the baseline `public.events` triggers, one of which may call a hosted function. If it raises, run `rollback;` and fix the
-- baseline first (see the staging setup guide).
--
-- Result columns: check_name, status, detail. Required result: no FAIL rows. A REVIEW row means the baseline `public.events`
-- has additional required columns that a hand-made event could not satisfy; read the detail and sign it off.
-- Nothing is committed: if the script is interrupted, run `rollback;`.

begin;

do $guard$
begin
  if to_regclass('ingestion.candidates') is null or to_regclass('public.event_ingestion_links') is null then
    raise exception 'Refusing to run: the ingestion migrations are not applied.';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema', 'extensions', 'pg_toast')
      and n.nspname not like 'pg\_%'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and p.prosrc ilike '%inxlsvowzpqvfulhbnou%'
  ) then
    raise exception 'Refusing to run: a function body references the production project. Fix the baseline, then rerun.';
  end if;
end
$guard$;

create temp table wc (ord int, check_name text, status text, detail text) on commit drop;

create function pg_temp.wc_candidate(p_source uuid, p_title text, p_address text, p_days int)
returns uuid language plpgsql as $f$
declare
  v_id uuid;
  v_start timestamptz := date_trunc('hour', now()) + make_interval(days => p_days) + interval '15 minutes';
begin
  insert into ingestion.candidates
    (primary_source_id, canonical_key, source_url, title, description, starts_at, ends_at, address, latitude, longitude,
     category_slugs, score, is_market, location_verified, vendor_verified, cancelled, duplicate_state, status, organizer_name)
  values
    (p_source, encode(sha256(convert_to(gen_random_uuid()::text, 'utf8')), 'hex'),
     'https://example.invalid/write-check/' || gen_random_uuid(), p_title,
     'Write-check candidate: a multi-vendor market featuring local makers.', v_start, v_start + interval '5 hours',
     p_address, 35.2271, -80.8431, '{}'::text[], 95, true, true, true, false, 'clear', 'ready', 'Write Check Organizer')
  returning id into v_id;
  return v_id;
end
$f$;

do $wc$
declare
  v_source uuid;
  v_cand uuid;
  v_event uuid;
  v_again uuid;
  v_cand2 uuid;
  v_event2 uuid;
  v_hand uuid;
  v_audits_before int;
  v_n int;
  v_ok boolean;
begin
  insert into ingestion.sources (name, base_url, source_type, adapter, trust_state, enabled)
  values ('WRITE-CHECK (rolled back)', 'https://example.invalid/write-check/' || gen_random_uuid(), 'organizer', 'html', 'trusted', true)
  returning id into v_source;

  -- 100: publication, provenance and replay ------------------------------------------------------------------------------
  begin
    v_cand := pg_temp.wc_candidate(v_source, 'Write Check Makers Market', '1 Write Check Way, Charlotte, NC 28202', 45);
    v_event := ingestion.publish_candidate(v_cand, 90, 35.2271, -80.8431, 35, 60, false);
    select count(*) into v_n from public.events e where e.id = v_event and e.status = 'published' and e.geom is not null;
    insert into wc values (100, 'publish: a trusted ready candidate becomes a published event with geometry', case when v_n = 1 then 'pass' else 'FAIL' end, 'event ' || coalesce(v_event::text, 'null'));
    select count(*) into v_n from public.event_ingestion_links l
      where l.event_id = v_event and l.candidate_id = v_cand and l.source_id = v_source and l.management_state = 'ingestion';
    insert into wc values (101, 'ownership: the event carries an ingestion provenance link', case when v_n = 1 then 'pass' else 'FAIL' end, null);
    select count(*) into v_n from public.events e where e.id = v_event and e.org_id is null and e.vendor_id is null and e.market_id is null and e.series_id is null;
    insert into wc values (102, 'ownership: the event is attached to no organisation, vendor, market or series', case when v_n = 1 then 'pass' else 'FAIL' end, null);
    v_again := ingestion.publish_candidate(v_cand, 90, 35.2271, -80.8431, 35, 60, false);
    select count(*) into v_n from public.event_ingestion_links l where l.candidate_id = v_cand;
    insert into wc values (103, 'publish: replaying the same candidate returns the same event and no second link', case when v_again = v_event and v_n = 1 then 'pass' else 'FAIL' end, null);
  exception when others then
    insert into wc values (100, 'publish: a trusted ready candidate becomes a published event', 'FAIL', sqlerrm);
  end;

  -- 110: deleting an imported event ----------------------------------------------------------------------------------
  begin
    delete from public.events where id = v_event;
    insert into wc values (110, 'deletion: an imported event can be deleted', 'pass', null);
    select count(*) into v_n from public.event_ingestion_links where event_id = v_event;
    insert into wc values (111, 'deletion: the provenance link is removed with the event', case when v_n = 0 then 'pass' else 'FAIL' end, null);
    select count(*) into v_n from ingestion.candidates where id = v_cand and status = 'published' and published_event_id is null;
    insert into wc values (112, 'deletion: the candidate survives, stays published and its event pointer is cleared', case when v_n = 1 then 'pass' else 'FAIL' end, null);
    select count(*) into v_n from ingestion.publication_audit where candidate_id = v_cand and action = 'event_deleted' and details ->> 'former_event_id' = v_event::text;
    insert into wc values (113, 'deletion: an event_deleted audit row records the former event id', case when v_n = 1 then 'pass' else 'FAIL' end, null);
    select count(*) into v_n from ingestion.publication_audit where candidate_id = v_cand and action = 'published' and event_id is null;
    insert into wc values (114, 'deletion: the original publication audit row is retained', case when v_n = 1 then 'pass' else 'FAIL' end, null);
  exception when others then
    insert into wc values (110, 'deletion: an imported event can be deleted', 'FAIL', sqlerrm);
  end;

  begin
    v_ok := false;
    begin
      perform ingestion.publish_candidate(v_cand, 90, 35.2271, -80.8431, 35, 60, false);
    exception when others then
      v_ok := sqlerrm like '%Automatic publication not permitted%';
    end;
    insert into wc values (115, 'deletion: a deleted event is never republished automatically', case when v_ok then 'pass' else 'FAIL' end, null);
    select count(*) into v_n from public.events where title = 'Write Check Makers Market';
    insert into wc values (116, 'deletion: no event was recreated', case when v_n = 0 then 'pass' else 'FAIL' end, null);
  exception when others then
    insert into wc values (115, 'deletion: a deleted event is never republished automatically', 'FAIL', sqlerrm);
  end;

  -- 120: archiving is not deletion --------------------------------------------------------------------------------------
  begin
    v_cand2 := pg_temp.wc_candidate(v_source, 'Write Check Archive Market', '2 Write Check Way, Charlotte, NC 28202', 46);
    v_event2 := ingestion.publish_candidate(v_cand2, 90, 35.2271, -80.8431, 35, 60, false);
    update public.events set status = 'archived' where id = v_event2;
    select count(*) into v_n from ingestion.candidates where id = v_cand2 and published_event_id = v_event2;
    insert into wc values (120, 'archive: archiving keeps the candidate pointer', case when v_n = 1 then 'pass' else 'FAIL' end, null);
    select count(*) into v_n from ingestion.publication_audit where candidate_id = v_cand2 and action = 'event_deleted';
    insert into wc values (121, 'archive: archiving writes no deletion audit', case when v_n = 0 then 'pass' else 'FAIL' end, null);
  exception when others then
    insert into wc values (120, 'archive: archiving keeps the candidate pointer', 'FAIL', sqlerrm);
  end;

  -- 130: a manually created event is outside ingestion ownership ----------------------------------------------------
  begin
    select count(*) into v_audits_before from ingestion.publication_audit;
    insert into public.events (title, starts_at, ends_at, status)
    values ('Write Check Hand Made Event', now() + interval '60 days', now() + interval '60 days 3 hours', 'published')
    returning id into v_hand;
    select count(*) into v_n from public.event_ingestion_links where event_id = v_hand;
    insert into wc values (130, 'ownership: a manually created event has no provenance link', case when v_n = 0 then 'pass' else 'FAIL' end, null);
    delete from public.events where id = v_hand;
    select count(*) into v_n from ingestion.publication_audit;
    insert into wc values (131, 'ownership: deleting a manual event touches no ingestion rows', case when v_n = v_audits_before then 'pass' else 'FAIL' end, null);
  exception when others then
    insert into wc values (130, 'ownership: a hand-made event could not be created with only title, dates and status', 'REVIEW', sqlerrm);
  end;
end
$wc$;

-- 200: role access. Each probe changes role, records the outcome in a setting, resets the role, and only then writes the row.
do $roles$
declare
  v_role text;
  v_target text;
  v_outcome text;
  v_sql text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_target in array array['ingestion.sources', 'ingestion.candidates', 'public.event_ingestion_links'] loop
      execute format('set local role %I', v_role);
      begin
        execute format('select count(*) from %s', v_target);
        v_outcome := 'readable';
      exception when insufficient_privilege then
        v_outcome := 'denied';
      when others then
        v_outcome := 'error: ' || sqlerrm;
      end;
      reset role;
      insert into wc values (200, 'role access: ' || v_role || ' cannot read ' || v_target, case when v_outcome = 'denied' then 'pass' else 'FAIL' end, v_outcome);
    end loop;

    execute format('set local role %I', v_role);
    begin
      perform ingestion.publish_candidate(gen_random_uuid(), 90, 35.2271, -80.8431, 35, 60, false);
      v_outcome := 'executed';
    exception when insufficient_privilege then
      v_outcome := 'denied';
    when others then
      v_outcome := 'error: ' || sqlerrm;
    end;
    reset role;
    insert into wc values (201, 'role access: ' || v_role || ' cannot execute publish_candidate', case when v_outcome = 'denied' then 'pass' else 'FAIL' end, v_outcome);
  end loop;

  execute 'set local role service_role';
  begin
    perform count(*) from ingestion.sources;
    perform count(*) from public.event_ingestion_links;
    v_outcome := 'readable';
  exception when others then
    v_outcome := 'error: ' || sqlerrm;
  end;
  reset role;
  insert into wc values (202, 'role access: service_role can read ingestion tables and provenance', case when v_outcome = 'readable' then 'pass' else 'FAIL' end, v_outcome);
end
$roles$;

select check_name, status, detail from wc order by ord, check_name;

rollback;
