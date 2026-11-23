# Feature Plan Template

Copy this file when planning a new feature. Fill in each section before writing code.

---

## Feature: [Feature Name]

**Date:** YYYY-MM-DD  
**Author:** [Name]  
**Status:** Draft | In Review | Approved | In Progress | Done

---

## 1. Problem / Motivation

> What user problem does this solve? Why now?

---

## 2. Proposed Solution (1-paragraph summary)

> Plain-language description of what will be built.

---

## 3. Scope

### In Scope
- [ ] Item 1
- [ ] Item 2

### Out of Scope
- Item A (deferred to future)
- Item B (separate feature)

---

## 4. User-Facing Changes

| Area | Change |
|---|---|
| UI route | e.g. New page at `/explore/map` |
| Components | e.g. New `<MapCluster />` component |
| Behavior | e.g. Tapping a pin opens the event detail modal |

---

## 5. Data Model Changes

> Does this require schema changes?

- [ ] New table: `table_name` (describe columns)
- [ ] New column: `table.column` — type, nullable, default
- [ ] New view: `view_name`
- [ ] New RPC: `function_name(params)` — purpose
- [ ] New enum value: `enum_name.value`
- [ ] Migration file needed: `supabase/migrations/YYYYMMDD_description.sql`
- [ ] DB types need regeneration: `npm run db:types`

If no schema changes: **None required.**

---

## 6. API / Backend Changes

> Route handlers, server actions, or cron changes.

| Method | Path | Auth required | Purpose |
|---|---|---|---|
| GET | `/api/...` | yes/no | Description |

---

## 7. Auth / RBAC Impact

> Who can access this feature? Does it require new role checks?

- Unauthenticated users: can / cannot access
- Authenticated users: can / cannot access
- Org members: n/a / requires org membership check
- Global admins: n/a / admin-only
- New RLS policy needed: yes / no (describe)
- Middleware changes needed: yes / no

---

## 8. Environment Variables

> Any new env vars needed?

| Variable | Required | Notes |
|---|---|---|
| `NEW_VAR` | yes/no | Description |

If none: **None required.**

Update [env-vars.md](./env-vars.md) if adding new variables.

---

## 9. UI/UX Notes

> Wireframes, design references, or behavior notes.

- Theme to use: `floats` / `corporate` / `forest`
- Mobile-first: yes (required)
- Component source: DaisyUI component / custom / reuse existing `XYZ`

---

## 10. Test Plan

> How will this be tested before merge?

- [ ] Unit tests: which components / functions
- [ ] API route tests: which endpoints
- [ ] Manual test steps:
  1. Step 1
  2. Step 2
- [ ] E2E test: scenario (if applicable)

---

## 11. Dependencies

> Any new npm packages, external services, or upstream features required?

- npm packages: none / `package-name@version` (reason)
- External services: none / service name (how used)
- Upstream features: none / feature X must land first

---

## 12. Rollout / Cleanup

- Feature flag needed: yes / no
- Data migration needed: yes / no (describe)
- Dead code to remove after launch: yes / no (list files)
- Docs to update: [repo-map.md](./repo-map.md) / [data-model.md](./data-model.md) / [auth-rbac.md](./auth-rbac.md)

---

## 13. Open Questions

- [ ] Question 1
- [ ] Question 2
