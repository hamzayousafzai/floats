# Automated event ingestion: isolated staging setup and shadow-run guide

**Status: NOT_DEPLOYED. No staging validation has been executed.** Nothing in this guide has been run against a real Supabase
project. The SQL, the access script and the procedures below were exercised only offline: against an embedded PostgreSQL with a PostGIS
shim (`tests/ingestion/db-harness`) and against fake clients (`tests/ingestion/staging-check.test.ts`). Those are not Supabase and prove
nothing about the real Data API (PostgREST), real grants, the real baseline schema, real PostGIS, or the real `public.events` triggers.
Every step below is an operator action, and every result must be attached to the launch checklist before the status changes.

Hard rules for the whole procedure:

1. Use a brand-new Supabase project created only for this purpose. Never reuse, link, dump data from, or point anything at production.
2. Never paste production keys, URLs or database passwords into any step. Keys are set per shell session and never committed.
3. Do not use the `db:*` scripts in `package.json`. They are hardcoded to the production project (`--project-id inxlsvowzpqvfulhbnou`, `--linked`).
4. Do not enable `INGESTION_PUBLISH_MODE=live` anywhere. The first runs are `shadow`.

## 1. Who does what

| Work | Who | Status |
| --- | --- | --- |
| Code, migrations, offline tests, SQL query files, guarded access script, docs | Copilot (offline) | Done, uncommitted |
| Run migrations and SQL checks on an embedded PostgreSQL with a PostGIS shim | Copilot (offline) | Done; not Supabase |
| Create the staging project, obtain keys, expose the schema, set secrets | Operator (dashboard, credentials) | Not started |
| Build the staging baseline schema | Operator | Not started; the repository cannot do this (section 3) |
| Apply migrations and run `staging-checks.sql` / `staging-write-checks.sql` | Operator | Not started |
| Run `npm run ingest:staging-check` (role access over the real Data API) | Operator | Not started |
| Real PostgreSQL and PostGIS behaviour (geometry, trigger set, extension schema) | Operator, via the SQL files above | Not started |
| Live-source tests (robots.txt, real HTML, rate limits, terms of service review) | Operator | Not started; `ingest:daily` in shadow mode fetches real sites |
| Three reviewed shadow days and the shadow-results document | Operator | Not started |

## 2. Prerequisites

- A new Supabase project (staging), with the project ref recorded. Name it so it cannot be mistaken for production.
- The staging project's URL, anon key and service-role key, kept in a password manager, never in the repository, never in `.env.local`.
- Access to the staging database as the `postgres` role (SQL editor, or `psql` with the staging connection string).
- Node 20+, `npm ci` done in `floats/`. `psql` is optional but recommended for ordered, fail-fast migration runs.
- An operator-built baseline schema (section 3).

Extensions the baseline needs: `postgis`, `pgcrypto`, `pg_trgm`, and (only if you keep the geocode trigger) `pg_net`. The migrations
require `postgis`; they detect the schema it was installed in (`public` or `extensions`) and write that schema into
`ingestion.publish_candidate`. The check query verifies this (check 29).

## 3. The baseline schema (operator-built; the repository cannot recreate it)

The ingestion migrations alter and reference tables that predate this repository's migrations. The repository has no complete baseline:
`data/schema.sql` is a stale v2.0, `..\supabase\schema.sql` is empty, and `supabase/migrations/functions.sql` and `patch_functions.sql` are
untracked production dumps. The minimal dependency set is listed in `baseSchema()` in `tests/ingestion/db-harness/harness.mjs`:

- `auth.users` (referenced by reviews and approvals) and the roles `anon`, `authenticated`, `service_role` (Supabase creates these).
- `public.events` with at least `id, title, description, starts_at, ends_at, address, latitude, longitude, geom, status, is_market,
  is_featured, org_id, vendor_id, market_id, series_id, image_url`, and the `event_url` column from `20260501000000_add_event_url.sql`.
- `public.categories (id, name, slug)`, `public.event_categories (event_id, category_id)`, `public.app_admins`.
- The geometry trigger that fills `public.events.geom` from `latitude`/`longitude` (the migration fails closed if it is absent).

Two ways to get a baseline; both are the operator's decision:

- **A. Schema-only dump of the live database (recommended for fidelity).** Dump structure only, with no data and no auth users, using a
  tool and credentials the operator controls, and restore it into the staging project. Do not restore row data: it carries user
  data. This exercises the real triggers and constraints, which is the point of staging. After restoring, do section 4 before anything else.
- **B. Hand-built minimal baseline from `baseSchema()`.** Isolates the ingestion schema but does not prove compatibility with the real
  `public.events` constraints and triggers. Acceptable only as a first step; the write checks may report REVIEW because the real events
  table may require more columns.

### Production-URL hazard (must be cleared before any event is written)

The production baseline function `public.on_event_address_change()` (visible in `supabase/migrations/functions.sql`) hardcodes
`https://inxlsvowzpqvfulhbnou.supabase.co/functions/v1/geocode-event-address` and calls it through `pg_net`. A staging database restored from
a dump keeps that function. Publishing or editing an event in staging could then send a request to the PRODUCTION geocode function.

Before any event write on staging, the operator must either drop the trigger that calls this function, or recreate the function so it points
at the staging project (or does nothing). Then re-run `automated-event-ingestion-staging-checks.sql`: check 40 must report `pass`, and
checks 42 and 43 list every `public.events` trigger so a human can confirm none reaches outside the staging project.
`automated-event-ingestion-staging-write-checks.sql` refuses to run while any function body still contains the production ref.

## 4. Migration order

Apply exactly in this order, each as its own run, stopping at the first error. Each file is applied once; do not re-run a file that
already succeeded unless the table says it is re-runnable.

| # | File | Purpose | Re-runnable |
| --- | --- | --- | --- |
| 0 | the baseline (section 3), then neutralise the production URL | schema the migrations depend on | n/a |
| 1 | `20260501000000_add_event_url.sql` | `public.events.event_url` plus the `active_events` view and RPCs that return event data (already in the production baseline; skip if the dump contains it, apply only if the baseline predates it) | depends on baseline objects |
| 2 | `20261120000100_automated_event_ingestion.sql` | `ingestion` schema, 8 tables, `event_ingestion_links`, RLS, grants, `publish_candidate` | not guaranteed |
| 3 | `20261120000200_ingestion_updates_and_review.sql` | ownership-safe imported-event updates (`update_imported_event`) and admin review functions | not guaranteed |
| 4 | `20261121000100_ingestion_event_deletion_policy.sql` | `ON DELETE SET NULL` rules and the event-removal audit trigger | not guaranteed |
| 5 | `20261122000100_ingestion_pipeline_run_lock.sql` | one running collection, verification or replay run at a time | yes |

With `psql`, using a connection string held in a session variable that points at the STAGING database only:

```powershell
$env:STAGING_DB_URL = "<staging connection string>"   # never commit, never echo
foreach ($f in "20260501000000_add_event_url","20261120000100_automated_event_ingestion","20261120000200_ingestion_updates_and_review","20261121000100_ingestion_event_deletion_policy","20261122000100_ingestion_pipeline_run_lock") {
  psql $env:STAGING_DB_URL -v ON_ERROR_STOP=1 --single-transaction -f "supabase/migrations/$f.sql"
  if ($LASTEXITCODE -ne 0) { throw "Migration $f failed" }
}
```

Or paste each file into the SQL editor in order. Do not apply `functions.sql` or `patch_functions.sql`.
Record the full output. Afterwards run `notify pgrst, 'reload schema';` so the Data API sees the new objects.

## 5. Data API exposure and grants

The workers use `supabase-js` with `.schema("ingestion")`, which requires the schema to be exposed through the Data API.

1. Dashboard, Project Settings, Data API: add `ingestion` to **Exposed schemas**. Leave `public` as it is. Do not add `ingestion` to the
   extra search path; the code qualifies every reference.
2. Do not raise **Max rows**. Pagination in `verify-worker.ts` is written for a limit of 100, 500 or 1000 rows per response and
   detects truncation; the default hosted limit is 1000.
3. Exposure alone grants nothing. The migrations grant table and function privileges only to `service_role`; `anon`, `authenticated` and
   `PUBLIC` hold none, and RLS is enabled on every ingestion table. Section 6 verifies this on the real project, and a missing grant surfaces as
   PostgREST `PGRST106` (schema not exposed) or `42501` (permission denied) rather than as silent success.

## 6. Verification, in this order

1. **Read-only checks.** Run `docs/operations/automated-event-ingestion-staging-checks.sql` in the SQL editor. Required: no `FAIL` rows. Every
   `REVIEW` row (listed `public.events` triggers, supabase URLs in function bodies) must be explained in the shadow-results document.
   A `relation ... does not exist` error means the migrations are not applied.
   It covers: baseline, ingestion objects, RLS, privileges, functions, definer `search_path`, PostGIS schema, foreign key rules, run-lock
   indexes, production-URL isolation, and the `authenticator` role's exposed schemas (check 50).
2. **Write checks (rolled back).** Run `docs/operations/automated-event-ingestion-staging-write-checks.sql`. It publishes a throwaway
   candidate, verifies provenance and ownership, deletes the event and verifies the audit, archives another, creates and deletes a manual
   event, probes `anon`, `authenticated` and `service_role` access, then rolls everything back. Required: no `FAIL` rows. A `REVIEW` row means the real
   `public.events` needs more columns for a hand-made event; read the detail and sign it off. If it raises "Refusing to run", run
   `rollback;` and fix the baseline (section 3).
3. **Access over the real Data API.** In a fresh shell, with staging values only:

   ```powershell
   $env:INGESTION_STAGING_CONFIRM = "staging-not-production"
   $env:INGESTION_STAGING_PROJECT_REF = "<staging project ref>"
   $env:NEXT_PUBLIC_SUPABASE_URL = "https://<staging project ref>.supabase.co"
   $env:NEXT_PUBLIC_SUPABASE_ANON_KEY = "<staging anon key>"
   $env:SUPABASE_SERVICE_ROLE_KEY = "<staging service-role key>"
   # optional: a signed-in staging user's access token, to test the authenticated role (expires after about an hour)
   $env:INGESTION_STAGING_AUTHENTICATED_JWT = "<staging user access token>"
   # optional: extra project refs that must never match
   $env:INGESTION_PRODUCTION_PROJECT_REFS = "<other refs>"
   npm run ingest:staging-check
   ```

   The script refuses to start unless the confirmation value is set, the ref matches the URL, and the URL contains no known production ref.
   It is read-only: `service_role` reads the ingestion tables; `anon` (and `authenticated` if a token is given) must be denied on every table and
   on `publish_candidate`. Exit 0 means every check passed. Attach the output.

4. **Same-shell guard for the workers.** The worker scripts (`ingest:daily`, `ingest:verify`, `ingest:replay`, `ingest:discover`, `ingest:retain`) read
   only `process.env` and have no production guard of their own; `ingest:seed` refuses a non-local URL unless `--allow-remote` is given. Run the
   workers only in the shell where step 3 succeeded, never in a shell that holds other credentials.

## 7. Deletion and ownership expectations (what the write checks assert)

- Imported events carry a row in `public.event_ingestion_links`; manually created events do not and are never touched by ingestion.
- Deleting an imported event succeeds (it is not blocked by foreign keys), removes its link, keeps the candidate (still `published`, event
  pointer cleared), keeps the original `published` audit row, and writes one `event_deleted` audit row with the former event id.
- A deleted event is never republished, automatically or manually. Archiving an event is not deletion: pointer kept, no deletion audit.
- `service_role` can delete an imported event (the foreign key actions run as the table owner).

## 8. Safe seeding and shadow procedure

Only after sections 4 to 7 are clean, in the verified shell, with `INGESTION_PUBLISH_MODE=shadow`:

1. `npm run ingest:seed -- --allow-remote` registers the starter sources (restricted sources are registered disabled). Review each source's
   access-review note; terms of service were not machine-verifiable and need human sign-off.
2. `npm run ingest:daily`, then `npm run ingest:verify`. In `shadow` mode nothing is published; candidates and decisions are recorded.
3. Inspect `ingestion.candidates`, `ingestion.observations` and the run rows in the staging database. A `skipped_overlap` result or a
   `recheck_skipped` finding means another pipeline run held the shared lock.
4. Repeat for three consecutive days and record each day in `automated-event-ingestion-shadow-results.md`: candidates found, blocked and why,
   duplicates, false positives, finding codes, and every REVIEW row explanation.
5. The GitHub workflows (`ingestion-daily.yml`, `ingestion-discovery.yml`) run on a schedule only from the repository default branch, and the target
   project is selected purely by the repository secrets. Do not set production secrets. If staging scheduling is wanted, set the secrets from the STAGING
   project only and start with a manual `workflow_dispatch` from the `ingestion-update` branch (both workflows are pinned to `INGESTION_PUBLISH_MODE: shadow`).

## 9. Recovery

- **A migration fails.** With `--single-transaction` nothing from that file is kept. Fix the cause and re-run that file only. If a file was
  applied in the SQL editor without a transaction and half applied, the safest recovery is to delete the staging project and rebuild it; staging
  holds no data worth keeping. Rollback SQL for each migration is documented in the runbook (Procedures section).
- **Stale `running` rows** (a worker was hard-killed; there is no signal handler): the next collection, verification or replay run closes
  rows older than 90 minutes as failed. To clear sooner, set `status = 'failed', finished_at = now()` on the stale rows of the staging database by hand.
- **Wrong target.** If any worker was pointed at the wrong project, stop, rotate the affected service-role key, and report; the guard in step 6.3
  exists to make this a non-event, but it cannot protect a shell that skipped it.
- **Abort the whole trial.** Remove the staging secrets from GitHub and the shell, and delete or pause the staging project.

## 10. Operator action list

1. Create an isolated staging project; record its ref; keep keys out of the repository.
2. Build the baseline (section 3) and neutralise or repoint `on_event_address_change`.
3. Apply migrations 1 to 5 in order (section 4); record output; `notify pgrst, 'reload schema'`.
4. Expose `ingestion` in the Data API settings; leave Max rows alone (section 5).
5. Run `staging-checks.sql`; no `FAIL`; explain every `REVIEW`.
6. Run `staging-write-checks.sql`; no `FAIL`.
7. Run `npm run ingest:staging-check`; exit 0.
8. Seed, then three reviewed shadow days (section 8); fill in the shadow-results document.
9. Only then update the launch checklist; production deployment, merging and live publishing remain out of scope.

## 11. Decision

- **GO** for a first isolated shadow run, conditional on items 1 to 7 above being completed by the operator with evidence attached.
- **NO-GO** for: running anything against production, merging to `main`, deploying the migrations to production, and `INGESTION_PUBLISH_MODE=live`.
  None of these can be justified until staging validation and three shadow days exist as executed evidence, which today they do not.
