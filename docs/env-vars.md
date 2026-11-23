# Environment Variables

Create a `.env.local` file in the `floats/` directory. This file is gitignored and must be set up manually.

> `.env.example` exists but covers only the ingestion workers (`INGESTION_*`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`). It does not list `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `RESEND_API_KEY`, `CRON_SECRET` or `CHECKIN_DEBUG`, so this document is the reference for the web app. Do not copy `.env.example` over an app `.env.local` without adding those keys, and never point either file at production for tests or ingestion runs.
>
> `npm run ingest:staging-check` (operator-only, read-only) additionally reads `INGESTION_STAGING_CONFIRM` (must be `staging-not-production`), `INGESTION_STAGING_PROJECT_REF` (must match the URL), optional `INGESTION_STAGING_AUTHENTICATED_JWT` and optional `INGESTION_PRODUCTION_PROJECT_REFS` (comma-separated refs that must never match), together with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. Set them per shell session with STAGING values only. See `docs/operations/automated-event-ingestion-staging-setup.md`.

---

## Required — Always

These must be set to run the app at all.

| Variable | Where to find it | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → Project Settings → API | Public, safe to expose to browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase dashboard → Project Settings → API | Public anon key; RLS enforced |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Project Settings → API | **Secret.** Never expose to client. Used by admin client, upload, and invite endpoints |

---

## Required — For Email Notifications

These are needed for the cron job and invite emails to work.

| Variable | Where to find it | Notes |
|---|---|---|
| `RESEND_API_KEY` | Resend dashboard → API Keys | Used by `POST /api/cron/process-notifications` to send emails |
| `CRON_SECRET` | Set yourself — any secure random string | Must match the `Authorization: Bearer <CRON_SECRET>` header sent by Vercel Cron |

Without `RESEND_API_KEY`, the cron endpoint returns a `500` (guarded by an env check).  
Without `CRON_SECRET`, the cron endpoint returns `401 Unauthorized` for any caller.

---

## Optional / Dev-Only

| Variable | Default | Notes |
|---|---|---|
| `CHECKIN_DEBUG` | `"false"` | Set to `"true"` to enable verbose check-in logging in `POST /api/check-in` |
| `NODE_ENV` | Set by Next.js | `development` enables the `DEBUG` flag in `middleware.ts` |

---

## Vercel Environment

In production (Vercel), set all variables in the Vercel project dashboard under **Settings → Environment Variables**. These are the web-app variables only: the ingestion workers do not run on Vercel. They run in GitHub Actions and read the `INGESTION_*` values and an isolated project's service key from GitHub secrets and variables. Deploying the app to Vercel does not deploy the ingestion database migration or activate the scheduled workers.

The CI workflow stubs two variables to allow the build to succeed without hitting Supabase:

```yaml
NEXT_PUBLIC_SUPABASE_URL: http://localhost
NEXT_PUBLIC_SUPABASE_ANON_KEY: placeholder
```

`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, and `CRON_SECRET` are not needed at build time.

---

## Example `.env.local`

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://inxlsvowzpqvfulhbnou.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Email
RESEND_API_KEY=re_...

# Cron security
CRON_SECRET=some-long-random-secret

# Optional
CHECKIN_DEBUG=false
```

---

## Security Notes

- `SUPABASE_SERVICE_ROLE_KEY` bypasses all RLS. Never import `lib/supabase/admin.ts` in a client component.
- `CRON_SECRET` is the only protection for the notification cron endpoint. Rotate it if exposed.
- `NEXT_PUBLIC_*` variables are bundled into the client JS bundle. Do not put secrets in them.
