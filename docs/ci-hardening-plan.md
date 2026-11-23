# CI Hardening Plan

## Current CI State

Defined in `.github/workflows/ci.yml`. Triggers on: PR to `main`, push to `main`.

### Jobs

| Job | Runs after | `continue-on-error` | Purpose |
|---|---|---|---|
| `lint_typecheck` | — | **true** | ESLint + `tsc --noEmit` |
| `test` | — | **true** | `jest --ci --passWithNoTests` |
| `build` | lint_typecheck, test | false | `next build` (Webpack) |

The build job **can still run even if lint or tests fail** (`continue-on-error: true` on those jobs + `needs` only waits for job completion, not success). A failing lint or test will not block a merge.

### What's Good
- Concurrency cancellation: older runs for the same branch are cancelled automatically
- Node.js cache via `actions/setup-node` with `cache: npm`
- Next.js build cache with `actions/cache` keyed on `package-lock.json` + source files
- Stub env vars allow the build to succeed without live Supabase credentials
- `--passWithNoTests` prevents CI failure if test files are removed

---

## Hardening Recommendations

### 1. Make lint and test failures block merges

Remove `continue-on-error: true` from both jobs. This is the highest-impact change.

```yaml
# Current (permissive)
lint_typecheck:
  continue-on-error: true

# Hardened
lint_typecheck:
  # (remove the line entirely — default is false)
```

This requires fixing any existing lint/type errors first (`npm run lint`, `npx tsc --noEmit`).

---

### 2. Fix ESLint not failing builds

`next.config.ts` has `eslint: { ignoreDuringBuilds: true }`. This hides lint errors in production deploys.

```ts
// Current
eslint: { ignoreDuringBuilds: true }

// Hardened — remove the option entirely or set to false
// eslint: { ignoreDuringBuilds: false }
```

Only do this after clearing current lint errors.

---

### 3. Add typecheck to required checks

The `lint_typecheck` job runs `tsc --noEmit` but with `continue-on-error: true`, type errors don't block PRs. After removing `continue-on-error`, add branch protection rules in GitHub:

- Require status checks: `Lint & Typecheck`, `Tests`, `Build`
- Require up-to-date branches before merge

---

### 4. Add secret scanning

Add a step to detect accidentally committed secrets:

```yaml
- name: Scan for secrets
  uses: trufflesecurity/trufflehog@main
  with:
    path: ./
    base: ${{ github.event.repository.default_branch }}
    head: HEAD
```

---

### 5. Add dependency vulnerability check

```yaml
- name: Audit dependencies
  run: npm audit --audit-level=high
```

Run in the `lint_typecheck` job. Use `--audit-level=high` to only fail on high/critical.

---

### 6. Split test from lint+typecheck

When tests grow, separate jobs allow parallel runs and clearer failure attribution:

```yaml
jobs:
  lint:
    name: Lint
  typecheck:
    name: Typecheck  
  test:
    name: Tests
  build:
    needs: [lint, typecheck, test]
```

---

### 7. Add environment variable validation at build time

Create a build-time check that warns if required env vars are unset (beyond the current stub approach).

---

### 8. Add Playwright E2E job (future)

Once E2E tests are written (see [testing-plan.md](./testing-plan.md)):

```yaml
e2e:
  name: E2E Tests
  needs: [build]
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 20
    - run: npm ci
    - run: npx playwright install --with-deps
    - run: npx playwright test
  env:
    NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.E2E_SUPABASE_URL }}
    NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.E2E_SUPABASE_ANON_KEY }}
```

Use a separate, isolated Supabase project for E2E to avoid polluting production data.

---

## Immediate Actions (in order)

1. Run `npx tsc --noEmit` and `npm run lint` locally; fix all errors.
2. Remove `continue-on-error: true` from both CI jobs.
3. Remove `ignoreDuringBuilds: true` from `next.config.ts`.
4. Enable branch protection rules in GitHub requiring all jobs to pass.
5. Add `npm audit` step.
