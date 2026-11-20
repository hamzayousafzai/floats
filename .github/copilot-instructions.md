# Floats App — AI Coding Instructions

These repository-wide rules apply to every GitHub Copilot task. Feature-specific requirements belong in `.github/instructions/*.instructions.md` and their referenced design documents. Do not apply ingestion-only restrictions to unrelated features.

## Project Overview
- **Framework:** Next.js 15 (App Router), React 19.
- **Language:** TypeScript (strict mode).
- **Database:** Supabase (PostgreSQL with PostGIS).
- **Styling:** Tailwind CSS + DaisyUI.
- **Maps:** MapLibre GL JS.
- **Icons:** Lucide React.
- **Deployment:** Vercel; GitHub Actions for CI.

## Architecture & Structure
- `app/(app)`: Main user-facing application (Explore, Map, Profile).
- `app/admin`: Internal admin panel.
- `app/host`: Vendor/Host dashboard.
- `app/api`: Backend API endpoints (Cron, Search, Uploads).
- `components/`: UI components by feature (for example, `explore`, `map`, `profile`).
- `lib/`: Shared utilities; use the existing `@/` import alias.
- `lib/supabase/`: Existing server/browser/admin Supabase clients.
- `lib/database.types.ts`: Generated Supabase database types; do not manually edit.
- `lib/types.ts`: Shared UI types such as `ExploreCardData`.

## Data Fetching, Authentication & Supabase
- Prefer Server Components for server-side reads. Reuse `createSupabaseServer` and inspect its actual behavior before using it; account for Next.js cookie/session semantics.
- Prefer `.rpc()` for existing, verified database functions supporting complex atomic operations.
- Use `revalidate = 0` or `dynamic = "force-dynamic"` where up-to-date operational pages require it.
- Use the existing `createSupabaseBrowserClient` only for authorized client-side work.
- Preserve existing middleware and session refresh behavior.
- Authenticate and authorize administrative requests server-side. A signed-in user is not automatically a platform admin.
- Keep service-role keys in trusted server-side code only; never expose them to browsers.
- Use `Database` from `@/lib/database.types` for database row types.
- Before editing existing RPC usage, inspect its SQL body, grants, and trigger effects rather than inferring behavior from generated types.

## Styling & UI
- Use existing Tailwind CSS and DaisyUI components and conventions.
- Use `lucide-react` for icons.
- Design responsive/mobile-first interfaces.
- Use `next/image` for images where compatible with existing project configuration, preserving fallbacks and allowed remote-host rules.
- Existing map UI logic is centralized in `components/map/MapCanvas.tsx`.

## Dates, Inputs & Reliability
- Treat `America/New_York` as the user-facing event timezone. Store timestamp instants in UTC (`timestamptz`).
- Use `date-fns`, `date-fns-tz`, or native `Date` where appropriate, but never rely on the server's implicit timezone to parse ambiguous input.
- Validate untrusted inputs at API boundaries; use typed contracts and explicit error responses.
- Prefer small, testable TypeScript modules. Do not conceal errors with `any`, `@ts-ignore`, or silently swallowed exceptions.
- When working with external systems, impose timeouts and bounded retries.
- Preserve user-created and organization-owned data; destructive changes require explicit authorization.

## Developer Workflows
- Install from lockfile: `npm ci`.
- Database types: use the repository's configured `npm run db:types` when pointed at the correct development database. Never manually edit the generated file or run type generation against production without authorization.
- Environment variables for local development belong in `.env.local`; never commit actual credentials.
- Lint: `npm run lint`.
- Typecheck: `npx tsc --noEmit`.
- Test: `npm test -- --ci --runInBand`.
- Build: `npm run build:ci`.
- Validate all relevant checks after changes, and report failures accurately.

## Feature-specific instructions: Automated Event Ingestion
If a task concerns automated market event scraping, source discovery, ingestion, validation, deduplication, review, publishing, or the shared database/map integration for that feature, read all of:

1. `.github/instructions/automated-event-ingestion.instructions.md`
2. `docs/adr/ADR-001-automated-event-ingestion.md`
3. `docs/architecture/automated-event-ingestion-spec.md`
4. `docs/plans/automated-event-ingestion-implementation-plan.md`

Implement numbered tasks sequentially with the plan's verification commands. Keep shadow mode enabled by default. Do not deploy production migrations, change hosted secrets, grant broad privileges, or enable live publishing without explicit authorization. The scoped file's "Do Not Touch" boundaries apply only to this feature.
