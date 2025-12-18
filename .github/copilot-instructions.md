# Floats App - AI Coding Instructions

## Project Overview
- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Database**: Supabase (PostgreSQL)
- **Styling**: Tailwind CSS + DaisyUI
- **Maps**: MapLibre GL JS
- **Icons**: Lucide React

## Architecture & Structure
- **App Router**:
  - `app/(app)`: Main user-facing application (Explore, Map, Profile).
  - `app/admin`: Internal admin panel.
  - `app/host`: Vendor/Host dashboard.
  - `app/api`: Backend API endpoints (Cron, Search, Uploads).
- **Components**: Located in `components/`, organized by feature (e.g., `explore`, `map`, `profile`).
- **Lib**: Shared utilities in `lib/`.
  - `lib/supabase`: Supabase client/server initialization.
  - `lib/database.types.ts`: Generated Supabase types.

## Data Fetching & Supabase
- **Server Components**: Prefer fetching data in Server Components using `createSupabaseServer`.
  - Use `supabase.rpc("function_name", params)` for complex queries.
  - Use `revalidate = 0` and `dynamic = 'force-dynamic'` for pages requiring real-time data.
- **Client Components**: Use `createSupabaseBrowserClient` for client-side interactions (auth, subscriptions).
- **Middleware**: Handles session refreshing and route protection (`middleware.ts`).
- **Types**:
  - Use `Database` from `@/lib/database.types` for raw DB types.
  - Use shared UI types from `@/lib/types.ts` (e.g., `ExploreCardData`).

## Styling & UI
- **Tailwind + DaisyUI**: Use utility classes and DaisyUI components (e.g., `card`, `btn`, `modal`).
- **Icons**: Use `lucide-react` for all icons.
- **Responsiveness**: Ensure designs work on mobile first.

## Developer Workflows
- **Database Types**: After schema changes, run:
  ```bash
  npx supabase gen types typescript --project-id "your-project-id" > lib/database.types.ts
  ```
- **Environment Variables**: stored in `.env.local`.
- **Linting**: Run `npm run lint` to check for issues.

## Common Patterns
- **Dates**: Use `date-fns` or native `Date` with `toLocaleString("en-US", { timeZone: "America/New_York" })`.
- **Images**: Use `next/image` with proper aspect ratios and fallbacks.
- **Maps**: Map logic is centralized in `components/map/MapCanvas.tsx`.

## Example: Data Fetching in Server Component
```tsx
import { createSupabaseServer } from "@/lib/supabase/server";

export default async function Page() {
  const supabase = createSupabaseServer();
  const { data, error } = await supabase.from("table").select("*");
  // ... handle data
}
```
