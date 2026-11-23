-- Automated event ingestion, part 3 (forward-only): event deletion policy.
-- Applies after 20261120000200_ingestion_updates_and_review.sql. The earlier migrations are NOT rewritten.
--
-- Problem: ingestion.candidates.published_event_id and ingestion.publication_audit.event_id referenced public.events(id)
-- with the default NO ACTION, so deleting an imported event (for example by an admin) failed with a foreign key error.
--
-- Policy chosen here (review before applying; see docs/operations/automated-event-ingestion-final-assessment.md):
--   * Deleting a public event never deletes, and is never blocked by, candidates, reviews, observations or audit rows.
--   * Both pointers become NULL (ON DELETE SET NULL). public.event_ingestion_links already cascades with the event.
--   * The candidate keeps status 'published', so neither automatic nor manual publication can resurrect a deleted event.
--   * An 'event_deleted' audit row records the former event id so the provenance trail stays complete.
-- Nothing in public.events, its FKs or its triggers is changed.

do $migration$
declare
  r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname
    from pg_catalog.pg_constraint c
    where c.contype = 'f'
      and c.confrelid = 'public.events'::regclass
      and c.conrelid in ('ingestion.candidates'::regclass, 'ingestion.publication_audit'::regclass)
  loop
    execute pg_catalog.format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end
$migration$;

alter table ingestion.candidates
  add constraint candidates_published_event_id_fkey
  foreign key (published_event_id) references public.events(id) on delete set null;

alter table ingestion.publication_audit
  add constraint publication_audit_event_id_fkey
  foreign key (event_id) references public.events(id) on delete set null;

alter table ingestion.publication_audit drop constraint if exists publication_audit_action_check;
alter table ingestion.publication_audit
  add constraint publication_audit_action_check
  check (action in ('shadow_approved','published','skipped_duplicate','blocked','archived','updated','event_deleted'));

-- Fires when ON DELETE SET NULL detaches a published event from its candidate.
create or replace function ingestion.record_event_removal()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.published_event_id is not null and new.published_event_id is null and old.status = 'published' then
    insert into ingestion.publication_audit(candidate_id, event_id, action, reason, details)
    values (new.id, null, 'event_deleted', 'public_event_removed',
            pg_catalog.jsonb_build_object('former_event_id', old.published_event_id));
  end if;
  return new;
end;
$$;
revoke all on function ingestion.record_event_removal() from public, anon, authenticated;

drop trigger if exists trg_candidates_record_event_removal on ingestion.candidates;
create trigger trg_candidates_record_event_removal
  after update of published_event_id on ingestion.candidates
  for each row execute function ingestion.record_event_removal();
