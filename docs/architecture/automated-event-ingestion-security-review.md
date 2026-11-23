# Automated Event Ingestion - Security Review

Status: code review and automated tests only (hardening pass). Nothing is deployed. No live Supabase project, GitHub secret store or live source was inspected. Items marked UNVERIFIED or BLOCKED need an operator with authorized access.

Evidence legend: SUBSTITUTE-PG means the embedded PostgreSQL plus PostGIS shim in `tests/ingestion/db-harness`. It is useful for SQL logic and grants, but it is not real Supabase or real PostGIS.

## Findings by audit item

| # | Area | Result | Evidence / action |
|---|------|--------|-------------------|
| 1 | GitHub secret exposure | Workflows reference secrets only by name. `INGESTION_PUBLISH_MODE` is the literal `shadow`. No secret is echoed. Every third-party action is pinned to a full commit SHA (checkout v4.2.2, setup-node v4.4.0; verified against the GitHub API). Workflows state that secrets must come from an isolated staging project. | `tests/ingestion/security.test.ts` (SHA pin, no `continue-on-error`). Secret store contents UNVERIFIED. |
| 2 | Supabase grants / RLS / API exposure | Ingestion tables live in the `ingestion` schema, RLS enabled, all privileges revoked from `public`, `anon` and `authenticated`, granted to `service_role` only. The workers use `client.schema('ingestion')`, so the Data API MUST expose the `ingestion` schema. Protection comes from the revoked grants and RLS, not from hiding the schema. | SUBSTITUTE-PG harness (grants, RLS, anon/authenticated denial). BLOCKED: confirm on the real project that `anon` and `authenticated` get `permission denied` through PostgREST for every ingestion table and function. |
| 3 | SECURITY DEFINER | Functions set `search_path = ''`, EXECUTE revoked from `PUBLIC`/`anon`/`authenticated`, granted to `service_role` only. The service-role check also runs inside the functions. | SUBSTITUTE-PG harness. |
| 4 | Admin role checks | New admin pages and `/api/admin/ingestion/*` check login and `app_admins` themselves. Legacy admin routes check ad hoc and middleware only checks login for `/admin`. | Security tests (401/403 cases). Residual risk: legacy routes, out of scope. |
| 5 | SSRF / DNS pinning | The HTTP fetcher resolves DNS, rejects private/loopback/link-local/metadata ranges, pins the connection to the validated IP and re-validates every redirect. The Playwright adapter is NOT SSRF-safe (Chromium re-resolves DNS and the route handler cannot pin the IP). It is therefore fail-closed: no worker script registers it, the workflow does not install Chromium, and tests assert both. All seeded sources use fetch-based adapters. | `tests/ingestion/adapters.test.ts`, `security.test.ts`. Do not wire Playwright until network containment (egress-restricted runner) exists. |
| 6 | Redirects | Bounded count, each hop re-validated, scheme limited to http/https. | Security tests. |
| 7 | robots / access restrictions | robots.txt honoured with crawl delay. Restricted or login-gated sources are stored as `restricted` and never fetched. Source ToS NOT reviewed. | Discovery tests. BLOCKED: ToS review per source. |
| 8 | Raw HTML / rendering | Raw payloads are stored as data and rendered as text by React. No `dangerouslySetInnerHTML` on ingestion data. URLs are scheme-checked. | Security tests. |
| 9 | Logs | Structured logger redacts secrets and truncates payloads. Config errors are sanitized. | `log.ts` tests. |
| 10 | Upload rights | Imported events never copy third-party images. | Normalizer tests. |
| 11 | Duplicate race / claimed events | Publisher locks the slot, then `canonical_key`. Different-candidate concurrency and replay produce one event. Claimed or manually edited events are never overwritten. | `concurrency.test.ts`, `end-to-end.test.ts`, SUBSTITUTE-PG harness. |
| 12 | Notification side effects | Automatic publication never writes to `public.events` in shadow mode. Admin manual publish is allowed in shadow mode (ADR section 6/7) and does write a `public.events` row through the publish function. The triggers on `public.events` were NOT inspected: the repository holds function dumps and a schema file, not a live trigger list. | UNVERIFIED / BLOCKED: list `pg_trigger` for `public.events` on the target project before the first manual publish or any live publication. |
| 13 | Event deletion | Migration `20261121000100` sets `ON DELETE SET NULL` on `candidates.published_event_id` and `publication_audit.event_id`, adds the `event_deleted` audit action and a trigger. A candidate stays `published` with a null pointer, so a deleted event is never silently re-created. | SUBSTITUTE-PG harness (286 checks). |
| 14 | Source-supplied coordinates | Coordinates are trusted only when read from JSON-LD `Place.geo` on the same place as a street-level address, valid, at least 4 decimals, inside the radius gate, and the source was marked `configuration.coordinateTrust = "verified"` by an operator out of band. The admin source API cannot edit `configuration`. Otherwise they are ignored and the candidate goes to review. | `tests/ingestion/source-coordinates.test.ts`. |
| 15 | Source metrics concurrency | `updateSourceMetrics` is a compare-and-swap with retry, so overlapping collection and verification cannot lose increments. | `storage.test.ts`. |

## Open risks
- `.env.local` contains production credentials. They were never used for this work. Rotate them.
- Real Supabase, real PostGIS and PostgREST exposure are not tested.
- No geocoder is configured. Without one, every candidate that has only an address stays `needs_review` (fail-closed), unless the source is explicitly coordinate-trusted.
- Domain dedupe uses a `www.`-stripped host, not the public suffix list.
- `ingest:verify` rechecks at most 1000 upcoming published candidates; a `recheck_incomplete` finding is raised when that cap is reached or the run deadline passes.
- Workflow schedules run only from the default branch; nothing runs until merged.
