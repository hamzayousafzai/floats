# Auth & RBAC

## Authentication Method

Supabase OTP (one-time password) via email. No password, no OAuth providers.

**Flow:**
1. User enters email in `LoginForm.tsx`.
2. `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })` — creates account if new.
3. Supabase sends a 6-digit code to the email.
4. User enters code → `supabase.auth.verifyOtp({ email, token, type: "email" })`.
5. On success, Supabase sets a session cookie (managed by middleware).

All session management is handled by `@supabase/ssr`. Cookies are set/refreshed by `middleware.ts` on every request.

## Session Lifecycle

- **Middleware (`middleware.ts`)**: Calls `supabase.auth.getSession()` on every non-static request to refresh the session token. Cookies are updated in the response.
- **Server components**: Use `createSupabaseServer()` → reads cookies (read-only).
- **Client components**: Use `createSupabaseBrowserClient()` → manages its own session from localStorage/cookies.
- **Sign out**: `app/actions/logout.ts` calls `supabase.auth.signOut()` then redirects.

## Roles & Access Levels

There are three distinct access levels in the application.

### 1. Unauthenticated User
- Can browse Explore, Map, Vendor pages (all read-only public data).
- Cannot: save favorites, star events, check in, subscribe to notifications.
- Attempting auth-required actions redirects to `/login`.

### 2. Authenticated User (Consumer)
- All of the above, plus:
- Favorites (`favorites` table)
- Event stars (`event_stars` table)
- Check-ins (`check_ins` table)
- Notification subscriptions (`event_notifications` table)
- User profile (`profiles` table)
- Series follows (`series_follows` table)

### 3. Org Member (Host)
- Users present in `org_members` for one or more orgs.
- Access to `/host/[slug]/*` dashboard for their orgs.
- Role within org is stored as `org_role` enum in `org_members`.
- `HostContext` reads from the `user_org_roles` view on auth.
- Redirected to `/profile` if they have no orgs.

**Org role values:** unknown — check `org_role` enum in `database.types.ts`. At minimum, `owner` and `manager` exist based on invite code usage.

### 4. Global Admin (`app_admins` table)
- A user whose `user_id` appears in `app_admins`.
- Has access to `/admin/*` panel.
- In `HostContext`, admins receive a synthetic `role: 'admin'` and can see all orgs.
- **There is no `admin` value in `org_role`** — admin role is only represented in `HostContextType` as a string literal union.

## Route Protection Details

### Middleware (`middleware.ts`)
```
/admin/*  →  checks: user session exists
             missing: redirect to /login
             NOTE: does NOT verify app_admins table — only checks auth existence
```

All other routes are unprotected at the middleware level.

### Server Component Guards
```
/profile                →  redirect("/login") if !user
/app/(app)/vendor/[slug] →  (unknown — review vendor page)
```

### Client Layout Guards
```
/host/[slug]/*  →  HostContext: if !loading && !currentOrg && userOrgs.length === 0
                               → router.replace('/profile')
```

### API Route Guards

| Endpoint | Guard |
|---|---|
| `POST /api/check-in` | `401` if no session |
| `GET /api/check-in` | Soft-fail: returns `{ checked: false }` if no session |
| `POST /api/upload` | `401` if no session |
| `GET /api/cron/process-notifications` | `401` if `Authorization` header ≠ `Bearer <CRON_SECRET>` |
| `GET /api/invites/accept` | Validates active session via `supabase.auth.getSession()` |
| `GET /api/events/[id]/star` | (unknown — review route) |
| `GET /api/events/[id]/notify` | (unknown — review route) |
| `GET /api/map/search` | No auth guard (public) |

## Supabase Clients

Three separate client factories are used depending on context:

| Client | File | Key | Use case |
|---|---|---|---|
| `createSupabaseServer()` | `lib/supabase/server.ts` | Anon key | Server components, read-only |
| `createSupabaseServerRW(setCookie, delCookie)` | `lib/supabase/server.ts` | Anon key | Route handlers needing cookie writes |
| `createSupabaseBrowserClient()` | `lib/supabase/client.ts` | Anon key | Client components |
| `createSupabaseAdmin()` | `lib/supabase/admin.ts` | **Service role key** | Privileged server operations, bypasses RLS |

> **Security note:** `createSupabaseAdmin()` bypasses all Row Level Security. Only use it in server-side API routes that you have independently secured. Never import it in client components or expose it to the browser.

## Row-Level Security (RLS)

RLS is enabled on Supabase. The anon-key clients enforce RLS for all queries. Policies are defined in the Supabase dashboard (not tracked in this repo). Key policy assumptions (verify in Supabase):

- `events` / `vendors` / `areas` / `categories` — publicly readable (SELECT for anon)
- `favorites` / `event_stars` / `check_ins` / `event_notifications` — user can only read/write their own rows
- `org_members` — readable by org members; write only via admin client or RPC
- `app_admins` — readable only (used for `SELECT … .eq("user_id", user.id)` checks)
- `event_notification_queue` — write only via admin client (cron)

> **Unknown:** Full policy definitions are not stored in this repo. Run `supabase db dump` to capture them.

## Known Auth/RBAC Gaps

1. **Middleware admin check is incomplete.** `/admin/*` only checks that a session exists. An authenticated non-admin user who knows the URL can access admin pages. Each admin page server component performs its own `app_admins` check, but this is defense-in-depth only, not middleware enforcement.

2. **Deprecated auth helper in invite flow.** `app/api/invites/accept/route.ts` uses `createRouteHandlerClient` from `@supabase/auth-helpers-nextjs` (deprecated package), not `@supabase/ssr`. This is inconsistent with the rest of the codebase.

3. **No host role enforcement at the API level.** Host dashboard data mutations (event create/edit/delete) are done client-side via `createSupabaseBrowserClient()`. Authorization relies entirely on Supabase RLS policies. If RLS is misconfigured, any authenticated user could write to org data.
