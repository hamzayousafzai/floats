# Floats Automated Event Ingestion — Copilot Agent Mode execution plan

- **Status:** Ready for implementation; production activation requires separate approval
- **Version:** 1.0 — 2026-11-20
- **Repository:** `hamzayousafzai/floats`
- **Feature branch:** `feature/automated-event-ingestion` as planned; the work was actually done on `ingestion-update` (the branch was not renamed). Treat the two names as the same work.
- **Authority:** `.github/copilot-instructions.md`, `docs/adr/ADR-001-automated-event-ingestion.md`, `docs/architecture/automated-event-ingestion-spec.md`

## Mandatory agent process

Execute `TASK-01` through `TASK-28` **in order**, without skipping dependencies. First inspect current files and current database objects; the old `data/schema.sql` is not definitive. Use the exact schemas, JSON contracts, types, constants and functions in the architecture spec. All new operations must have deterministic fixtures. On each task: edit only listed files, run the exact checks, correct failures, then mark complete. If the task needs unavailable credentials, geocoding, source access or production permission, record a blocker rather than inventing success. Never deploy production migrations or enable live auto-publication in the agent session.

**Verification environment:** Node 22, dependencies installed with `npm ci`, isolated local Supabase (`npx supabase start` with Docker), nonproduction test secrets, `actionlint` available for YAML checks. Existing Jest configuration must be inspected before creating tests. `npm run lint`, `npx tsc --noEmit`, and `npm run build:ci` remain authoritative baseline checks.

## Phase 1 — Audit and foundation

### TASK-01 — Reconcile repository and live-schema assumptions

**Targets (read):** `package.json`, `package-lock.json`, `lib/database.types.ts`, `lib/supabase/{admin,server}.ts`, `app/admin/events/new/submit/route.ts`, `app/admin/events/[id]/update/route.ts`, `app/api/map/search/route.ts`, `data/schema.sql`, `supabase/migrations/`, `.github/workflows/ci.yml`.

**Create:** `docs/architecture/automated-event-ingestion-repository-audit.md`.

**Action:** Document actual app/SQL conventions, `events` constraints, current `admin_create_events_with_series` definition, triggers on event insertion/update, PostGIS extension schema, event/category uniqueness, existing geocoding provider, required org ownership, admin authorization and old scraping code across reachable Git branches/history. If live DB unavailable, label each SQL assumption *unverified*, not confirmed. Do not change production code. Work on feature branch.

**Dependencies:** none.

**Verify:** `npm ci && npx tsc --noEmit`; `git status --short`; `git branch --show-current`; `git grep -n 'admin_create_events_with_series'`; `git grep -n 'playwright'`; `git log --all --oneline --grep='scrap'`; inspect completed audit document. **Pass:** audited integration boundaries and explicit unresolved DB checks; no unrelated changed files.

### TASK-02 — Add packages and runnable script entrypoints

**Modify:** `package.json`, `package-lock.json`.

**Create:** `scripts/ingestion/{collect,discover,replay,verify}.ts`.

**Action:** `npm install cheerio zod && npm install -D tsx`; retain current Playwright. Add `ingest:daily`, `ingest:discover`, `ingest:seed`, `ingest:replay`, `ingest:verify`, `test:ingestion` scripts *exactly* as defined in spec §2 (seed command will be created in TASK-06). Each initial CLI exports `main`, catches errors, sanitizes logs, sets nonzero exitCode, runs only when invoked directly; initial implementations must fail clearly if their worker dependency is not implemented rather than falsely succeeding.

**Dependencies:** TASK-01.

**Verify:** `npm ci && npm ls cheerio zod tsx playwright && npx tsc --noEmit && npm run lint`. **Pass:** scripts listed; lockfile consistent; no unrelated updates.

### TASK-03 — Runtime configuration and exact types

**Create:** `lib/ingestion/{config,types}.ts`, `lib/ingestion/adapters/types.ts`, `tests/ingestion/config.test.ts`.

**Modify:** `.env.example` only if it exists; otherwise create `.env.example` containing *names and safe example nonsecret defaults*.

**Action:** Implement `INGESTION_DEFAULTS`, `IngestionConfig`, `loadIngestionConfig`, Zod numeric bounds, enum validation and env mapping from spec §3; exact `RawEvent`, `NormalizedEvent`, `ValidationResult`, `CollectionResult`, `PublicationResult`, source and adapter types. Config loads at execution time, not module import. No credential values in errors.

**Dependencies:** TASK-02.

**Verify:** `npm test -- --runInBand tests/ingestion/config.test.ts && npx tsc --noEmit && npm run lint`. **Pass:** default, invalid env, secret redaction, threshold relationship and missing credential cases.

## Phase 2 — Database and persistence

### TASK-04 — Add additive private ingestion schema and publisher function

**Create:** `supabase/migrations/20261120000100_automated_event_ingestion.sql`.

**Action:** Use the *full* schema, FKs, constraints, indexes, RLS/grants, provenance and `publish_candidate` SQL from spec §4. Verify PostGIS function schema, enum and trigger compatibility before applying. Lock canonical identity, prevent reuse and concurrent duplicates, verify hard gates inside SQL, insert a draft event, provenance and categories, publish and audit atomically. Reject prohibited config values and non-service-role callers. Do not alter existing `events` columns or enum. If necessary, reconcile a verified environment-specific PostGIS schema qualification in this new migration only. Do not silently edit existing tables.

**Dependencies:** TASK-01 and TASK-03.

**Verify:** `npx supabase start && npx supabase db reset --local`, then query `information_schema.tables` for eight `ingestion` tables and `public.event_ingestion_links`, inspect `pg_proc` and `information_schema.role_table_grants`. **Pass:** local SQL migration, no unauthorized grants, old tables intact. If local migrations are incomplete, record blocker; no production database fallback.

### TASK-05 — Typed backend persistence

**Create:** `lib/ingestion/storage/{client,sources,runs,observations,candidates,discoveries}.ts`, `tests/ingestion/storage.test.ts`.

**Action:** `createIngestionClient()` is backend-only; use trusted service-role client `.schema('ingestion')` for private tables. Export `getEnabledSources`, `getSourceById`, `updateSourceMetrics`, `createRun`, `finishRun`, `saveObservation`, `getObservationByIdentity`, `upsertCandidate`, `getCandidateById`, `listCandidates`, `saveSourceDiscovery`. Verify Supabase Data API exposes the schema for service_role only, or stop and record configuration blocker. Observations unique `(source_id,source_url,content_hash)`; candidates unique `canonical_key`; never overwrite `manual_override`, `approved` or `published` on re-observation; add observation evidence links.

**Dependencies:** TASK-04.

**Verify:** `npm test -- --runInBand tests/ingestion/storage.test.ts && npx tsc --noEmit && npm run lint`. In local integration, save source/run/observation twice and assert one observation; candidate twice and assert one candidate and retained history. **Pass:** typed and idempotent persistence.

### TASK-06 — Seed known Charlotte organizers

**Create:** `scripts/ingestion/seed-sources.ts`, `tests/ingestion/source-seeding.test.ts`.

**Modify:** `package.json` only if `ingest:seed` was not inserted in TASK-02.

**Action:** Seed Maker's Market CLT, Urban District Market, Esther & Elsa from spec §5. Check current automated-access eligibility; mark restricted sources disabled with reason. Use canonical URL upserts; always `probation`, never automatically trusted, stable IDs across replay. Don't assume HTML parsing has succeeded yet.

**Dependencies:** TASK-05.

**Verify:** `npm test -- --runInBand tests/ingestion/source-seeding.test.ts && npx tsc --noEmit`; in **local** environment run `npm run ingest:seed` twice and assert no duplicated sources. **Pass:** repeatable seeds, appropriate permission status.

## Phase 3 — Safe scraping and normalization

### TASK-07 — Safe HTTP network access

**Create:** `lib/ingestion/security/{safe-fetch,url-validation}.ts`, `tests/ingestion/safe-fetch.test.ts`.

**Action:** Implement `safeFetch` from spec §5.1: HTTP(S) only, no embedded credentials, reject localhost/private/loopback/link-local/multicast/metadata IPv4 and IPv6, validate redirect destination each hop, DNS resolution and actual connection pinning/validation, streamed max bytes, content type, timeout and source delays; never bypass robots/auth/CAPTCHA. Dependency-inject resolver/transport in tests for repeatability. Reject unsafe URLs before making a request.

**Dependencies:** TASK-03.

**Verify:** `npm test -- --runInBand tests/ingestion/safe-fetch.test.ts && npx tsc --noEmit && npm run lint`. Include redirect to private IP, DNS rebinding, overly large body, timeout and good public HTTPS mock. **Pass:** all blocked destinations rejected.

### TASK-08 — Generic structured and rendered adapters

**Create:** `lib/ingestion/adapters/{jsonld,ics,html,playwright,registry}.ts`, `tests/ingestion/adapters.test.ts`, `tests/ingestion/fixtures/{jsonld-event.html,calendar.ics,market-listing.html}`.

**Action:** Implement `EventAdapter`, registry and JSON-LD `Event`, arrays and `@graph`; ICS `VEVENT` UID, timezone and explicit date instances; Cheerio cards/details with configurable selectors; Playwright only for permitted JS pages, bounded navigation and clean browser teardown. Preserve raw payload, source URL, cancellation and null missing values. No DB production calls. An unexpected page structure must produce parser error, not successful zero results.

**Dependencies:** TASK-07.

**Verify:** `npm test -- --runInBand tests/ingestion/adapters.test.ts && npx tsc --noEmit && npm run lint`. **Pass:** deterministic fixtures; no live network in CI; no fabricated end times.

### TASK-09 — Three high-priority source adapters

**Create:** `lib/ingestion/adapters/sources/{makers-market-clt,urban-district-market,esther-elsa}.ts`, `tests/ingestion/source-adapters.test.ts`, `tests/ingestion/fixtures/{makers-market,urban-district,esther-elsa}.html`.

**Modify:** `lib/ingestion/adapters/registry.ts`.

**Action:** Configure source-specific extraction based on current permitted listing structure. Prefer structured markup where available. Extract title, detail URL, organizer, venue, address, datetime, description, vendor proof, cancellation and stable external ID. Verify moved/changed venues rather than carrying forward old values. Record broken selectors as failures; preserve dates as distinct occurrences. Fixture content may be minimal synthetic representations of observed structural patterns and must be labelled as synthetic.

**Dependencies:** TASK-08.

**Verify:** `npm test -- --runInBand tests/ingestion/source-adapters.test.ts && npx tsc --noEmit`. **Pass:** each fixture works, structural mismatch fails, no production writes.

### TASK-10 — Data normalization and stable identity

**Create:** `lib/ingestion/normalize/{normalize-event,canonical-key,normalize-url,normalize-address}.ts`, `tests/ingestion/normalization.test.ts`.

**Action:** Export `normalizeEvent`, `generateCanonicalKey`, `normalizeSourceUrl`, `normalizeAddress`. Strip unsafe markup, Unicode normalize, trim/collapse whitespace, preserve factual content, drop URL trackers, parse local timezone explicitly, convert to UTC, reject ambiguous/nonexistent DST without explicit offsets, leave missing values null. Identity hash: SHA-256 normalized title|venue/address|local date as spec §6.1. Same event stable, different recurrence date distinct; fuzzy merger is separate.

**Dependencies:** TASK-08.

**Verify:** `npm test -- --runInBand tests/ingestion/normalization.test.ts && npx tsc --noEmit`. **Pass:** deterministic hashes, correct timezone and DST, no guessed fields, no mutation of input.

## Phase 4 — Eligibility and deduplication

### TASK-11 — Geocode and radius checks

**Create:** `lib/ingestion/validation/{geocode,within-radius}.ts`, `lib/ingestion/storage/geocode-cache.ts`, `tests/ingestion/geocoding.test.ts`.

**Action:** Audit/reuse existing compliant geocoder and cache address results; export `geocodeAddress`, `isWithinRadius`. Don't use an unauthorized public bulk geocoder or invent coordinates. If no usable provider, return null and route to review, blocking live publishing for unresolved locations. DB `ST_DWithin` remains authoritative; tests use mocked provider and bounded distance tolerance.

**Dependencies:** TASK-05, TASK-10.

**Verify:** `npm test -- --runInBand tests/ingestion/geocoding.test.ts && npx tsc --noEmit`. **Pass:** center inside, far location outside, missing address not publishable, invalid coords rejected, cache and provider failure tested.

### TASK-12 — Market classifier, hard gates and score

**Create:** `lib/ingestion/validation/{keywords,classify,score,validate-event}.ts`, `tests/ingestion/{classification,scoring,validation}.test.ts`.

**Action:** Deterministic context rules and evidence checks from spec §6.3; 3+ vendors or documented eligible market organizer format; positive/negative keywords in context; score exactly 25+30+20+15+10; scores never override hard gates. Separate definite reject from recoverable review. No AI network dependency. `classifyMarket`, `calculateCandidateScore`, `validateEvent` are exported.

**Dependencies:** TASK-10, TASK-11.

**Verify:** `npm test -- --runInBand tests/ingestion/classification.test.ts tests/ingestion/scoring.test.ts tests/ingestion/validation.test.ts && npx tsc --noEmit`. **Pass:** makers/farmers/vintage qualify when supported; yoga/trivia/concert-only/single-shop excluded; market+live-music not falsely rejected; missing end, cancelled, expired, distant and ambiguous tested.

### TASK-13 — Cross-source and production-event duplicate matcher

**Create:** `lib/ingestion/deduplication/{match-event,similarity,production-search}.ts`, `tests/ingestion/deduplication.test.ts`.

**Action:** Match source stable ID, URL, canonical key, organizer, venue/date, title similarity, geo proximity and all production `public.events`. Report evidence. >=0.95 confirmed, >=0.75 possible, below 0.75 not automatically matched; thresholds are heuristics, not calibrated probabilities. Weekly recurring market on a new date is a new event. An uncertain production match blocks auto-publication.

**Dependencies:** TASK-05, TASK-10, TASK-11.

**Verify:** `npm test -- --runInBand tests/ingestion/deduplication.test.ts && npx tsc --noEmit`. **Pass:** two sources/one event, repeat observation, similar titles/new dates, manual production event and ambiguous collisions handled.

### TASK-14 — Candidate state and processing engine

**Create:** `lib/ingestion/{candidate-state,process-candidate}.ts`, `tests/ingestion/candidate-processing.test.ts`.

**Action:** Parse raw → normalize → geocode → candidate/production match → validate/score → persist candidate plus `candidate_sources`. Enforce state transitions from spec §6.5. Never silently reset approved/published/rejected state on a new scrape; preserve manual overrides. Persist reason codes. Different observations may link to one candidate without duplicate production events.

**Dependencies:** TASK-12, TASK-13.

**Verify:** `npm test -- --runInBand tests/ingestion/candidate-processing.test.ts && npx tsc --noEmit`. **Pass:** ready/review/reject, conflict handling, replay, evidence links, manual overrides and invalid transitions.

## Phase 5 — Safe publication and map integration

### TASK-15 — Guarded publisher with concurrency tests

**Create:** `lib/ingestion/publication/{publish-candidate,record-shadow-decision}.ts`, `tests/ingestion/{publication,publication-integration,concurrency}.test.ts`.

**Modify:** new ingestion migration from TASK-04 **only** if isolated testing exposes a correctness defect.

**Action:** Implement spec §7 `publishCandidate`. Shadow mode records decision only. Live mode trusted+ready+score/hard gates; explicit admin manual path requires `approved` + hard gates. Invoke backend-restricted SQL transaction, never old authenticated event creation route. Verify canonical identity lock and final production duplicate recheck; repeated candidate returns the same ID. Ensure **different candidate IDs representing the same physical event** cannot concurrently publish, including similar-but-not-identical canonical keys (mark uncertain and block; extend database identity lock strategy if necessary). Transaction failure must roll back all insertion/links/audit.

**Dependencies:** TASK-04, TASK-14.

**Verify:** `npm test -- --runInBand tests/ingestion/publication.test.ts tests/ingestion/publication-integration.test.ts tests/ingestion/concurrency.test.ts && npx tsc --noEmit`. **Pass:** shadow zero production rows; trusted live, probation, disabled, incomplete, cancelled, out-of-radius, duplicate, replay, cross-candidate race and rollback all proven against isolated database. **Block all later production launch if race tests fail.**

### TASK-16 — Map organizer-name fallback

**Modify:** `app/api/map/search/route.ts`.

**Create:** `tests/ingestion/map-integration.test.ts`.

**Action:** Preserve the existing query params, response keys, geo/date filters, organization owner behavior. For IDs returned by map query, securely fetch `event_ingestion_links.organizer_display_name` from a server-side restricted client; return `vendorName = org.name ?? provenance.organizer_display_name ?? ''`, `vendorSlug = org.slug ?? ''`. Do not grant anon read of provenance. Missing coords remain hidden.

**Dependencies:** TASK-15.

**Verify:** `npm test -- --runInBand tests/ingestion/map-integration.test.ts && npx tsc --noEmit && npm run lint`. **Pass:** existing org pin unchanged, unclaimed name visible, empty fallback safe, draft hidden, existing JSON contract intact.

### TASK-17 — Ownership-safe updates and cancellations

**Create:** `lib/ingestion/publication/{ownership,update-imported-event}.ts`, `tests/ingestion/ownership.test.ts`.

**Action:** Check `management_state='ingestion'` under transactional lock before updating verified fields: title, description, dates, address, coordinates. Never update claimed/manual/host-owned events or org/vendor relationships. Archive only if explicit cancellation evidence verified; check effects of existing notification queues/triggers before enabling cancellation changes. Temporary listing failure never archives. Audit changes.

**Dependencies:** TASK-15.

**Verify:** `npm test -- --runInBand tests/ingestion/ownership.test.ts && npx tsc --noEmit`. **Pass:** safe update; manual/claimed/host blocks; disappearance not cancellation; audit present.

## Phase 6 — Admin authorization, APIs and interface

### TASK-18 — Platform admin guard

**Create:** `lib/ingestion/security/{require-admin,api-errors}.ts`, `tests/ingestion/admin-auth.test.ts`.

**Action:** `requireIngestionAdmin()` checks user session and `public.app_admins` using server client before elevated client calls; errors map 401/403/400/404/409/500 to JSON from spec §8. An organization owner is not automatically a platform admin.

**Dependencies:** TASK-05.

**Verify:** `npm test -- --runInBand tests/ingestion/admin-auth.test.ts && npx tsc --noEmit`. **Pass:** anonymous, user and org-owner rejected; actual admin accepted; lookup errors fail closed.

### TASK-19 — Candidate list, details, review and publish APIs

**Create:** `app/api/admin/ingestion/candidates/route.ts`, `app/api/admin/ingestion/candidates/[id]/route.ts`, `app/api/admin/ingestion/candidates/[id]/publish/route.ts`, `lib/ingestion/review/review-candidate.ts`, `tests/ingestion/candidate-api.test.ts`.

**Action:** Implement exact REST query/body/response contracts in spec §8. Cursor `(updated_at,id)` descending, max100; validate UUID and patch keys; review uses candidate transaction/lock, authenticated admin ID, evidence, revalidation and duplicate match. Approval is **not publication**. POST publish is separate, `manual:true` only, requires approved candidate and hard gates. Sanitize errors.

**Dependencies:** TASK-14, TASK-15, TASK-18.

**Verify:** `npm test -- --runInBand tests/ingestion/candidate-api.test.ts && npx tsc --noEmit && npm run lint`. **Pass:** invalid auth/UUID/field/transition rejected, audit writes, approval does not auto-publish, separate publish obeys hard gates.

### TASK-20 — Source trust and run APIs

**Create:** `app/api/admin/ingestion/sources/route.ts`, `app/api/admin/ingestion/sources/[id]/route.ts`, `app/api/admin/ingestion/runs/route.ts`, `tests/ingestion/{source-api,runs-api}.test.ts`.

**Action:** Implement exact `GET/PATCH` source and `GET` runs contracts in spec §8. Promote trust only by platform admin after at least 3 **source-specific** successful runs and 5 **distinct reviewed eligible** candidates, deriving evidence from reviews (no untrusted client count); never auto-promote. Sanitized run errors, no secrets/raw HTML returned.

**Dependencies:** TASK-18, TASK-19.

**Verify:** `npm test -- --runInBand tests/ingestion/source-api.test.ts tests/ingestion/runs-api.test.ts && npx tsc --noEmit`. **Pass:** admin guard, insufficient-trust block, eligible promotion, disabled source state, secret sanitation.

### TASK-21 — Admin ingestion pages

**Create:** `app/admin/ingestion/page.tsx`, `app/admin/ingestion/candidates/page.tsx`, `app/admin/ingestion/candidates/[id]/page.tsx`, `app/admin/ingestion/sources/page.tsx`, `app/admin/ingestion/runs/page.tsx`, `components/ingestion/{ingestion-summary,candidate-table,candidate-review-form,source-table,run-table}.tsx`, `tests/ingestion/admin-ui.test.tsx`.

**Action:** Auth-gated UI showing last run, counts, source health, candidates, evidence, reason codes, edit/review/approve/reject, explicit publish, source trust controls and sanitized run logs. Use existing Tailwind/DaisyUI/Lucide patterns, with loading, empty, confirmation and error states. No direct browser ingestion-schema query; route through approved admin REST APIs.

**Dependencies:** TASK-19, TASK-20.

**Verify:** `npm test -- --runInBand tests/ingestion/admin-ui.test.tsx && npx tsc --noEmit && npm run lint && npm run build:ci`. **Pass:** role gate, UI state tests, separate approve/publish, safe evidence link and no browser secrets.

## Phase 7 — Unattended execution and discovery

### TASK-22 — Daily worker orchestration

**Create:** `lib/ingestion/workers/{daily-collection,source-runner}.ts`, `tests/ingestion/daily-worker.test.ts`.

**Modify:** `scripts/ingestion/collect.ts`.

**Action:** Config → run/lock → enabled collection sources → concurrency-limited safe adapters → observation inserts → candidate processor → gated publication/shadow audit → per-source metrics → run summary and sanitized exit. A failed source does not fail others; bounded retries for transient issues only; distinguish no events from parser failure; ensure partial/fatal runs are finalized. Prevent overlapping runs.

**Dependencies:** TASK-14, TASK-15, TASK-17.

**Verify:** `npm test -- --runInBand tests/ingestion/daily-worker.test.ts && npx tsc --noEmit && npm run lint`; against isolated env: `INGESTION_PUBLISH_MODE=shadow npm run ingest:daily`. **Pass:** persisted observations/candidates, zero auto-production writes in shadow, repeat stable, errors isolated.

### TASK-23 — Weekly bounded discovery worker

**Create:** `lib/ingestion/discovery/{discover-sources,extract-links,detect-adapter,canonicalize-domain}.ts`, `tests/ingestion/discovery.test.ts`.

**Modify:** `scripts/ingestion/discover.ts`.

**Action:** Traverse permitted existing source links, sitemaps, calendar feeds and organizer/venue links with depth<=2 and <=25 discovery pages per source; safeFetch all URLs; deduplicate domains; test generic adapter detection, store `compatible/unsupported/restricted`; compatible sources registered `probation`, never trusted. No paid search, unrestricted crawl, CAPTCHA/auth bypass or production event insertion.

**Dependencies:** TASK-07, TASK-08, TASK-20.

**Verify:** `npm test -- --runInBand tests/ingestion/discovery.test.ts && npx tsc --noEmit`. **Pass:** compatible register, duplicate ignored, unsafe/restricted marked, traversal bounded, probation only.

### TASK-24 — Scheduled GitHub workflows

**Create:** `.github/workflows/ingestion-daily.yml`, `.github/workflows/ingestion-discovery.yml`.

**Action:** Use the workflow files in the repository (the YAML originally pasted in this plan is superseded; see below). Keep literal `shadow` in both; live activation requires a separate reviewed change. GitHub secrets `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` must be configured separately. No jobs on untrusted PRs.

Daily file: see `.github/workflows/ingestion-daily.yml`, which is the source of truth. The YAML originally pasted here was superseded by the review hardening and is intentionally not repeated: actions are pinned to full SHAs, Chromium is not installed, the job has a 60-minute budget with a 30-minute `Collect` step and a 20-minute `Verify` step (`if: ${{ !cancelled() }}`), and the concurrency group is `floats-ingestion-daily`.

Discovery file: see `.github/workflows/ingestion-discovery.yml` (source of truth; actions pinned to full SHAs, shadow mode, concurrency group `floats-ingestion-discovery`, 30-minute timeout). Discovery keeps its own per-type run lock and is outside the shared pipeline lock.

**Dependencies:** TASK-22, TASK-23.

**Verify:** `actionlint .github/workflows/ingestion-daily.yml .github/workflows/ingestion-discovery.yml && npx tsc --noEmit && npm run lint`. **Pass:** valid YAML/expressions, read-only repo scope, shadow mode, concurrency and timeouts. Note scheduled UTC hour shifts relative to Eastern daylight saving.

## Phase 8 — Replay, end-to-end security and rollout

### TASK-25 — Replay, verification and retention

**Create:** `lib/ingestion/workers/{replay-worker,verify-worker}.ts`, `lib/ingestion/storage/retention.ts`, `tests/ingestion/{replay,retention}.test.ts`.

**Modify:** `scripts/ingestion/{replay,verify}.ts`.

**Action:** Replay stored observations through same normalization/validation without duplicating candidate/production; preserve manual overrides. Verification rechecks upcoming ingestion-owned events and explicit cancellations; detects source failures/missed daily runs. Retain raw 90 days unless active review references evidence, runs 365 days, audit/provenance indefinitely; never delete production events or treat source disappearance as cancellation.

**Dependencies:** TASK-22, TASK-23.

**Verify:** `npm test -- --runInBand tests/ingestion/replay.test.ts tests/ingestion/retention.test.ts && npx tsc --noEmit`. **Pass:** replay idempotent, active evidence retained, cancellation guarded, cleanup safe.

### TASK-26 — End-to-end local Supabase integration and security

**Create:** `tests/ingestion/{end-to-end,security,concurrency}.test.ts`, `tests/ingestion/fixtures/end-to-end-events.json`.

**Modify:** only new ingestion files whose tested behavior is defective.

**Action:** In isolated Supabase: seed sources → save observations → normalize/geocode from mocks → validate/dedupe → shadow decision (zero production rows) → promote test source with legitimate reviewed evidence → test live publishing only with test environment → inspect `events`, links, categories and map fallback → replay → check idempotency; test simultaneous same-candidate and different-candidate same-physical-event publishing, rollback, malformed/admin requests, SSRF, ownership. No production secrets in tests.

**Dependencies:** TASK-21, TASK-24, TASK-25.

**Verify:** `npm test -- --runInBand tests/ingestion/end-to-end.test.ts tests/ingestion/security.test.ts tests/ingestion/concurrency.test.ts`; then `npm run lint && npx tsc --noEmit && npm test -- --ci --runInBand && npm run build:ci`. **Pass:** zero failing tests, no duplicate production events in race/replay, no unsafe admin access, shadow zero writes, stable map JSON.

### TASK-27 — Security review and operator runbook

**Create:** `docs/architecture/automated-event-ingestion-security-review.md`, `docs/operations/automated-event-ingestion-runbook.md`.

**Action:** Audit GitHub secret exposure, Supabase grants/RLS/API schema exposure, `SECURITY DEFINER` behavior, admin role checks, SSRF/DNS pinning, redirects, robots/access restrictions, raw HTML/rendering, logs, upload rights, production duplicate race and claimed-event protection. Runbook: manual rerun, disable source, inspect run logs, replay, review, promote trust, cancel/archive, disable schedules/live mode, rotate credentials, rollback migrations without deleting public events, restore from partial failures. No real secrets in docs.

**Dependencies:** TASK-26.

**Verify:** `npm run lint && npx tsc --noEmit && npm test -- --ci --runInBand && npm run build:ci`. **Pass:** completed risk inventory and procedures; zero known critical publication/security failures.

### TASK-28 — Shadow launch checklist and explicit activation gate

**Create:** `docs/operations/automated-event-ingestion-launch-checklist.md`, `docs/operations/automated-event-ingestion-shadow-results.md`.

**Modify externally only after approval:** GitHub Actions secrets, Supabase production migration state, workflow enablement.

**Action:** Checklist includes CI green, schema/RLS reviewed, geocoder verified, source permission verified, seeds in probation, credentials scoped, daily + discovery schedules enabled, shadow confirmed. Record **three distinct dates** of complete shadow collection with observations, distinct candidates, rejects, review, duplicate evidence, parser failures, source success and manually checked ground-truth sample. Define acceptable false positives from actual review, not a guess. Promote trusted sources only by admin and eligibility. Leave live mode disabled; require explicit human change approval before moving `INGESTION_PUBLISH_MODE` to live.

**Dependencies:** TASK-27.

**Verify:** `npm run lint && npx tsc --noEmit && npm test -- --ci --runInBand && npm run build:ci && npm run ingest:verify` with authorized shadow credentials. **Pass:** three real run records on separate days documented, zero automatic public event creations, failure alerting and review queue working. If runs have not occurred, mark this task **blocked/pending operational evidence**, not complete.

## Milestone gates

| Gate | After task | Invariant |
|---|---|---|
| A | 06 | Private RLS schema, migration locally tested, no existing event schema changes |
| B | 14 | Raw evidence, parser failures, eligibility, no production writes, candidate dedupe |
| C | 17 | Atomic publisher, canonical identity locking, cross-candidate race and ownership protections |
| D | 21 | Admin-only APIs, auditable review, map compatibility, no browser service-role use |
| E | 26 | Full isolated pipeline, security checks, all tests/build pass |
| F | 28 | Three measured shadow collection days, human approval required for live |

## Global final verification

From repository root, in approved **nonproduction** environment:

```bash
npm ci
npm run lint
npx tsc --noEmit
npm test -- --ci --runInBand
npm run test:ingestion
npm run build:ci
npx supabase start
npx supabase db reset --local
actionlint .github/workflows/ingestion-daily.yml .github/workflows/ingestion-discovery.yml
INGESTION_PUBLISH_MODE=shadow npm run ingest:daily
npm run ingest:verify
```

**Do not run local tests with production Supabase credentials.** Never modify CI to turn failures into success. Existing `.github/workflows/ci.yml` has `continue-on-error` for some jobs; this feature must still meet the stricter commands above instead of relying on a green CI badge.

## Infrastructure rollout and rollback

After explicit authorization: deploy additive reviewed migration → regenerate and deploy types/backend/UI → configure GitHub secrets → seed allowed sources → run shadow daily/discovery → verify three separate days and review evidence → manually promote proven sources → separately approve reviewed live-mode configuration. No fake ownership or bulk automatic backfill of unconfirmed recurrences.

Rollback: disable Actions schedules, set shadow mode, stop publisher, preserve published events, provenance and audit, inspect any questionable events manually. Do not drop ingestion tables or cascade-delete starred/followed production events.

## Explicit V1 non-goals

No account-authenticated social scraping, CAPTCHA bypass, paid proxies, paid search provider, fabricated organizer ownership, host claims workflow, speculative recurrence expansion, unlicensed media import, AI-generated event text/images, vendor roster automation, multi-city expansion, or alteration of existing badges/check-in/notification logic.

## Mandatory Copilot completion report

Report: tasks completed/blocked, files created/modified, actual migration/SQL test status, precise commands run and pass/fail results, source adapter success/failure, admin authorization, idempotence and different-candidate concurrency proof, map visibility, security findings, missing external configuration, and deployment state `NOT_DEPLOYED | SHADOW_DEPLOYED | LIVE_DEPLOYED`. Do not claim `LIVE_DEPLOYED` because code compiled. Production live activation requires explicit separate permission.
