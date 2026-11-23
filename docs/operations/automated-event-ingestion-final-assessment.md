# Automated Event Ingestion - Final Hardening Assessment

Deployment state: **NOT_DEPLOYED**. Nothing was deployed or published, and `.env.local` was never read or used. Branch `ingestion-update`, committed at `68d49e0` (earlier hardening: `aca5020`). The corrections of the Supabase-integration-readiness pass (shared run lock, pagination evidence, partial-collection freshness, staging artifacts, doc reconciliation) are uncommitted and staged only. Three things are separate and none of them is done:

| Layer | State |
|-------|-------|
| Vercel app deployment (the Next.js web app) | Not performed. The app build passes locally (`build:ci`); Vercel does not run ingestion workers. |
| Ingestion database deployment (four ingestion migrations on a Supabase project, on top of an operator-built baseline) | Not performed. Only a substitute embedded PostgreSQL harness was run. No staging validation has been executed. |
| Scheduled-worker activation (GitHub Actions schedules) | Not active. Schedules start only when the workflows reach the default branch; until then only `workflow_dispatch` works. |

## Decisions (separate)

| Decision | Verdict | Why |
|----------|---------|-----|
| Isolated shadow run (staging Supabase, shadow mode, no production credentials) | **GO, conditional** | Code and tests are ready. Preconditions are operator steps in `automated-event-ingestion-staging-setup.md`: isolated project, operator-built baseline with the production geocode URL neutralised, the four migrations applied, `ingestion` exposed to the Data API, `staging-checks.sql`, `staging-write-checks.sql` and `ingest:staging-check` all clean. Run with `INGESTION_PUBLISH_MODE=shadow`. |
| Merge to `main` (starts scheduled workflows) | **NO-GO** | Needs three reviewed shadow days, ToS and live selector verification, failure notifications, and a decision about the unrelated map UI commits (D6). Schedules start the moment the workflows reach the default branch. |
| Live automatic publishing | **NO-GO** | No geocoder, no real Supabase/PostGIS evidence, no shadow results, no admin archive action, no owner approval. |

## Executed evidence (this machine, Windows, Node)

| Check | Command | Result |
|-------|---------|--------|
| Type check | `npx tsc --noEmit` | 30 errors, all in pre-existing `__tests__` files (series-follow 13, cron 12, upload 4, logout 1). No new errors. |
| Lint | `npm run lint` | 30 errors, all in pre-existing `__tests__` files (`__mocks__/supabase.ts` 11, favorites 9, FavoriteButton 6, check-in 4). No new errors; no warnings in ingestion files. |
| Jest, SQL suites enabled | `$env:INGESTION_PG_TOOLS_DIR=...; npx jest --ci --runInBand` | 50 suites, 1003 tests, all passed |
| Jest, SQL env unset | `npx jest --ci --runInBand` | 48 passed, 2 suites skipped; 989 passed, 14 skipped. **PARTIAL**: the SQL-gated suites did not run. |
| Ingestion only | `npm run test:ingestion` | 32 suites, 744 tests passed (SQL env set) |
| SQL harness | `node tests/ingestion/db-harness/verify-sql.mjs` | 318 PASS, 0 FAIL, exit code 0 (both PostGIS-schema variants, `public` and `extensions`). **Substitute embedded PostgreSQL with a PostGIS shim; not real Supabase.** |
| Build | `npm run build:ci` | Compiled, 17/17 static pages, exit code 0 |
| actionlint | `actionlint .github/workflows/ingestion-daily.yml .github/workflows/ingestion-discovery.yml` | v1.7.12 (release zip checksum verified against the published checksums), exit code 0, no findings |
| Real Supabase, PostGIS, PostgREST | not run | BLOCKED: no Docker, no authorized project |

Note: running the SQL-enabled jest suites in parallel (without `--runInBand`) produced 8 failures in `concurrency` and `ownership`; each passes alone and serially. The embedded PostgreSQL instances contend. `npm run test:ingestion` already uses `--runInBand`; keep it that way.

## Operational corrections after review of `aca5020`

| Finding | Correction |
|---------|------------|
| Collection and verification shared one deadline and timeout | Separate budgets: collection deadline 25 min (step 30), verification deadline 15 min (step 20), job 60. Verify still runs after a collection failure or timeout (`if: !cancelled()`). Verify skips rechecks while a collection, replay or verification run holds the shared run lock, but still runs its read-only operational checks and reports `recheck_skipped` (see the second pass below) |
| `updateSourceMetrics` could move `last_attempt_at` / `last_success_at` backwards under overlapping runs | Timestamps only move forward in attempt time; the compare-and-swap now also covers both timestamps; counters stay exact. Regression tests cover out-of-order completion and concurrent mixed-order writes |
| Exit codes and the cap were unclear | `succeeded`, `partial`, `skipped_overlap` exit 0 with workflow annotations; `failed` exits 1. The 1000 cap warns only when more than 1000 exist; a missed deadline is an error |
| An unverified geocoder result suppressed operator-verified source coordinates | Precedence: verified geocode, then operator-verified source coordinates, then an unverified geocode (never verified). Trust, origin, address, precision and radius gates are unchanged |
| Docs said there was no `.env.example` | `.env.example` exists but covers only the ingestion workers; `env-vars.md`, `local-setup.md` and `known-limitations.md` corrected |

## Findings fixed in the earlier hardening pass

| Priority | Finding | Fix |
|----------|---------|-----|
| P0 | Docs, migrations and `.env.example` were gitignored (would never be committed) | `.gitignore` narrowed; files staged; secret scan clean |
| P0 | FK `candidates.published_event_id` blocked deletion of imported events | Migration `20261121000100`: `ON DELETE SET NULL`, `event_deleted` audit action, trigger; candidate stays `published` so it cannot be resurrected. Harness-tested |
| P0 | Playwright adapter is not SSRF-safe yet the daily workflow installed Chromium and the scripts could construct it | Not registered by any script, Chromium install removed, tests assert it, doc comment states the limitation |
| P1 | Workflow actions used mutable tags | Pinned to full SHAs verified against the GitHub API |
| P1 | Verify step could be skipped on collection failure, and schedules/DST undocumented | `ingest:verify` runs with `if: !cancelled()`; schedule and DST notes added |
| P1 | No geocoder is configured, so address-only candidates could never be verified | Fail-closed retained. New narrow path: JSON-LD `Place.geo` is trusted only with a street address, 4+ decimals, radius gate, and an operator-set `configuration.coordinateTrust = "verified"`. Tests use the real `processRawEvent` without an injected geocoder |
| P1 | `updateSourceMetrics` read-modify-write could lose increments | Compare-and-swap with retry; concurrent test added |
| P1 | `ingest:verify` over-reported `sourcesSucceeded` and silently truncated at 1000 events or at the deadline | Separate `sourcesSucceeded`; `recheck_incomplete` findings |
| P1 | Docs wrongly used `PUBLICATION_MODE`, said `ingestion` must not be exposed, claimed triggers were inspected, and claimed an admin archive action | Runbook, checklist, security review, migration 002 header (comment only) and shadow template corrected |
| P2 | Plan and instruction branch name mismatch | Notes added; branch not renamed |
| P2 | Manual publish copy did not say it works in shadow mode | Copy updated in the review form |

## D6: map UI scope
`components/map/MapCanvas.tsx` and `components/map/MapBottomSheet.tsx` differ from `main` because the base commits `cb6dc8b` ("Added map clustering for multi-events") and `1a5d794` ("Added fitallpins handler on map"), which belong to the `visual-update` branch, are ancestors of the ingestion commit. The ingestion commit itself changes only `app/api/map/search/route.ts` among map files. Nothing was reverted. Recommendation: land `visual-update` as its own PR first (or rebase the ingestion branch onto `main` without it), and require map tests (clustering, fit-all-pins, `map-integration.test.ts`) in that PR. Also in the ingestion commit but outside ingestion paths: `.github/copilot-instructions.md`, `app/admin/page.tsx`, `jest.config.mjs`, `package.json`, `package-lock.json`; review them in the PR.

## Unresolved external tasks (priority order)
1. Rotate the production credentials in `.env.local`.
2. Create an isolated Supabase staging project; build the baseline; apply `20260501000000_add_event_url.sql` and the four ingestion migrations in order; record output (guide: `automated-event-ingestion-staging-setup.md`).
3. Expose the `ingestion` schema to the Data API and verify `anon`/`authenticated` are denied for every table and function.
4. List `pg_trigger` for `public.events`; confirm no user-visible side effects (needed before any manual or automatic publish).
5. Confirm PostGIS resolves inside the SECURITY DEFINER functions on the real project.
6. Run seed, daily, discover, verify in shadow mode with staging secrets; three reviewed days (`automated-event-ingestion-shadow-results.md`).
7. Per-source ToS review and live selector verification (Wix/Squarespace).
8. Choose and configure a compliant geocoder, or mark reviewed sources `coordinateTrust: verified`.
9. Re-run actionlint in CI (it passed locally, v1.7.12).
10. Enable repository failure notifications; remember schedules run only from the default branch.
11. Decide on an admin archive/cancel action (none exists).
12. Split or approve the map UI commits (D6).
13. Owner approval before `INGESTION_PUBLISH_MODE=live`.

## Next-PR plan
- PR 1: `visual-update` map changes with map tests.
- PR 2: ingestion (code, four migrations, docs, workflows) after staging evidence exists.
- PR 3 (later): geocoder provider, admin archive action, and a contained renderer if Playwright is wanted.

## Second pass: Supabase integration readiness (offline; uncommitted)

| Topic | Change | Evidence |
|-------|--------|----------|
| Shared run lock | Migration `20261122000100`: one running collection, verification or replay run at a time (`uq_runs_one_running_pipeline`); discovery keeps its own per-type lock. Legacy overlapping rows are closed (newest kept) before the index is built. Code (`storage/runs.ts`) uses the same group for the stale sweep and active-run lookup. A hard-killed worker leaves a `running` row that blocks the pipeline until the 90-minute stale sweep (no SIGTERM handler; see the runbook) | jest storage, replay and security suites; SQL harness (upgrade path, cross-type refusal, discovery independence, release) |
| Verify under contention | If another run holds the lock, verify runs its read-only operational checks, adds `recheck_skipped`, rechecks nothing and writes no run row; a verification holder gives `skipped_overlap` | replay suite |
| Verify pagination and PostgREST `max_rows` | Candidates are paged with `.range()`, ownership applied per page, scan stops once more than 1000 owned events are seen; `.in()` lists are chunked at 100. Overflow detection is tested at server limits of 100, 500 and 1000 rows; manual or claimed events do not consume the budget | replay suite (in-memory database with `maxRows` truncation) |
| Partial-collection freshness | A `partial` collection counts as the freshness heartbeat (`getLastSuccessfulRun`) but raises a new `collection_partial` warning naming the succeeded and attempted source counts; `getLatestFinishedRun` added | storage and replay suites |
| Staging artifacts | `automated-event-ingestion-staging-checks.sql` (read-only), `automated-event-ingestion-staging-write-checks.sql` (rolled-back publication, deletion, ownership, role probes), guarded `npm run ingest:staging-check`, and `automated-event-ingestion-staging-setup.md` | harness runs both SQL files, proves they flag a production-ref function, anon grants, disabled RLS and a missing lock index, and that the write script leaves no rows and refuses to run on a production-calling baseline; `tests/ingestion/staging-check.test.ts` covers the guard and classification with fake clients |
| Doc reconciliation | Four migrations plus the `add_event_url` baseline step, commit references, runbook run-lock section, plan TASK-24 YAML replaced by pointers to the real workflows, matrix and security review updated | review |

Nothing in this pass was executed against a real Supabase project, real PostGIS or the real Data API.

## Change inventory
Second pass additions: `supabase/migrations/20261122000100_ingestion_pipeline_run_lock.sql`, `scripts/ingestion/staging-check.ts`, `tests/ingestion/staging-check.test.ts`, `docs/operations/automated-event-ingestion-staging-{checks.sql,write-checks.sql,setup.md}`; changed `lib/ingestion/storage/runs.ts`, `lib/ingestion/workers/{verify-worker,daily-collection,replay-worker,verify-report}.ts`, `scripts/ingestion/collect.ts`, `package.json`, the in-memory test database helper, storage, replay and security tests, SQL harness files, the daily workflow comment, and the docs listed above.

First-pass inventory. Tracked under `docs/operations/` and `docs/architecture/`: runbook, launch checklist, shadow-results template, requirements matrix, this assessment, security review. New migration: `supabase/migrations/20261121000100_ingestion_event_deletion_policy.sql`. New test: `tests/ingestion/source-coordinates.test.ts`. Changed source: `lib/ingestion/{types.ts,process-candidate.ts,adapters/jsonld.ts,adapters/playwright.ts,storage/sources.ts,storage/audit.ts,workers/replay-worker.ts,workers/verify-worker.ts,workers/verify-report.ts}`, `scripts/ingestion/{collect.ts,verify.ts}`, both workflows, `components/ingestion/candidate-review-form.tsx`, SQL harness files. That first pass is committed (`68d49e0`); the second-pass changes above are uncommitted.
