# Local Setup

## Prerequisites

- Node.js 20+
- npm 10+
- A Supabase project (the app targets a remote Supabase instance — there is no local Docker setup currently configured in this repo)

## Steps

### 1. Install dependencies

```bash
cd floats
npm install
```

### 2. Create `.env.local`

Copy the required values from your Supabase project dashboard and any other services.  
See [env-vars.md](./env-vars.md) for the full list.

```bash
# Create the file manually. `.env.example` only covers the ingestion workers, not the app keys below.
touch .env.local
```

Minimum required to run the dev server:
```
NEXT_PUBLIC_SUPABASE_URL=https://<project-id>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

### 3. Start the dev server

```bash
npm run dev
```

Opens at [http://localhost:3000](http://localhost:3000). The root `/` redirects to `/explore`.

Turbopack is used in development (`next dev --turbopack`). The production build uses Webpack (`next build:ci`).

## Common npm Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start dev server with Turbopack |
| `npm run build` | Production build with Turbopack |
| `npm run build:ci` | Production build with Webpack (used in CI) |
| `npm run lint` | Run ESLint |
| `npm test` | Run Jest tests |
| `npm run test:watch` | Run Jest in watch mode |
| `npm run test:coverage` | Run Jest with coverage report |
| `npm run db:types` | Regenerate `lib/database.types.ts` from live Supabase schema |
| `npm run db:dump` | Dump schema SQL to `../supabase/schema.sql` |
| `npm run db:pull` | Run `db:types` + `db:dump` + `db:dump:functions` together |

## Regenerating Database Types

After any schema change in Supabase:

```bash
npm run db:types
```

This runs:
```bash
npx supabase gen types typescript --project-id inxlsvowzpqvfulhbnou --schema public > lib/database.types.ts
```

> **Note:** The Supabase project ID `inxlsvowzpqvfulhbnou` is hardcoded in `package.json`. Update it if the project changes.

## Applying Migrations

Migrations are in `supabase/migrations/`. There is no automated migration runner configured locally. To apply:

1. Copy the SQL from the migration file.
2. Run it in the Supabase dashboard SQL editor, or use `supabase db push` if the Supabase CLI is linked.

## Running Tests

```bash
npm test
```

Tests are in `__tests__/explore/` and `__tests__/profile/`. They use jsdom and mock Next.js navigation. No Supabase connection is needed to run tests.

## TypeScript Check

```bash
npx tsc --noEmit
```

## Linting

```bash
npm run lint
```

> **Note:** ESLint errors do not fail the production build (`ignoreDuringBuilds: true` in `next.config.ts`). Fix lint errors before merging.
