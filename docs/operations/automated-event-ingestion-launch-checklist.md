# Automated Event Ingestion - Launch Checklist

Deployment state: NOT_DEPLOYED. Live automatic publication: DISABLED (shadow). Nothing here has been run against a real Supabase project.

## Done (offline evidence only)
- [x] Code, migrations (four ingestion migrations), tests and workflows written (TASK-01..27; TASK-28 docs). See the requirements matrix.
- [x] Quality gate results are recorded with exact commands in `automated-event-ingestion-final-assessment.md`. Lint and tsc show no new errors against the 30 + 30 baseline.
- [x] SQL harness passes on the substitute embedded PostgreSQL only. This is not real Supabase or real PostGIS.
- [x] Docs, migrations and `.env.example` are no longer gitignored and are committed on `ingestion-update`.
- [x] Workflow actions pinned to commit SHAs; Chromium install removed; verify step added.

## Required before an isolated shadow run (operator)
- [ ] BLOCKED: create an ISOLATED Supabase staging project (never production), build its baseline schema (the repository cannot recreate it; see `automated-event-ingestion-staging-setup.md`), then apply `20260501000000_add_event_url.sql` and the four ingestion migrations in order; record the output.
- [ ] BLOCKED: run `automated-event-ingestion-staging-checks.sql` on the staging database and attach the output; no row may report `FAIL` and every `REVIEW` row must be explained.
- [ ] BLOCKED: run `automated-event-ingestion-staging-write-checks.sql` (rolled-back publication, deletion, ownership and role probes) and attach the output; no `FAIL`.
- [ ] BLOCKED: run `npm run ingest:staging-check` (guarded, read-only role access over the real Data API) and attach the output; exit 0.
- [ ] BLOCKED: confirm no function body or trigger on the staging database points at the production project (the baseline `on_event_address_change` calls a hardcoded production URL).
- [ ] BLOCKED: add `ingestion` to the Data API exposed schemas (the workers call `client.schema('ingestion')`), then confirm `anon` and `authenticated` get `permission denied` for every ingestion table and function.
- [ ] BLOCKED: list `public.events` triggers (`pg_trigger`, non-internal) and confirm no user-visible notification side effects.
- [ ] BLOCKED: confirm PostGIS is installed in the project and `ingestion.publish_candidate` / `update_imported_event` resolve `ST_*` functions.
- [ ] BLOCKED: set GitHub secrets from the STAGING project only; run `ingest:seed`, `ingest:daily`, `ingest:discover`, `ingest:verify` with `INGESTION_PUBLISH_MODE=shadow`.
- [ ] Rotate the production credentials found in `.env.local`.

## Required before merging to main (schedules start from the default branch)
- [ ] Three consecutive shadow days with reviewed results (`automated-event-ingestion-shadow-results.md`), separating automatic writes (must be zero) from admin manual publishes.
- [ ] BLOCKED: per-source ToS review and live selector verification (Wix/Squarespace).
- [x] actionlint v1.7.12 passed locally on both workflows (checksum-verified binary); re-run it in CI.
- [ ] Decision on the map UI changes from base commits `cb6dc8b` and `1a5d794` (see assessment, D6): they belong to a separate PR.
- [ ] Failure notifications enabled for the repository.

## Required before live automatic publication
- [ ] BLOCKED: a compliant geocoder configured, or sources marked `coordinateTrust: verified` after review.
- [ ] Explicit owner approval before setting `INGESTION_PUBLISH_MODE=live`.
- [ ] Decide on an admin archive/cancel action (none exists today).
- [ ] Do not wire Playwright until network containment exists.
