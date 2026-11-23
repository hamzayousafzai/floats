# Automated Event Ingestion - Requirements Traceability Matrix

Source: `docs/plans/automated-event-ingestion-implementation-plan.md`. Deployment state: NOT_DEPLOYED.

Status key:
- **DONE** - implemented and covered by executed offline tests (in-memory fakes, fixtures, jest).
- **DONE (SUBSTITUTE-PG)** - additionally exercised on the embedded PostgreSQL plus PostGIS shim. This is not real Supabase or real PostGIS.
- **PARTIAL** - implemented, but part of the requirement needs something not available here.
- **BLOCKED** - cannot be completed without real Supabase, credentials, live sources or elapsed shadow days.

| Task | Requirement | Status | Evidence | Remaining / blocker |
|------|-------------|--------|----------|---------------------|
| TASK-01 | Reconcile repository and live-schema assumptions | PARTIAL | `docs/architecture/automated-event-ingestion-repository-audit.md` | BLOCKED: live schema, Data API exposure and `public.events` triggers are unverified |
| TASK-02 | Packages and script entrypoints | DONE | `package.json` scripts (`ingest:*`, `test:ingestion`) | none |
| TASK-03 | Runtime config and types | DONE | `tests/ingestion/config.test.ts` | none |
| TASK-04 | Private ingestion schema and publisher function | DONE (SUBSTITUTE-PG) | Migrations `20261120000100`, `20261120000200`, `20261121000100`, `20261122000100`; harness 318 PASS, 0 FAIL (substitute PostgreSQL), plus staging-check SQL files exercised there | BLOCKED: apply to real Supabase with real PostGIS on an operator-built baseline |
| TASK-05 | Typed backend persistence | DONE | `tests/ingestion/storage.test.ts` (incl. CAS metrics) | none |
| TASK-06 | Seed Charlotte organizers | DONE | `source-seeding.test.ts` | BLOCKED: live selector and ToS verification |
| TASK-07 | Safe HTTP network access | DONE | `adapters.test.ts`, `safe-fetch.test.ts`, `security.test.ts` (SSRF, redirects, DNS pinning) | none |
| TASK-08 | Generic structured and rendered adapters | PARTIAL | JSON-LD/HTML adapters tested. Playwright adapter is fail-closed (not registered, not installed): it is not SSRF-safe | Rendered adapter stays disabled until network containment exists |
| TASK-09 | Three high-priority source adapters | PARTIAL | `source-adapters.test.ts` fixtures | BLOCKED: live-source verification |
| TASK-10 | Normalization and stable identity | DONE | `normalization.test.ts` | none |
| TASK-11 | Geocode and radius checks | PARTIAL | `geocoding.test.ts`, `source-coordinates.test.ts`; radius gate; no provider configured so address-only candidates fail closed to `needs_review`; operator-verified source coordinates supported | BLOCKED: compliant geocoder not chosen or configured |
| TASK-12 | Classifier, hard gates, score | DONE | `scoring.test.ts`, `classification.test.ts`, `validation.test.ts` | none |
| TASK-13 | Duplicate matcher | DONE | `deduplication.test.ts` | none |
| TASK-14 | Candidate state and processing engine | DONE | `candidate-processing.test.ts`, `replay.test.ts` | none |
| TASK-15 | Guarded publisher with concurrency tests | DONE (SUBSTITUTE-PG) | `publication-integration.test.ts`, `concurrency.test.ts`, `ownership.test.ts` (run only with `INGESTION_PG_TOOLS_DIR`; skipped otherwise) | BLOCKED: real Supabase |
| TASK-16 | Map organizer-name fallback | DONE | `app/api/map/search/route.ts` (only map file changed by the ingestion commit); `map-integration.test.ts` | none |
| TASK-17 | Ownership-safe updates and cancellations | PARTIAL | `ownership.test.ts`; worker-only archive in live mode | No admin archive/cancel action exists; documented in the runbook |
| TASK-18 | Platform admin guard | DONE | `admin-auth.test.ts`, `admin-page-gate.test.ts` | none |
| TASK-19 | Candidate list/detail/review/publish APIs | DONE | `candidate-api.test.ts` | none |
| TASK-20 | Source trust and run APIs | DONE | `source-api.test.ts`, `runs-api.test.ts` (distinct approved candidates, CAS) | none |
| TASK-21 | Admin ingestion pages | DONE | `admin-ui.test.tsx` | no browser verification performed |
| TASK-22 | Daily worker orchestration | DONE | `daily-worker.test.ts`, `end-to-end.test.ts` | none |
| TASK-23 | Weekly bounded discovery worker | DONE | `discovery.test.ts` | BLOCKED: live-source behavior |
| TASK-24 | Scheduled GitHub workflows | PARTIAL | SHA-pinned actions, verify step, security tests; actionlint v1.7.12 passed locally on both workflows (exit 0) | BLOCKED: schedules start only after merge to the default branch; re-run actionlint in CI |
| TASK-25 | Replay, verification, retention | DONE | `replay.test.ts` (replay and verify), `retention.test.ts` | `ingest:verify` pages candidates and rechecks at most 1000 ingestion-owned events (`recheck_incomplete` warning only when more exist; overflow detection tested at PostgREST limits 100/500/1000); shares one run lock with collection and replay (`recheck_skipped` when held); partial collections raise `collection_partial`; own 15-minute deadline |
| TASK-26 | End-to-end local Supabase integration and security | BLOCKED | Substitute-PG harness only | Needs Docker/local Supabase or an isolated project |
| TASK-27 | Security review and operator runbook | PARTIAL | Security review and runbook corrected in this pass | Items marked UNVERIFIED/BLOCKED there |
| TASK-28 | Shadow launch checklist and activation gate | BLOCKED | Checklist and shadow-results template written | Three real shadow days and owner approval |
