# Testing Plan

## Current State

### Test Framework
- **Runner:** Jest 30
- **Environment:** `jest-environment-jsdom`
- **Utilities:** `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`
- **TypeScript:** `ts-jest`
- **Config:** `jest.config.mjs` + `jest.setup.ts`

### What Exists

Coverage is configured for `components/explore/**` and `components/profile/**` only.

#### `__tests__/explore/`

| File | Component | What's Tested |
|---|---|---|
| `ExploreView.test.tsx` | `ExploreView` | Card rendering, empty state, featured section, `handleCardClick`, `handleFilterChange`, `clearAllFilters`, scroll restore from sessionStorage |
| `EventCard.test.tsx` | `EventCard` | (unknown — not read) |
| `ExploreFilters.test.tsx` | `ExploreFilters` | (unknown — not read) |
| `FeaturedEventCard.test.tsx` | `FeaturedEventCard` | (unknown — not read) |
| `FilterSheet.test.tsx` | `FilterSheet` | (unknown — not read) |

#### `__tests__/profile/`

| File | Component | What's Tested |
|---|---|---|
| `BadgeRow.test.tsx` | `BadgeRow` | (unknown — not read) |
| `BadgesDetailModal.test.tsx` | `BadgesDetailModal` | (unknown — not read) |
| `PastActivityTabs.test.tsx` | `PastActivityTabs` | (unknown — not read) |
| `ProfileStats.test.tsx` | `ProfileStats` | (unknown — not read) |

### What's NOT Tested

- **API routes** — zero test coverage for any `app/api/*` route handler
- **Server components** — no tests for `explore/page.tsx`, `profile/page.tsx`, etc.
- **Server actions** — no tests for `app/actions/favorites.ts`, `app/actions/logout.ts`
- **Middleware** — no tests for session refresh or admin redirect logic
- **HostContext** — no tests for the React context
- **Map components** — `MapCanvas.tsx` and related are untested
- **Auth flow** — `LoginForm.tsx` is untested
- **Admin components** — `EditEventForm.tsx`, `EditOrgForm.tsx`, etc. are untested
- **Host components** — host dashboard pages are untested
- **Email templates** — `TwoDayReminderEmail.tsx`, `EventStartingEmail.tsx` are untested
- **E2E tests** — Playwright is installed as a devDependency but zero test files exist

---

## Recommended Testing Plan

### Priority 1 — Critical Path Unit Tests

These cover the most user-facing and security-relevant logic.

#### API Routes (Jest + `node-mocks-http` or direct handler tests)
- `POST /api/check-in` — test: auth guard, bad input, success path, each failure code
- `GET /api/check-in` — test: unauthenticated soft-fail, authenticated with existing check-in
- `POST /api/upload` — test: auth guard, no file, successful upload
- `GET /api/cron/process-notifications` — test: missing secret, correct secret, no jobs, job processing

#### Server Actions
- `toggleFavorite` — test: unauthenticated redirect, toggle on, toggle off
- `signOut` — test: calls signOut + redirects

#### Utility Functions
- `lib/geo.ts` — `clamp`, `normalizeBbox`, `getTimeWindowSQL` are pure functions; easy to test
- `lib/timezone.ts` — `convertToUTC`: test already-zoned string passthrough, wall-clock conversion, null/undefined passthrough

### Priority 2 — Component Tests (expand existing coverage)

- `LoginForm.tsx` — test: email submit, code entry, error states
- `CheckInButton.tsx` — test: geolocation mock, success state, error code display
- `FavoriteButton.tsx` — test: optimistic toggle, loading state
- `HostContext.tsx` — test: admin vs member data fetch, setCurrentOrgBySlug, loading state
- Map components — mock MapLibre GL and test filter/pin logic in isolation

### Priority 3 — Integration / E2E (Playwright)

Playwright is already installed. Create `e2e/` directory.

Suggested smoke tests:
1. **Explore page loads** — visit `/explore`, see event cards
2. **Login flow** — OTP request and code entry (requires test Supabase account)
3. **Favorite toggle** — authenticated user can star/unstar an event
4. **Check-in** — mock geolocation, submit check-in
5. **Host event creation** — org member can create an event

### Running Tests

```bash
# Unit tests
npm test

# Watch mode
npm run test:watch

# With coverage
npm run test:coverage
```

Coverage report outputs to `coverage/` (gitignored).

### Mocking Supabase

Tests should not hit the live Supabase database. Use `jest.mock()` at the module level:

```ts
jest.mock("@/lib/supabase/server", () => ({
  createSupabaseServer: jest.fn(() => ({
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    // ...
  })),
}));
```

Or use a shared mock factory in `__tests__/__mocks__/supabase.ts` (does not currently exist — would need to be created).
