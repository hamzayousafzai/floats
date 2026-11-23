-- Automated event ingestion: staging verification queries (READ-ONLY).
--
-- Run in the SQL editor of the ISOLATED STAGING project after the baseline and the migrations are applied, and attach the
-- full output to the launch checklist. This file contains one SELECT and changes nothing. It has been executed only on the
-- substitute test database (tests/ingestion/db-harness); it has never been run on a real Supabase project.
--
-- Result columns: check_name, status, detail.
--   pass    the condition holds.
--   FAIL    the condition does not hold. Do not proceed.
--   REVIEW  a human must read the detail and sign it off (listed triggers, URLs found in function bodies).
--   n/a     the check cannot be evaluated here (for example Data API settings outside Supabase).
-- Required result: no FAIL rows, and every REVIEW row explained in the shadow-results document.
-- An error such as `relation "ingestion.runs" does not exist` means the migrations have not been applied yet; the query
-- cannot report on a schema that is absent.
-- The harness (verify-sql.mjs) runs this exact file on the migrated test database and also proves that it flags a function
-- calling the production project, anon grants, disabled RLS and a missing lock index.

with
pg as (
  select n.nspname as schema_name
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'postgis'
),
ingestion_tables as (
  select c.oid, c.relname, 'ingestion.' || c.relname as qualified
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'ingestion' and c.relkind = 'r'
  union all
  select c.oid, c.relname, 'public.' || c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'event_ingestion_links' and c.relkind = 'r'
),
ingestion_functions as (
  select p.oid, p.proname, p.prosecdef, p.proconfig, p.oid::regprocedure::text as signature
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'ingestion'
),
user_functions as (
  select p.oid, n.nspname || '.' || p.proname as name, p.prosrc
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname not in ('pg_catalog', 'information_schema', 'extensions', 'pg_toast')
    and n.nspname not like 'pg\_%'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
),
checks as (
  -- Baseline -----------------------------------------------------------------------------------------------------------
  select 10 as ord, 'baseline: postgis extension installed' as check_name,
         case when exists (select 1 from pg) then 'pass' else 'FAIL' end as status,
         (select 'schema ' || schema_name from pg) as detail
  union all
  select 11, 'baseline: pgcrypto extension installed',
         case when exists (select 1 from pg_extension where extname = 'pgcrypto') then 'pass' else 'FAIL' end, null
  union all
  select 12, 'baseline: auth.users exists',
         case when to_regclass('auth.users') is not null then 'pass' else 'FAIL' end, null
  union all
  select 13, 'baseline: roles anon, authenticated, service_role exist',
         case when (select count(*) from pg_roles where rolname in ('anon', 'authenticated', 'service_role')) = 3 then 'pass' else 'FAIL' end, null
  union all
  select 14, 'baseline: public.events, categories, event_categories, app_admins exist',
         case when to_regclass('public.events') is not null and to_regclass('public.categories') is not null
                and to_regclass('public.event_categories') is not null and to_regclass('public.app_admins') is not null
              then 'pass' else 'FAIL' end, null
  union all
  select 15, 'baseline: public.events has every column ingestion uses',
         case when m.missing is null then 'pass' else 'FAIL' end,
         case when m.missing is null then null else 'missing: ' || m.missing end
  from (
    select string_agg(col, ', ') as missing
    from unnest(array['id', 'title', 'description', 'starts_at', 'ends_at', 'address', 'latitude', 'longitude', 'geom',
                      'event_url', 'image_url', 'status', 'is_market', 'is_featured', 'org_id', 'vendor_id', 'market_id', 'series_id']) col
    where not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'events' and c.column_name = col)
  ) m
  union all
  select 16, 'baseline: a public.events trigger populates geom from latitude/longitude',
         case when exists (
           select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
           where t.tgrelid = to_regclass('public.events') and not t.tgisinternal and p.proname = 'events_set_geom_from_latlon'
         ) then 'pass' else 'FAIL' end, null

  -- Ingestion objects ----------------------------------------------------------------------------------------------------
  union all
  select 20, 'ingestion: the eight tables exist',
         case when (select array_agg(relname order by relname) from ingestion_tables where qualified like 'ingestion.%')
                   = array['candidate_sources', 'candidates', 'observations', 'publication_audit', 'reviews', 'runs', 'source_discoveries', 'sources']::name[]
              then 'pass' else 'FAIL' end,
         (select string_agg(relname, ', ' order by relname) from ingestion_tables where qualified like 'ingestion.%')
  union all
  select 21, 'ingestion: public.event_ingestion_links exists',
         case when exists (select 1 from ingestion_tables where qualified = 'public.event_ingestion_links') then 'pass' else 'FAIL' end, null
  union all
  select 22, 'security: row level security is enabled on all nine tables',
         case when (select count(*) from ingestion_tables) = 9
                   and not exists (select 1 from ingestion_tables t join pg_class c on c.oid = t.oid where not c.relrowsecurity)
              then 'pass' else 'FAIL' end,
         (select string_agg(t.qualified, ', ') from ingestion_tables t join pg_class c on c.oid = t.oid where not c.relrowsecurity)
  union all
  select 23, 'security: anon, authenticated and PUBLIC hold no privilege on any of them',
         case when not exists (
           select 1 from ingestion_tables t, unnest(array['anon', 'authenticated', 'public']) r
           where has_table_privilege(r, t.oid, 'select,insert,update,delete,truncate,references,trigger')
         ) then 'pass' else 'FAIL' end,
         (select string_agg(r || ' on ' || t.qualified, ', ') from ingestion_tables t, unnest(array['anon', 'authenticated', 'public']) r
          where has_table_privilege(r, t.oid, 'select,insert,update,delete,truncate,references,trigger'))
  union all
  select 24, 'security: service_role can select, insert, update and delete on all nine tables',
         case when (select count(*) from ingestion_tables) = 9 and not exists (
           select 1 from ingestion_tables t
           where not (has_table_privilege('service_role', t.oid, 'select') and has_table_privilege('service_role', t.oid, 'insert')
                  and has_table_privilege('service_role', t.oid, 'update') and has_table_privilege('service_role', t.oid, 'delete'))
         ) then 'pass' else 'FAIL' end, null
  union all
  select 25, 'security: schema ingestion is usable by service_role only',
         case when to_regnamespace('ingestion') is not null
                   and has_schema_privilege('service_role', 'ingestion', 'usage')
                   and not has_schema_privilege('anon', 'ingestion', 'usage')
                   and not has_schema_privilege('authenticated', 'ingestion', 'usage')
                   and not has_schema_privilege('public', 'ingestion', 'usage')
              then 'pass' else 'FAIL' end, null
  union all
  select 26, 'security: no ingestion function is executable by anon, authenticated or PUBLIC',
         case when not exists (
           select 1 from ingestion_functions f, unnest(array['anon', 'authenticated', 'public']) r where has_function_privilege(r, f.oid, 'execute')
         ) then 'pass' else 'FAIL' end,
         (select string_agg(r || ' on ' || f.signature, ', ') from ingestion_functions f, unnest(array['anon', 'authenticated', 'public']) r where has_function_privilege(r, f.oid, 'execute'))
  union all
  select 27, 'security: service_role can execute publish_candidate, update_imported_event and apply_review',
         case when to_regprocedure('ingestion.publish_candidate(uuid,integer,double precision,double precision,double precision,integer,boolean)') is not null
                   and to_regprocedure('ingestion.update_imported_event(uuid,jsonb,text,double precision,double precision,double precision)') is not null
                   and to_regprocedure('ingestion.apply_review(uuid,uuid,text,text,jsonb,timestamptz,jsonb,boolean)') is not null
                   and has_function_privilege('service_role', to_regprocedure('ingestion.publish_candidate(uuid,integer,double precision,double precision,double precision,integer,boolean)'), 'execute')
                   and has_function_privilege('service_role', to_regprocedure('ingestion.update_imported_event(uuid,jsonb,text,double precision,double precision,double precision)'), 'execute')
                   and has_function_privilege('service_role', to_regprocedure('ingestion.apply_review(uuid,uuid,text,text,jsonb,timestamptz,jsonb,boolean)'), 'execute')
              then 'pass' else 'FAIL' end, null
  union all
  select 28, 'security: every SECURITY DEFINER ingestion function pins search_path',
         case when not exists (
           select 1 from ingestion_functions f where f.prosecdef and not coalesce(exists (select 1 from unnest(f.proconfig) c where c like 'search_path=%'), false)
         ) then 'pass' else 'FAIL' end,
         (select string_agg(f.signature, ', ') from ingestion_functions f where f.prosecdef and not coalesce(exists (select 1 from unnest(f.proconfig) c where c like 'search_path=%'), false))
  union all
  select 29, 'postgis: publish_candidate calls ST_* qualified with the real PostGIS schema',
         case when exists (
           select 1 from pg_proc p, pg
           where p.oid = to_regprocedure('ingestion.publish_candidate(uuid,integer,double precision,double precision,double precision,integer,boolean)')
             and p.prosrc ilike '%' || pg.schema_name || '.st_dwithin%'
         ) then 'pass' else 'FAIL' end,
         (select 'postgis schema: ' || schema_name from pg)

  -- Deletion policy and run lock -------------------------------------------------------------------------------------------
  union all
  select 30, 'deletion: candidates.published_event_id and publication_audit.event_id are ON DELETE SET NULL',
         case when (select count(*) from pg_constraint c
                    where c.contype = 'f' and c.confrelid = to_regclass('public.events') and c.confdeltype = 'n'
                      and c.conrelid in (to_regclass('ingestion.candidates'), to_regclass('ingestion.publication_audit'))) = 2
              then 'pass' else 'FAIL' end, null
  union all
  select 31, 'deletion: event_ingestion_links cascades when its event is deleted',
         case when exists (select 1 from pg_constraint c where c.contype = 'f' and c.conrelid = to_regclass('public.event_ingestion_links')
                                                           and c.confrelid = to_regclass('public.events') and c.confdeltype = 'c')
              then 'pass' else 'FAIL' end, null
  union all
  select 32, 'deletion: audit actions include event_deleted and the removal trigger exists',
         case when exists (select 1 from pg_constraint c where c.conname = 'publication_audit_action_check' and pg_get_constraintdef(c.oid) like '%event_deleted%')
                   and exists (select 1 from pg_trigger t where t.tgname = 'trg_candidates_record_event_removal' and not t.tgisinternal)
              then 'pass' else 'FAIL' end, null
  union all
  select 33, 'run lock: uq_runs_one_running_per_type and uq_runs_one_running_pipeline exist and are unique',
         case when (select count(*) from pg_index i join pg_class c on c.oid = i.indexrelid
                    where c.relname in ('uq_runs_one_running_per_type', 'uq_runs_one_running_pipeline')
                      and i.indrelid = to_regclass('ingestion.runs') and i.indisunique and i.indpred is not null) = 2
              then 'pass' else 'FAIL' end, null
  union all
  select 34, 'run lock: no more than one pipeline run is currently marked running',
         case when (select count(*) from ingestion.runs where status = 'running' and run_type in ('collection', 'verification', 'replay')) <= 1
              then 'pass' else 'FAIL' end,
         (select count(*) || ' running' from ingestion.runs where status = 'running')

  -- Isolation from production -------------------------------------------------------------------------------------------------
  union all
  select 40, 'isolation: no function body references the production project ref',
         case when not exists (select 1 from user_functions f where f.prosrc ilike '%inxlsvowzpqvfulhbnou%') then 'pass' else 'FAIL' end,
         (select string_agg(f.name, ', ') from user_functions f where f.prosrc ilike '%inxlsvowzpqvfulhbnou%')
  union all
  select 41, 'isolation: functions that call a hosted URL (confirm each points at THIS staging project)',
         case when exists (select 1 from user_functions f where f.prosrc ~* 'https?://[a-z0-9.-]+\.supabase\.(co|in)') then 'REVIEW' else 'pass' end,
         (select string_agg(f.name, ', ') from user_functions f where f.prosrc ~* 'https?://[a-z0-9.-]+\.supabase\.(co|in)')
  union all
  select 42, 'isolation: public.events triggers (read each; none may notify users, send email or call a production URL)',
         'REVIEW',
         (select coalesce(string_agg(t.tgname || ' -> ' || p.proname, '; ' order by t.tgname), 'no triggers')
          from pg_trigger t join pg_proc p on p.oid = t.tgfoid
          where t.tgrelid = to_regclass('public.events') and not t.tgisinternal)
  union all
  select 43, 'isolation: public.events trigger functions that mention net.http, email or notification (heuristic)',
         case when exists (
           select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
           where t.tgrelid = to_regclass('public.events') and not t.tgisinternal and p.prosrc ~* '(net\.http|http_post|send_?mail|resend|notif|enqueue)'
         ) then 'REVIEW' else 'pass' end,
         (select string_agg(distinct p.proname, ', ') from pg_trigger t join pg_proc p on p.oid = t.tgfoid
          where t.tgrelid = to_regclass('public.events') and not t.tgisinternal and p.prosrc ~* '(net\.http|http_post|send_?mail|resend|notif|enqueue)')

  -- Data API ---------------------------------------------------------------------------------------------------------------------
  union all
  select 50, 'data api: ingestion is listed in the exposed schemas (PostgREST db_schemas)',
         case when not exists (select 1 from pg_roles where rolname = 'authenticator') then 'n/a'
              when exists (select 1 from pg_roles r, unnest(r.rolconfig) c where r.rolname = 'authenticator' and c like 'pgrst.db_schemas=%ingestion%') then 'pass'
              else 'FAIL' end,
         (select string_agg(c, '; ') from pg_roles r, unnest(r.rolconfig) c where r.rolname = 'authenticator' and c like 'pgrst.%')
)
select check_name, status, detail from checks order by ord;
