# Known Limitations

This document tracks known issues, tech debt, and architectural gaps in the current codebase. Items are not blockers but should be addressed before the relevant feature area is expanded.

---

## Security

### 1. Middleware admin guard is incomplete
**File:** `middleware.ts`  
**Issue:** `/admin/*` routes only check that a session exists. An authenticated user who is not in `app_admins` can access admin pages at the middleware level. The actual `app_admins` check is performed inside each admin server component, but it's defense-in-depth only.  
**Fix:** Add a `supabase.from("app_admins").select(...)` check in the middleware admin block.

### 2. Deprecated auth helper in invite acceptance
**File:** `app/api/invites/accept/route.ts`  
**Issue:** Uses `createRouteHandlerClient` from `@supabase/auth-helpers-nextjs`, which is a deprecated package. The rest of the codebase uses `@supabase/ssr`.  
**Fix:** Rewrite using `createSupabaseServerRW` from `lib/supabase/server.ts`.

### 3. Host dashboard mutations rely entirely on Supabase RLS
**Files:** `app/host/[slug]/events/page.tsx` and related  
**Issue:** Event create/edit/delete operations are performed client-side via `createSupabaseBrowserClient()`. There is no server-side role check in an API route or server action. If RLS policies are misconfigured, any authenticated user could mutate org data.  
**Risk:** Medium — depends on RLS being correct.

---

## Code Quality

### 4. Dead file: `lib/mappers/eventToCard.ts`
**File:** `lib/mappers/eventToCard.ts`  
**Issue:** The entire file is commented out. It contains old mapping functions that were superseded. The file serves no purpose.  
**Fix:** Delete the file.

### 5. `ExploreCardData` type is defined in two places
**Issue:** `ExploreCardData` is exported from both `lib/types.ts` and `components/explore/EventCard.tsx`. This causes ambiguity. `ExploreView.test.tsx` imports from `lib/types`.  
**Fix:** Remove the duplicate from `EventCard.tsx`; import from `lib/types` everywhere.

### 6. `createSupabaseServer()` is called without `await` in `explore/page.tsx`
**File:** `app/(app)/explore/page.tsx`  
**Issue:** `createSupabaseServer()` is called synchronously (`const supabase = createSupabaseServer()`), but in `lib/supabase/server.ts` the function is not async and should work. However, the `createSupabaseServerRW` variant IS async. This inconsistency is a maintenance risk — if `createSupabaseServer` is ever made async, callers without `await` will silently break.

### 7. `AppHeader.tsx` is apparently unused
**File:** `components/layouts/AppHeader.tsx`  
**Issue:** Not referenced in the app layout or any visible route. Unknown if it's used anywhere.  
**Fix:** Verify with a workspace search; delete if unused.

---

## Architecture

### 8. `.env.example` covers only the ingestion workers
**Issue:** `floats/.env.example` exists, but it lists only the ingestion variables. The web app's `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `RESEND_API_KEY`, `CRON_SECRET` and `CHECKIN_DEBUG` are documented only in [env-vars.md](./env-vars.md).  
**Fix:** Add placeholder entries for the app variables, or split into separate example files.

### 9. Supabase project ID is hardcoded
**File:** `package.json` (`db:types` script)  
**Issue:** `--project-id inxlsvowzpqvfulhbnou` is hardcoded. If the project changes, this script breaks silently.  
**Fix:** Read from an env var or document the hardcoded ID prominently.

### 10. Image hostname is hardcoded in Next.js config
**File:** `next.config.ts`  
**Issue:** `hostname: "inxlsvowzpqvfulhbnou.supabase.co"` is hardcoded. If the Supabase project changes, `next/image` optimization will break.  
**Fix:** Derive from `NEXT_PUBLIC_SUPABASE_URL` at config time.

### 11. Timezone is hardcoded to America/New_York
**Files:** `lib/timezone.ts`, `app/api/cron/process-notifications/route.tsx`, various RPCs  
**Issue:** All datetime handling assumes Eastern Time. There is no per-user or per-event timezone. Events in other timezones will display/compute incorrectly.  
**Known limitation, not a bug** for the current use case, but blocks geographic expansion.

### 12. No local Supabase dev environment
**Issue:** There is no `supabase/config.toml` in `floats/supabase/` (the outer `supabase/` dir has one). Developers must connect to the production Supabase project for local development.  
**Risk:** Accidental data mutations in production during development.  
**Fix:** Set up a local Supabase instance with `supabase start` or a staging project.

---

## Testing

### 13. E2E tests not implemented
**Issue:** Playwright is listed as a devDependency but no test files exist.  
See [testing-plan.md](./testing-plan.md) for the plan.

### 14. API routes have zero test coverage
**Issue:** All of `app/api/*` is untested.  
See [testing-plan.md](./testing-plan.md).

### 15. Lint and test failures do not block CI merges
**Issue:** `continue-on-error: true` on lint and test jobs.  
See [ci-hardening-plan.md](./ci-hardening-plan.md).

---

## Minor

### 16. `vercel.json` cron schedule comment mismatch
**File:** `vercel.json`  
**Schedule:** `0 13 * * *` (13:00 UTC = 9:00 AM ET)  
**Issue:** No comment in the file explaining the timezone intent. If a developer reads the cron expression without context they may not know it's targeting 9 AM ET.

### 17. `CHECKIN_DEBUG` env var is undocumented
**File:** `app/api/check-in/route.ts`  
**Issue:** The `CHECKIN_DEBUG=true` flag enables verbose logging but was not documented before this audit.  
**Status:** Now documented in [env-vars.md](./env-vars.md).
