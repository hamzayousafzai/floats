# Automated Event Ingestion - Launch Checklist

Deployment state: NOT_DEPLOYED. Live automatic publication: DISABLED (shadow). Nothing here has been run against a real Supabase project.

## Done (offline evidence only)
- [x] Code, migrations (three), tests and workflows written (TASK-01..27; TASK-28 docs). See the requirements matrix.
- [x] Quality gate results are recorded with exact commands in `automated-event-ingestion-final-assessment.md`. Lint and tsc show no new errors against the 30 + 30 baseline.
- [x] SQL harness passes on the substitute embedded PostgreSQL only. This is not real Supabase or real PostGIS.
- [x] Docs, migrations and `.env.example` are no longer gitignored (staged, not committed).
- [x] Workflow actions pinned to commit SHAs; Chromium install removed; verify step added.

## Required before an isolated shadow run (operator)
- [ ] BLOCKED: create an ISOLATED Supabase staging project (never production) and apply the three ingestion migrations in order; record the output.
- [ ] BLOCKED: add `ingestion` to the Data API exposed schemas (the workers call `client.schema('ingestion')`), then confirm `anon` and `authenticated` get `permission denied` for every ingestion table and function.
- [ ] BLOCKED: list `public.events` triggers (`pg_trigger`, non-internal) and confirm no user-visible notification side effects.
- [ ] BLOCKED: confirm PostGIS is installed in the project and `ingestion.publish_candidate` / `update_imported_event` resolve `ST_*` functions.
- [ ] BLOCKED: set GitHub secrets from the STAGING project only; run `ingest:seed`, `ingest:daily`, `ingest:discover`, `ingest:verify` with `INGESTION_PUBLISH_MODE=shadow`.
- [ ] Rotate the production credentials found in `.env.local`.

## Required before merging to main (schedules start from the default branch)
- [ ] Three consecutive shadow days with reviewed results (`automated-event-ingestion-shadow-results.md`), separating automatic writes (must be zero) from admin manual publishes.
- [ ] BLOCKED: per-source ToS review and live selector verification (Wix/Squarespace).
- [ ] BLOCKED: actionlint on both workflows (not installed here).
- [ ] Decision on the map UI changes from base commits `cb6dc8b` and `1a5d794` (see assessment, D6): they belong to a separate PR.
- [ ] Failure notifications enabled for the repository.

## Required before live automatic publication
- [ ] BLOCKED: a compliant geocoder configured, or sources marked `coordinateTrust: verified` after review.
- [ ] Explicit owner approval before setting `INGESTION_PUBLISH_MODE=live`.
- [ ] Decide on an admin archive/cancel action (none exists today).
- [ ] Do not wire Playwright until network containment exists.
