# Automated Event Ingestion - Final Hardening Assessment

Deployment state: **NOT_DEPLOYED**. Nothing was deployed, committed or published. `.env.local` was never read or used. Branch `ingestion-update` (the plan calls it `feature/automated-event-ingestion`; same work). Base HEAD `b8184df`.

## Decisions (separate)

| Decision | Verdict | Why |
|----------|---------|-----|
| Isolated shadow run (staging Supabase, shadow mode, no production credentials) | **GO, conditional** | Code and tests are ready. Preconditions are operator steps: isolated project, migrations applied, `ingestion` exposed to the Data API with grants verified, `public.events` triggers listed. Run with `INGESTION_PUBLISH_MODE=shadow`. |
| Merge to `main` (starts scheduled workflows) | **NO-GO** | Needs three reviewed shadow days, actionlint, ToS and live selector verification, failure notifications, and a decision about the unrelated map UI commits (D6). Schedules start the moment the workflows reach the default branch. |
| Live automatic publishing | **NO-GO** | No geocoder, no real Supabase/PostGIS evidence, no shadow results, no admin archive action, no owner approval. |

## Executed evidence (this machine, Windows, Node)

| Check | Command | Result |
|-------|---------|--------|
| Type check | `npx tsc --noEmit` | 30 errors, all in pre-existing `__tests__` files (series-follow 13, cron 12, upload 4, logout 1). No new errors. |
| Lint | `npm run lint` | 30 errors, all in pre-existing `__tests__` files (`__mocks__/supabase.ts` 11, favorites 9, FavoriteButton 6, check-in 4). No new errors; no warnings in ingestion files. |
| Jest, SQL suites enabled | `$env:INGESTION_PG_TOOLS_DIR=...; npx jest --ci --runInBand` | 49 suites, 933 tests, all passed |
| Jest, SQL env unset | `npx jest --ci --runInBand` | 47 passed, 2 suites skipped; 919 passed, 14 skipped. **PARTIAL**: the SQL-gated suites did not run. |
| Ingestion only | `npm run test:ingestion` equivalent (`jest tests/ingestion --runInBand`) | 31 suites, 674 tests passed (SQL env set) |
| SQL harness | `node tests/ingestion/db-harness/verify-sql.mjs` | 286/286 checks, exit code 0. **Substitute embedded PostgreSQL with a PostGIS shim; not real Supabase.** |
| Build | `npm run build:ci` | Compiled, 17/17 static pages, exit code 0 |
| actionlint | not run | BLOCKED: not installed |
| Real Supabase, PostGIS, PostgREST | not run | BLOCKED: no Docker, no authorized project |

Note: running the SQL-enabled jest suites in parallel (without `--runInBand`) produced 8 failures in `concurrency` and `ownership`; each passes alone and serially. The embedded PostgreSQL instances contend. `npm run test:ingestion` already uses `--runInBand`; keep it that way.

## Findings fixed in this pass

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
2. Create an isolated Supabase staging project; apply the three migrations in order; record output.
3. Expose the `ingestion` schema to the Data API and verify `anon`/`authenticated` are denied for every table and function.
4. List `pg_trigger` for `public.events`; confirm no user-visible side effects (needed before any manual or automatic publish).
5. Confirm PostGIS resolves inside the SECURITY DEFINER functions on the real project.
6. Run seed, daily, discover, verify in shadow mode with staging secrets; three reviewed days (`automated-event-ingestion-shadow-results.md`).
7. Per-source ToS review and live selector verification (Wix/Squarespace).
8. Choose and configure a compliant geocoder, or mark reviewed sources `coordinateTrust: verified`.
9. Install and run actionlint on both workflows.
10. Enable repository failure notifications; remember schedules run only from the default branch.
11. Decide on an admin archive/cancel action (none exists).
12. Split or approve the map UI commits (D6).
13. Owner approval before `INGESTION_PUBLISH_MODE=live`.

## Next-PR plan
- PR 1: `visual-update` map changes with map tests.
- PR 2: ingestion (code, three migrations, docs, workflows) after staging evidence exists.
- PR 3 (later): geocoder provider, admin archive action, and a contained renderer if Playwright is wanted.

## Change inventory
Tracked under `docs/operations/` and `docs/architecture/`: runbook, launch checklist, shadow-results template, requirements matrix, this assessment, security review. New migration: `supabase/migrations/20261121000100_ingestion_event_deletion_policy.sql`. New test: `tests/ingestion/source-coordinates.test.ts`. Changed source: `lib/ingestion/{types.ts,process-candidate.ts,adapters/jsonld.ts,adapters/playwright.ts,storage/sources.ts,storage/audit.ts,workers/replay-worker.ts,workers/verify-worker.ts}`, `scripts/ingestion/{collect.ts,verify.ts}`, both workflows, `components/ingestion/candidate-review-form.tsx`, SQL harness files. Nothing is committed; the index holds the staged inventory only.
