---
applyTo: "lib/ingestion/**,scripts/ingestion/**,app/admin/ingestion/**,app/api/admin/ingestion/**,components/ingestion/**,tests/ingestion/**,supabase/migrations/*ingestion*.sql,.github/workflows/ingestion-*.yml,app/api/map/search/route.ts"
---

# Floats — Automated Event Ingestion Agent Instructions

Applies to the automated-event-ingestion feature and the explicitly listed shared integration files. When carrying out this feature, read the ADR, architecture specification, and implementation plan even if an individual edited path does not match `applyTo` (for example, when editing `package.json`). Preserve the existing repository-wide coding standards in `.github/copilot-instructions.md`.

## Confirmed repository integration facts

- Repository: `hamzayousafzai/floats`; default branch: `main`. Implement on `feature/automated-event-ingestion` (the work actually lives on `ingestion-update`; same work, branch not renamed).
- `public.events` has nullable `org_id` but `public.orgs.owner_id` is required: never create fake organizer accounts.
- `public.events.status` uses `draft | published | archived`; the map query filters to `published` and requires geographic coordinates.
- `app/admin/events/new/submit/route.ts` calls `admin_create_events_with_series`; do not reuse the existing user-facing route for automated publication.
- `data/schema.sql` is a historical snapshot. Verify current constraints, SQL functions, and triggers before applying migrations.

## Mandatory agent workflow

1. Read this file, `docs/adr/ADR-001-automated-event-ingestion.md`, `docs/architecture/automated-event-ingestion-spec.md`, and `docs/plans/automated-event-ingestion-implementation-plan.md` in that order.
2. Inspect the actual source and SQL objects named by the next task; never infer RPC side effects from TypeScript declarations.
3. Work through `TASK-01` onward sequentially. A task is complete only after its acceptance commands pass. Document failed or blocked tasks; never assert successful tests without running them.
4. Keep modifications within the file paths explicitly assigned by the implementation plan. If a necessary existing-code change is not authorized, report the issue instead of broadening scope.
5. Do not execute production migrations, edit hosted secrets, enable `live` publication, merge to `main`, or modify production data without explicit authorization.
6. Use fixture-based external-source tests; do not make CI depend on live sites. Do not silence lint, type or test errors.

## Conventions

- New modules and files: kebab-case; types/interfaces: PascalCase; functions/variables: camelCase; constants: `UPPER_SNAKE_CASE`; SQL identifiers: snake_case.
- TypeScript only for new worker logic; named exports; strict typing; Zod at untrusted boundaries; never `any`/`@ts-ignore` to hide mistakes.
- Imports: Node/external first, then `@/` internal modules, then relative modules, then type-only imports.
- UI: existing server-component patterns, Tailwind/DaisyUI and Lucide. Ingestion admin UI reads through admin-authorized API routes, not direct browser queries to private tables.
- Timestamps: source local time is `America/New_York`; persist UTC `timestamptz`. Reject ambiguous nonexistent/DST event times without enough offset information. Do not infer missing end times.
- Distances: PostGIS `geography` `ST_DWithin`; 1 mile = 1,609.344 meters; do not substitute a bounding box as final validation.
- Source parsing is pure relative to production DB. An adapter returns observations; only the guarded publisher writes to `public.events`.
- Every ingestion-owned event has a provenance link and immutable audit history. Production writes are transactionally idempotent.
- Do not download/rehost third-party images without reuse rights. In V1 default `image_url` to null.

## New module boundaries

```text
lib/ingestion/
  adapters/            # JSON-LD, ICS, HTML, optional Playwright and source adapters
  discovery/           # bounded safe source discovery
  normalize/           # parsing, canonical identity, timezone processing
  validation/          # evidence rules, geocoding, radius, score
  deduplication/       # candidates and production-event comparisons
  publication/         # isolated transaction wrapper and ownership
  storage/             # server-only data access
  security/            # SSRF protection and admin authorization
  config.ts
  types.ts
scripts/ingestion/     # collect, discover, seed, replay, verify
app/api/admin/ingestion/
app/admin/ingestion/
components/ingestion/
tests/ingestion/
supabase/migrations/
.github/workflows/ingestion-daily.yml
.github/workflows/ingestion-discovery.yml
```

## Strict DO NOT TOUCH boundaries

Unless a numbered task explicitly permits a surgical integration change, **do not edit**:

- `app/(app)/`, `app/host/`, `app/api/events/`, existing `app/admin/events/` routes or forms.
- `components/explore/`, `components/map/`, `components/admin/EditEventForm.tsx`, `lib/contexts/`, authentication middleware, OTP workflows.
- Favorites, stars, follows, check-ins, badges, existing event notifications or host ownership permissions.
- Existing `public.events` columns, status enum, existing FKs, or the semantics of `admin_create_events_with_series`.
- Existing CI job behaviors to make checks pass, or unrelated dependencies.

**One permitted existing API modification:** `app/api/map/search/route.ts`, solely to provide an organizer display-name fallback from imported-event provenance without changing request parameters, response keys, filtering, or existing organization behavior. Any required companion SQL must have restricted grants.

Never create fake accounts/orgs; never auto-claim an event; never infer repeating future events from an unconfirmed schedule; never overwrite a user/host-managed event; never delete an event merely because its source disappears.

## Autonomous discovery and trusted publication policy

- Daily unattended collection; weekly source discovery from known accessible sources, feeds, links and sitemaps. No requirement for daily manual raw-data entry.
- Source lifecycle: `probation`, `trusted`, `disabled`. Discovery creates **probation** entries only; platform admin explicitly promotes trust after measured successful runs and manual confirmations.
- Initial regional defaults: 35.2271, -80.8431 (Charlotte center); radius 35 miles; rolling horizon 60 days; 3+ independent vendors; timezone `America/New_York`.
- Initial score targets: >=90 automatic; 70–89 review; below 70 reject or review recoverable gaps. Score **never overrides hard validation**.
- `shadow` is mandatory default: collect, normalize, validate, audit decisions, **never automatically publish**. `live` is an operator-approved environment change. Explicit manual publication by a verified platform admin is a separate guarded action.
- Hard gates for publication: verified date/start/end, factual description and venue/address, verified geocode within radius, credible 3+ vendor evidence or verified established organizer format, not cancelled, no unresolved possible duplicate, source eligible for requested publication mode.
- Source failure does not equal zero upcoming events. Failures must be visible and isolated.
- No blanket AI generation of event facts. If optional AI classification is added later, it can only interpret supplied text and cite its evidence.

## Security

- Reuse the existing server-side Supabase service-role pattern **only** in trusted backend code. Never put a secret in `NEXT_PUBLIC_*` except the already-public project URL.
- Protect all new admin endpoints with Supabase session verification **and** a server-side membership lookup in `public.app_admins`. Organization members alone are not ingestion admins.
- New database tables must have RLS, restricted grants, and no browser exposure. `SECURITY DEFINER` functions use `SET search_path = ''` and schema-qualified references; only service_role gets EXECUTE.
- Do not introduce arbitrary fetch-by-URL admin APIs. Worker URL fetches must defend against SSRF, all redirects, private/reserved IPs, DNS rebinding, huge responses, timeouts and recursion; respect access restrictions/robots rules and rate limits. Never bypass auth/CAPTCHAs.
- Use transactions and DB-enforced uniqueness plus canonical-identity advisory locks before final production insertion. Check pre-existing `public.events`, not merely imported candidates.
- Keep audit records, never log tokens, and prevent raw-source HTML from becoming trusted executable content.

## Required validation

Per-task tests are in the implementation plan. Before claiming completion, run:

```bash
npm ci
npm run lint
npx tsc --noEmit
npm test -- --ci --runInBand
npm run test:ingestion
npm run build:ci
```

Also validate local Supabase migrations, admin authorization and idempotent/concurrent publishing against an isolated database. Never connect test workers to production credentials. If Docker, local Supabase, geocoding, or source access is unavailable, record the blocker accurately and complete offline work; do not fabricate results.

## Definition of done

Daily raw collection, weekly bounded discovery, provenance, normalization, validation, deduplication, safe trusted-source publication, review UI, source run logs, missing-run detection, ownership protection, map visibility, passing CI and shadow-mode readiness. **Production live mode is a separate authorized rollout gate, not automatic agent completion.**
