# System Overview

## What the App Does

Floats is a local event discovery platform. Users browse and filter upcoming vendor events (pop-ups, markets) on an Explore feed and a MapLibre map. Authenticated users can save favorites, receive email reminders, check in at events, and earn badges. Vendors manage events through a Host dashboard. A global admin panel exists for platform-wide management.

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | ^15.5.9 |
| Language | TypeScript | ^5 |
| Database + Auth | Supabase (PostgreSQL + PostGIS) | — |
| ORM / Query | `@supabase/ssr` + raw PostGIS RPCs | ^0.7.0 |
| Map | MapLibre GL JS | ^5.7.1 |
| Styling | Tailwind CSS + DaisyUI | ^4 / ^5 |
| Icons | Lucide React | ^0.542.0 |
| Email | Resend + react-email | ^6.4.2 / ^2.0.0 |
| Date handling | date-fns + date-fns-tz | ^4.1.0 / ^3.2.0 |
| Deployment | Vercel | — |
| CI | GitHub Actions | — |
| Testing | Jest + Testing Library | ^30 / ^16 |
| E2E (installed, unused) | Playwright | ^1.55.0 |

## Application Sections

```
Consumer UI  (/explore, /map, /profile, /vendor/[slug], /login)
Host UI      (/host/[slug]/*)
Admin UI     (/admin/*)
API          (/api/*)
Cron         (/api/cron/process-notifications)
```

## Architecture Diagram (simplified)

```
Browser
  │
  ├── Server Components (RSC)
  │     └── createSupabaseServer() → Supabase DB (anon key, RLS enforced)
  │
  ├── Client Components
  │     └── createSupabaseBrowserClient() → Supabase Auth + realtime
  │
  ├── Server Actions (app/actions/)
  │     └── createServerClient() with anon key, read-only cookie access
  │
  └── API Route Handlers (app/api/)
        ├── public / user-authed: createSupabaseServer() (anon key)
        └── privileged (cron, invite accept, upload): createSupabaseAdmin() (service role key)

Next.js Middleware
  └── Refreshes Supabase session on every request
  └── Redirects unauthenticated users away from /admin
```

## Data Flow: Explore Page

1. `app/(app)/explore/page.tsx` runs on the server.
2. Calls `supabase.rpc("explore_events", { ... })` with URL search params as filters.
3. Calls `supabase.rpc("get_featured_events", { ... })` for the featured carousel.
4. Fetches `areas` and `categories` tables for filter UI.
5. Passes all data as props to `<ExploreView />` (client component).
6. `ExploreView` handles filter state, URL updates via `router.push`, and scroll restoration via `sessionStorage`.

## Data Flow: Check-In

1. User taps `<CheckInButton />`.
2. Button calls `navigator.geolocation.getCurrentPosition()`.
3. Coordinates are POSTed to `POST /api/check-in`.
4. Route handler calls `supabase.rpc("check_in_event", { p_event_id, p_lat, p_lng, ... })`.
5. RPC validates: geofence radius, time window, not already checked in.
6. On success: row inserted into `check_ins`. On failure: row inserted into `check_in_attempts`.

## Data Flow: Email Notifications (Cron)

1. Vercel triggers `GET /api/cron/process-notifications` daily at 13:00 UTC (9 AM ET).
2. Request must have `Authorization: Bearer <CRON_SECRET>` header.
3. Handler calls `supabaseAdmin.rpc("get_pending_notification_jobs", { p_limit: 10 })`.
4. For each job: sends email via Resend, then marks job `status = 'sent'` in `event_notification_queue`.

## Data Flow: Host Invitation

1. Admin sends invite via `<InviteMemberModal />` → writes row to `org_invites`.
2. Email is sent with a link containing `?invite_token=<token>`.
3. User clicks link → redirected to login.
4. After login, `GET /api/invites/accept?invite_token=<token>` runs.
5. Handler validates token, checks email match, inserts into `org_members`, deletes invite.

## Route Protection Summary

| Path | Guard |
|---|---|
| `/admin/*` | Middleware: redirects if no session |
| `/profile` | Server component: `redirect("/login")` if no user |
| `/host/[slug]/*` | Client layout: `HostContext` redirects if no orgs |
| `/api/cron/*` | `Authorization: Bearer <CRON_SECRET>` header check |
| `/api/check-in` POST | 401 if no session |
| `/api/upload` POST | 401 if no session |

> **Note:** The middleware only checks that a session exists for `/admin`. It does not verify the `app_admins` table. The `app_admins` check happens inside individual admin page server components.

## Timezone Handling

All datetime inputs are assumed to be `America/New_York`. The `convertToUTC` function in `lib/timezone.ts` converts wall-clock strings to UTC ISO for DB storage. **The timezone is hardcoded** — there is no per-user or per-event timezone configuration.

## Theme

DaisyUI is configured with three themes: `light`, `corporate`, `forest`. The root HTML element uses `data-theme="floats"` (a custom theme defined in `globals.css`). The host dashboard uses `data-theme="corporate"`.

## Deployment

- Deployed on Vercel.
- Cron jobs configured in `vercel.json`.
- Build uses `npm run build:ci` (Webpack, not Turbopack) in CI.
- Local dev uses `npm run dev` (Turbopack).
