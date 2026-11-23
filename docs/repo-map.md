# Repo Map

Root: `floats/` (the Next.js app)

```
floats/
├── app/                        # Next.js App Router
│   ├── layout.tsx              # Root layout — wraps ALL routes; mounts HostProvider + WelcomeBanner
│   ├── page.tsx                # Root page — redirects / → /explore (see next.config.ts)
│   ├── globals.css             # Global styles (Tailwind base, custom theme overrides)
│   │
│   ├── (app)/                  # Route group: main consumer-facing UI
│   │   ├── layout.tsx          # App shell: main scroll area + BottomNav + modal slot
│   │   ├── explore/page.tsx    # Server component: fetches events via RPCs, renders ExploreView
│   │   ├── map/page.tsx        # Map view (MapLibre)
│   │   ├── profile/page.tsx    # Server component: requires auth, fetches user data
│   │   ├── login/page.tsx      # OTP login (wraps LoginForm in Suspense)
│   │   ├── vendor/[slug]/      # Vendor detail page
│   │   └── @modal/(..)/events/ # Parallel route: intercepted event detail modal
│   │       └── [id]/           # Renders EventDetailModal for /events/[id] from within (app)
│   │
│   ├── admin/                  # Internal admin panel (user must be in app_admins table)
│   │   ├── layout.tsx          # Simple heading wrapper; security handled by middleware
│   │   ├── page.tsx            # Dashboard: links to events + orgs management
│   │   ├── events/             # Event CRUD (list, new, [id]/edit)
│   │   └── orgs/               # Org management (list, new, [id])
│   │
│   ├── host/                   # Vendor/host dashboard
│   │   ├── layout.tsx          # Client layout: syncs HostContext with URL slug; guards auth
│   │   └── [slug]/             # Scoped to a single org slug
│   │       ├── page.tsx        # Host home
│   │       ├── events/         # Org event management (client-side CRUD)
│   │       ├── analytics/      # (unknown contents)
│   │       └── settings/       # (unknown contents)
│   │
│   ├── actions/                # Next.js Server Actions
│   │   ├── favorites.ts        # toggleFavorite — upsert/delete favorites row
│   │   └── logout.ts           # signOut — calls supabase.auth.signOut()
│   │
│   ├── api/                    # Route Handlers (REST endpoints)
│   │   ├── check-in/route.ts   # GET (status) + POST (submit check-in via check_in_event RPC)
│   │   ├── cron/
│   │   │   └── process-notifications/route.tsx  # Daily cron: sends emails via Resend
│   │   ├── events/[id]/
│   │   │   ├── ics/            # Generate .ics calendar file for an event
│   │   │   ├── notify/         # Subscribe/unsubscribe event notifications
│   │   │   └── star/           # Star/unstar an event
│   │   ├── invites/accept/route.ts  # Processes invite token + adds user to org
│   │   ├── map/search/route.ts      # Bbox search for map pins
│   │   ├── series/[id]/        # Series follow/unfollow
│   │   └── upload/route.ts     # Uploads image to Supabase Storage (event-images bucket)
│   │
│   └── events/[id]/            # Standalone event detail page (non-intercepted)
│
├── components/                 # Reusable UI components
│   ├── FavoriteButton.tsx      # Heart toggle — calls toggleFavorite server action
│   ├── NotificationBell.tsx    # Bell toggle — hits /api/events/[id]/notify
│   ├── SeriesFollowButton.tsx  # Follow/unfollow a series
│   ├── ShareButton.tsx         # Native share sheet / copy link
│   ├── SignOutButton.tsx       # Calls signOut server action
│   │
│   ├── admin/                  # Admin-only forms and buttons
│   │   ├── DeleteEventButton.tsx
│   │   ├── EditEventForm.tsx
│   │   ├── EditOrgForm.tsx
│   │   └── InviteMemberModal.tsx
│   │
│   ├── auth/
│   │   └── LoginForm.tsx       # OTP flow: email → 6-digit code → verify
│   │
│   ├── checkin/
│   │   └── CheckInButton.tsx   # Geolocate + POST /api/check-in
│   │
│   ├── emails/
│   │   ├── EventStartingEmail.tsx    # react-email template
│   │   └── TwoDayReminderEmail.tsx   # react-email template
│   │
│   ├── explore/
│   │   ├── EventCard.tsx            # Card tile for event list
│   │   ├── EventDetailModal.tsx     # Full-screen event detail sheet/modal
│   │   ├── ExploreFilters.tsx       # Filter pill row
│   │   ├── ExploreView.tsx          # Client orchestrator: card list + filters + scroll restore
│   │   ├── FeaturedCarousel.tsx     # Horizontal scroll of featured events
│   │   ├── FeaturedEventCard.tsx    # Card variant for featured events
│   │   └── FilterSheet.tsx          # Bottom sheet for advanced filters
│   │
│   ├── filters/
│   │   └── AreaFilters.tsx
│   │
│   ├── layouts/
│   │   ├── AppHeader.tsx       # (unknown usage — not referenced in app layout)
│   │   └── ContextBar.tsx      # Host dashboard top bar showing current org
│   │
│   ├── map/
│   │   ├── MapBottomSheet.tsx
│   │   ├── MapCanvas.tsx       # MapLibre GL canvas; all map logic lives here
│   │   ├── MapFilters.tsx
│   │   ├── MapFilterSheet.tsx
│   │   └── PinPopup.tsx
│   │
│   ├── nav/
│   │   ├── BottomNav.tsx       # Consumer bottom nav (Explore, Map, Profile)
│   │   └── HostBottomNav.tsx   # Host dashboard bottom nav
│   │
│   ├── profile/
│   │   ├── AllFavoritesModal.tsx
│   │   ├── BadgeRow.tsx
│   │   ├── BadgesDetailModal.tsx
│   │   ├── FavoriteEventsSection.tsx
│   │   ├── PastActivityTabs.tsx
│   │   ├── ProfileHeader.tsx
│   │   ├── ProfileStats.tsx
│   │   └── SwitchViewButton.tsx
│   │
│   └── UI/
│       └── WelcomeBanner.tsx   # One-time onboarding banner (localStorage-gated)
│
├── lib/                        # Shared utilities and type definitions
│   ├── database.types.ts       # Auto-generated Supabase TypeScript types (do not edit)
│   ├── types.ts                # App-level types: EventPin, ExploreCardData, OrgMember, WhenFilter
│   ├── geo.ts                  # clamp, normalizeBbox, getTimeWindowSQL helpers
│   ├── timezone.ts             # convertToUTC — wall-clock → UTC (hardcoded to America/New_York)
│   ├── contexts/
│   │   └── HostContext.tsx     # React context for host dashboard; stores current org + role
│   ├── mappers/
│   │   └── eventToCard.ts      # DEAD FILE — entire contents are commented out
│   └── supabase/
│       ├── client.ts           # createSupabaseBrowserClient — browser/client components
│       ├── server.ts           # createSupabaseServer (read-only) + createSupabaseServerRW
│       └── admin.ts            # createSupabaseAdmin — service role, bypasses RLS
│
├── __tests__/                  # Jest unit tests
│   ├── explore/                # Tests for explore/ components (5 test files)
│   └── profile/                # Tests for profile/ components (4 test files)
│
├── data/                       # Reference SQL files
│   ├── schema.sql              # (unknown — likely a snapshot, not used in CI)
│   └── seeds.sql               # Seed data
│
├── supabase/                   # Local Supabase migration files
│   └── migrations/
│       ├── 20260501000000_add_event_url.sql   # Adds event_url column + recreates active_events view
│       ├── 20261120000100_automated_event_ingestion.sql        # ingestion schema, links, publisher function
│       ├── 20261120000200_ingestion_updates_and_review.sql     # imported-event updates, review functions
│       ├── 20261121000100_ingestion_event_deletion_policy.sql  # ON DELETE SET NULL, event_deleted audit
│       ├── 20261122000100_ingestion_pipeline_run_lock.sql      # one running collection/verification/replay run
│       ├── functions.sql                      # Full RPC definitions (untracked production dump)
│       └── patch_functions.sql               # Incremental RPC patches (untracked production dump)
│
├── docs/operations/            # Ingestion runbook, launch checklist, staging setup guide, staging SQL checks
│
├── scripts/
│   └── dump-functions.mjs      # Helper to dump DB functions
│
├── public/
│   └── images/                 # Static assets
│
├── middleware.ts               # Session refresh + /admin route guard
├── next.config.ts              # Redirects (/ → /explore), image domains, ESLint bypass in builds
├── tailwind.config.ts          # Tailwind content paths; DaisyUI themes: light, corporate, forest
├── package.json                # Dependencies and npm scripts
├── jest.config.mjs             # Jest: jsdom env, @/ alias, coverage for explore + profile
├── jest.setup.ts               # Imports @testing-library/jest-dom
├── vercel.json                 # Cron: /api/cron/process-notifications at 0 13 * * * (UTC)
├── tsconfig.json               # strict: true, paths: @/* → *
└── .github/
    ├── copilot-instructions.md # AI coding instructions
    └── workflows/ci.yml        # CI: lint + typecheck + test + build
```

## Key Conventions

| Convention | Detail |
|---|---|
| Path alias | `@/` maps to `floats/` root |
| Server components | Default; use `createSupabaseServer()` for DB reads |
| Client components | `"use client"` directive required; use `createSupabaseBrowserClient()` |
| Server actions | `"use server"` directive; files in `app/actions/` |
| API routes | `app/api/**/route.ts` — plain Route Handlers |
| DB types | Import from `@/lib/database.types` (`Database`, `Tables<'name'>`) |
| UI types | Import from `@/lib/types` (`ExploreCardData`, `EventPin`, etc.) |
