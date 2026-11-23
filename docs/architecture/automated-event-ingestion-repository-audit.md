# Automated Event Ingestion — Repository and Schema Audit (TASK-01)

- **Date:** 2026-11-20
- **Branch audited:** `ingestion-update` (the plan names `feature/automated-event-ingestion`; the operator created `ingestion-update` and work continues there)
- **Live database access:** none. No Supabase credentials were used and Docker is not installed, so every SQL statement below is **unverified** unless stated otherwise. Sources are the checked-in dumps `supabase/migrations/functions.sql`, `supabase/migrations/20260501000000_add_event_url.sql`, `data/schema.sql` and `lib/database.types.ts`.

## 1. Baseline command results (before any ingestion change)

| Command | Result |
|---|---|
| `npm ci` | Succeeds (770 packages; `npm audit` reports 33 pre-existing vulnerabilities, not addressed here). |
| `npx tsc --noEmit` | **Fails with 30 pre-existing errors**, all in tests: `__tests__/api/series-follow.test.ts` (13), `__tests__/api/cron.test.ts` (12), `__tests__/api/upload.test.ts` (4), `__tests__/actions/logout.test.ts` (1). They are `jest.fn()` values typed `never`. |
| `npm run lint` | **Fails with 30 pre-existing errors** in `__tests__/__mocks__/supabase.ts` (11), `__tests__/actions/favorites.test.ts` (9), `__tests__/api/check-in.test.ts` (4), `__tests__/components/FavoriteButton.test.tsx` (6), plus 37 warnings. |
| `npx jest --ci --runInBand` | 18 suites, 259 tests, all pass. |

Consequence: the plan's "`npx tsc --noEmit && npm run lint`" gates cannot pass on the unmodified repository. Per-task verification therefore means **no new errors**: the 30 tsc errors and 30 lint errors above must be unchanged and none may appear in new files. The old tests were not edited (outside the feature boundary).

## 2. Repository conventions

- Next.js 15 App Router, React 19, TypeScript strict, `@/` alias to repository root, Jest 30 with `next/jest`.
- **Jest** (`jest.config.mjs`): default `testEnvironment` is `jest-environment-jsdom`; `testMatch` is `**/__tests__/**/*.test.{ts,tsx,js,jsx}`. The plan places tests in `tests/ingestion/`, which this configuration would not discover. A one-line `testMatch` addition for `tests/**/*.test.*` is required (made in TASK-03). Node-only tests use the `@jest-environment node` docblock, as `__tests__/api/upload.test.ts` does.
- Root `__mocks__/` is adjacent to `node_modules`, so Jest auto-mocks `@supabase/supabase-js` (`createClient` is `jest.fn()`), `@supabase/ssr` and `resend` in every test. Ingestion tests must inject clients rather than rely on `createClient`.
- `@supabase/supabase-js` is **not** a direct dependency in `package.json` (resolved transitively through `@supabase/ssr` / auth helpers). `lib/supabase/admin.ts` already imports it.
- `lib/supabase/admin.ts`: `createSupabaseAdmin()` builds a service-role client from `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; no `.schema()` option.
- `lib/supabase/server.ts`: `createSupabaseServer()` is synchronous, uses the anon key and cookies. It calls `cookies()` unawaited (unused `cookieStore`, a lint warning) and a per-call awaited `cookies()` inside `get`. Behaviour is relied on by existing routes; not changed.
- Scheduled work today: one Vercel cron (`vercel.json`: `/api/cron/process-notifications`, daily 13:00 UTC).
- `next.config.ts` sets `eslint.ignoreDuringBuilds: true`; the `build` job in `.github/workflows/ci.yml` runs only after the `lint_typecheck` and `test` jobs, both of which are `continue-on-error: true`. CI therefore does not enforce lint, types or tests. CI uses Node 20; the plan requires Node 22 for ingestion workflows (local Node is v22.14.0).

## 3. Git and repository-hygiene findings

- **Ignored paths:** `.gitignore` excludes `docs/`, `supabase/`, `.github/instructions/`, `AGENTS.md` and all `.env*`. New ingestion documents, the migration and `.env.example` are therefore **untracked and ignored by Git** unless `.gitignore` is amended or files are force-added. This was not changed (outside the authorised scope); the operator must decide.
- **Supabase CLI workdir:** the CLI configuration is `../supabase/config.toml` (outside this Git repository; `package.json` scripts use `--workdir ..\supabase`). `../supabase/schema.sql` is empty. This repository's `supabase/migrations/` contains `20260501000000_add_event_url.sql`, `functions.sql` (a 102 KB function dump, not a valid timestamped migration) and `patch_functions.sql`. There is **no baseline migration that creates `events`, `orgs` or `categories`**, so `npx supabase db reset --local` cannot reproduce the live schema from this directory.
- **Old scraping code:** `git log --all --oneline -S scrap` and `--grep scrap` return nothing; no `cheerio` code exists in history (only an unrelated `-S cheerio` match in commit `832e80f`). `playwright` has been a devDependency since commit `92b7365` but is not imported anywhere in application code. There is no prior scraper to reuse.
- **Secrets:** `.env.local` (ignored) points at the production Supabase project and holds a service-role key and other credentials. It was inspected incidentally during this audit and its values were **not** used. Ingestion tests and workers must never load it. Recommend rotating those credentials because they appeared in an agent tool transcript.

## 4. Events table (what is known)

From `lib/database.types.ts` (generated, current to the 2026-05 `event_url` migration):

- `events`: `id`, `title?`, `description?`, `starts_at` (required), `ends_at` (required), `address?`, `latitude?`, `longitude?`, `geom` (insertable, `unknown`), `event_url?`, `image_url?`, `is_featured` (NOT NULL), `is_market?`, `status` enum `event_status` = `draft | published | archived` (nullable), `org_id?`, `vendor_id?`, `market_id?`, `series_id?`, `area_id?`, timestamps.
- **Divergence from the spec:** `ends_at` is `NOT NULL` in the generated types, so an event with an unknown end can never be inserted; consistent with "no fabricated end times" (such candidates cannot publish). `is_featured` must be supplied or defaulted (the spec's `publish_candidate` supplies `false`).
- **Divergence from `data/schema.sql`:** the 2025-09 snapshot declares `geom` as a generated column and `status` as `text`; the live types show `geom` writable and `status` as an enum. The snapshot is stale. *Unverified:* actual constraints, defaults, CHECKs and RLS policies on `events`.
- `orgs.owner_id` is required (per ADR); `events.org_id` is nullable. Imported events therefore use `org_id = NULL`.
- `event_categories (event_id, category_id)` — the generated types show no uniqueness information. *Unverified:* whether a primary key or unique constraint exists. `ON CONFLICT DO NOTHING` without a conflict target is safe either way. `categories (id, name, slug)`: *unverified* that `slug` is unique; the publisher inserts one row per matching category id so duplicate slugs could yield duplicate associations.
- `active_events` view (re-created in the 2026-05 migration) selects from `events` where `status = 'published'`.

## 5. Triggers and functions touching events

Only function bodies are available; **trigger attachments are not in any checked-in dump** (*unverified*):

| Function | Behaviour | Relevance |
|---|---|---|
| `public.events_set_geom_from_latlon()` | Sets `NEW.geom` from latitude/longitude using **unqualified** `ST_SetSRID`/`ST_MakePoint`. | Presumed BEFORE INSERT/UPDATE trigger. PostGIS must be on the function's `search_path`. |
| `public.update_event_area()` | Sets `NEW.area_id` from `areas.geom` using unqualified `ST_Intersects`/`ST_SetSRID`/`ST_MakePoint`, cast `::geography`. | Imported events get a derived `area_id` (allowed by the ADR). |
| `public.on_event_address_change()` (SECURITY DEFINER) | When `address` is set and `latitude` is NULL (insert) it calls `net.http_post` to the Edge Function `geocode-event-address` on the **production** project URL. | Imported events always have coordinates, so this must not fire. **Hazard:** a local database restored from the dump would call production if a candidate lacked coordinates; the publisher's hard gates prevent that. |
| `public.set_updated_at()` | Standard `updated_at` trigger. | None. |
| `public.enqueue_notifications_for_series_followers(...)` | Currently an empty **stub**. | Only called from `admin_create_events_with_series` for series events. Imported events have `series_id = NULL`; archive notification effects remain to be confirmed before cancellations are enabled (TASK-17). |

PostGIS schema: existing functions use unqualified PostGIS names, which implies PostGIS is on the default `search_path` (typically `public` or `extensions` on Supabase). `pg_extension.extnamespace` could **not** be inspected. The migration therefore must not hard-code `public.ST_*`; TASK-04 resolves the schema at execution time (see migration notes).

## 6. `admin_create_events_with_series(p jsonb)`

Definition read from `supabase/migrations/functions.sql` (line 441) — *unverified against live*:

- `SECURITY DEFINER`, **no** `SET search_path`, **no** authorisation inside the function; it trusts `p->>'org_id'`.
- Inserts `public.series` when recurring or multiple dates; inserts `events` (`org_id`, `series_id`, title, description, times, address, `is_market`, `is_featured`, `status` default `draft`, primary image, `event_url`), `event_categories`, `event_media`; calls the notification stub for series.
- It cannot create unowned events (`org_id` is mandatory) and sets no coordinates; therefore it is **not** reusable for ingestion, as the ADR states.

Calling route `app/admin/events/new/submit/route.ts`: checks only that a user session exists, then calls the RPC with the **service-role** client. Any signed-in user can thus create events for any `org_id`. This is an existing weakness outside the feature scope; ingestion code must not copy the pattern. `app/admin/events/[id]/update/route.ts` follows the same "session only, then admin client" pattern.

## 7. Authorisation model

- `public.app_admins (user_id, created_at)` exists (types and `data/schema.sql`); RLS lets admins read it. Helper functions `is_admin()`, `is_app_admin(uuid)`, `is_global_admin(...)` all read `app_admins`. `is_platform_admin(uuid)` instead tests ownership of a fixed platform org in `org_members`; **it must not be used** for ingestion because org membership is not platform administration.
- `middleware.ts` protects `/admin/**` only by requiring a session; it contains an unfinished comment "add your admin role check". API routes under `/api/admin/**` would also be reached by the middleware matcher but must authorise themselves. New ingestion routes therefore verify the session and `app_admins` membership in the route (TASK-18).

## 8. Map API (`app/api/map/search/route.ts`)

- Query params `lat`, `lng`, `distance` (default 5), `when` (default `this-month`), `area_slugs`. Uses a bounding box (not PostGIS) with the anon-key server client, filters `status = 'published'`, times `[start, end)`, orders by `starts_at`.
- Selects `org:org_id (name, slug)`; response is `EventPin[]` with `vendorSlug`/`vendorName` from `org[0]` (empty string fallback), coordinates from `latitude/longitude` with `geom` WKT fallback; rows without coordinates are dropped. Errors are returned as `{ error }`.
- The only permitted change (TASK-16) is the organiser display-name fallback.

## 9. Geocoding

No in-repo geocoder or provider API key exists. The only existing mechanism is the **Supabase Edge Function `geocode-event-address`** invoked from the `on_event_address_change` trigger; its source is **not in this repository** (`../supabase/functions/` holds only `invite-member` and `_shared`), so its provider, terms, quota and caching are unknown. No new paid geocoder is authorised. Consequence for TASK-11: no usable provider can be confirmed; `geocodeAddress` returns `null` unless a provider is explicitly injected, candidates without verified coordinates go to review, and live publication of such candidates stays blocked.

## 10. Unresolved database checks (must be run against an isolated database before TASK-04 is applied)

1. `select e.extname, n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname in ('postgis','pgcrypto','pg_net','pg_trgm');`
2. `select tgname, tgenabled, pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'public.events'::regclass and not tgisinternal;`
3. `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid in ('public.events'::regclass,'public.event_categories'::regclass,'public.categories'::regclass);`
4. `select pg_get_functiondef('public.admin_create_events_with_series(jsonb)'::regprocedure);`
5. `select polname, cmd from pg_policies where tablename in ('events','event_categories','app_admins');` and column privileges on `public.events` for `service_role`.
6. `select * from pg_enum where enumtypid = 'public.event_status'::regtype;`
7. Whether the `ingestion` schema is exposed in the Supabase Data API (`config.toml` `[api] schemas`, or the hosted dashboard setting) and exposed to `service_role` only.
8. Whether the generated column vs writable `geom` assumption holds (`select is_generated from information_schema.columns where table_name='events' and column_name='geom';`).

## 11. Integration boundaries confirmed

- Only `app/api/map/search/route.ts` may be edited among existing app code (plus the minimal `jest.config.mjs` `testMatch` addition and `package.json`/lockfile for dependencies).
- No fake organisations/accounts, no reuse of the admin event routes or RPC, no edits to `public.events` structure.
- Test and worker code must not use `.env.local`.
