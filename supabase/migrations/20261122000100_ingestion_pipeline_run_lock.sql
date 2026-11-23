-- Automated event ingestion, part 4 (forward-only): one shared lock for pipeline runs.
-- Applies after 20261121000100_ingestion_event_deletion_policy.sql. Earlier migrations are NOT rewritten.
--
-- uq_runs_one_running_per_type (part 2) lets a collection, a verification and a replay run at the same time. They all fetch
-- the same third-party sources and write observations and candidates, so overlap duplicates source requests, races the
-- source metrics and makes verification's "owned event not seen" comparison unreliable. Row-level publication safety is
-- unchanged: publish_candidate and update_imported_event take their own advisory and row locks.
--
-- This index allows at most one `running` row across collection, verification and replay. Discovery only registers sources
-- and keeps its own per-type lock. Workers close stale runs before starting, so a crashed run cannot block the pipeline for
-- longer than the stale window (90 minutes by default).

-- If the old rules already allowed overlapping runs, keep the newest and close the rest so the index can be created.
update ingestion.runs r
set status = 'failed',
    finished_at = now(),
    error_summary = 'Closed by migration 20261122000100: overlapping pipeline runs are no longer allowed'
where r.status = 'running'
  and r.run_type in ('collection', 'verification', 'replay')
  and exists (
    select 1
    from ingestion.runs newer
    where newer.status = 'running'
      and newer.run_type in ('collection', 'verification', 'replay')
      and (newer.started_at, newer.id) > (r.started_at, r.id)
  );

create unique index if not exists uq_runs_one_running_pipeline
  on ingestion.runs ((true))
  where status = 'running' and run_type in ('collection', 'verification', 'replay');
