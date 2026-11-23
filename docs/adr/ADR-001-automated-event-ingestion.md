# ADR-001 — Autonomous Charlotte event collection and trusted-source publication

- **Status:** Accepted
- **Date:** 2026-11-20
- **Decision scope:** `automated-event-ingestion`
- **Implementation:** `docs/plans/automated-event-ingestion-implementation-plan.md`
- **Technical authority:** `docs/architecture/automated-event-ingestion-spec.md`

## Context

Floats discovers Charlotte-area multi-vendor shopping markets and pop-ups (normally at least three independent vendors). Its Next.js 15/Supabase application already has production events, organizer and series relationships, categories, location-based discovery, an admin UI, favorites and notifications. Continual manual seeding cannot supply accurate, frequent, future event inventory. Aggregator and venue sites repeat the same events; a scraper that blindly inserts listings would introduce duplicates, expired or non-market events, erroneous venues and host-ownership conflicts.

Required behavior: no human involvement in **raw collection**; daily collection of known permitted sources; weekly automatic discovery of additional compatible sources; configurable Charlotte radius and future time window; validation and production deduplication; selective trusted-source auto-publication; evidence-backed exceptions review; low incremental operational cost; and unchanged existing host-facing behavior.

Repository inspection confirmed nullable `public.events.org_id`, required `public.orgs.owner_id`, publication enum `draft | published | archived`, an existing `admin_create_events_with_series` RPC, and map filtering that requires `published` status and coordinates. The older `data/schema.sql` must not be assumed to be the current live database schema.

## Decision

1. **One TypeScript monorepo subsystem.** Implement `lib/ingestion/` and `scripts/ingestion/` inside the existing Floats repository. Node.js 22 workers run on GitHub Actions, not on Vercel request handlers. Use JSON-LD, ICS, Cheerio static HTML, then Playwright only for permitted JS-rendered sites. All adapters produce typed raw records; none write production events.
2. **Separation of evidence, candidates and events.** Add private `ingestion` tables for sources, runs, immutable observations, candidates, observation links, discoveries, reviews and audit; add `public.event_ingestion_links` for provenance and ownership state. `public.events` remains canonical. The proposed additive migration is defined in the technical spec. Do not mutate existing production event columns or enums.
3. **Continuous source discovery.** Weekly discover linked organizer/venue sites and public feeds/sitemaps starting from approved seed sources. Safely register compatible source formats as `probation`. The system may record unsupported sources; V1 is *not* a universal autonomous scraper of arbitrary unseen web applications. Do not bypass robots policies, authentication or anti-bot controls. Do not require paid web search/proxy services in V1.
4. **Deterministic eligibility.** Validate time zone, complete start/end, upcoming date (default 60 days), distance from Charlotte center (default 35 miles, PostGIS geography), credible market/vendor evidence (3+ vendors or documented established organizer format), address and verified coordinates, description and cancellation state. Optional AI can be added for ambiguous classification only; it may not fill unknown facts.
5. **Source trust and scoring.** `probation | trusted | disabled`; only administrators can promote trust, after at least three successful runs and five explicitly reviewed qualifying candidates. Score bands: auto >=90, review 70–89; hard requirements always override score. New sources are probationary.
6. **Publication safety.** Initially `INGESTION_PUBLISH_MODE=shadow`: decisions and audits only, no automatic production writes. In `live`, trusted ready candidates may publish via a **restricted, idempotent PostgreSQL transaction** with an identity lock, production duplicate checks and provenance insertion. Manual approval/publish is separate and requires `public.app_admins` authorization. No publication on candidate discovery alone.
7. **No fabricated ownership.** V1 creates unclaimed imported events with `org_id = NULL`, `vendor_id = NULL`, `market_id = NULL`, `series_id = NULL`; verified category/area associations may be filled. The map API receives a narrow fallback for `organizer_display_name` from provenance. Never auto-create owner accounts or modify a host-owned event. Imported-event changes require ongoing ownership checks.
8. **Audit and observability.** Each run logs source-level success/failure and counts. Source disappearance is not a cancellation. Explicit verified cancellations can archive ingestion-managed events, with notification effects investigated before enabling that path. Retain audit and provenance; raw observations have a configurable retention policy.

## Consequences and trade-offs

**Benefits:** unattended ingestion, scalable source registry, reliable replay, historical quality assessment, low-cost reuse of TypeScript/Supabase/GitHub, controlled public event quality, protection of host-owned records and complete provenance.

**Costs:** source-specific adapters need maintenance; supported event data varies; JS rendering has extra CPU/memory cost; external geocoding policy and quotas can be a blocker; source trust needs manual calibration; production matching and concurrency impose DB constraints and indexing; monitoring and reconciliation are ongoing operational work.

**Performance:** initial configuration limits concurrency to three sources and 2 MB of streamed response body per request; fetch timeout 15 seconds; discovery depth two, max 25 discovery pages per source. Index `(status,score)`, dates, source and canonical identity. Store deduplicated raw observations by `(source_id,source_url,content_hash)`; preserve provenance across multiple sources. Batch writes where safe; isolate individual source failures. These values are configurable within validated bounds.

**Technical debt explicitly accepted:** generic-parser coverage gap for unsupported sources, more sophisticated entity-resolution tuning, verification of recurring series occurrences, optional AI classification, geocoding provider abstraction, host claiming imported events, and media licensing/rights integration. Do not add these outside V1 requirements.

## Alternatives considered

| Alternative | Decision | Rationale |
|---|---|---|
| Manual event entry | Rejected | Violates unattended raw collection requirement |
| AI-only web browsing agent | Rejected | Cost, hallucinated fields, hard-to-test output and weak reproducibility |
| Paid Firecrawl/proxies as default | Deferred | Avoids unnecessary vendor dependency and usage charges |
| Separate Python service | Rejected for V1 | Duplicate tooling and deployment relative to TypeScript stack |
| Vercel Cron for full scraping | Rejected | Browser execution and request runtime constraints |
| Supabase Edge Functions for all scraping | Rejected | Less suitable for multi-site headless browsing workload |
| Publish everything from new sources | Rejected | Poor quality and ownership risk |
| Create a synthetic organization for scraped events | Rejected | Required real `owner_id`; misrepresents organizer identity |

## External / infrastructure changes

### GitHub Actions

Create `.github/workflows/ingestion-daily.yml` at `15 9 * * *` UTC and `.github/workflows/ingestion-discovery.yml` at `15 10 * * 0` UTC. Run against default-branch trusted code with `contents: read`, serialized concurrency groups, a 60-minute job timeout for the daily workflow (25-minute collection and 15-minute verification deadlines) and 30 minutes for discovery, Node 22 and `npm ci`. Install Playwright Chromium for collection only. `workflow_dispatch` permits authorized manual reruns. Schedules can be late; monitor last run. UTC means the Eastern wall-clock run hour changes during daylight saving.

### GitHub secrets and environment

Use existing `NEXT_PUBLIC_SUPABASE_URL` (public URL) and `SUPABASE_SERVICE_ROLE_KEY` (**secret**) in trusted Actions environments. Never expose secrets to untrusted PR workflows, output logs or client bundles. Default publication remains `shadow` in workflow YAML until a reviewed live-mode change. Add validated configuration variables specified in the technical spec; no credentials are committed. GitHub Actions `GITHUB_TOKEN` needs `contents: read` only.

### Supabase

Apply **reviewed additive** migration creating private ingestion structures, provenance, indexes, RLS, restricted grants, and a `SECURITY DEFINER` publication function callable by `service_role` only. Production deployment requires explicit permission. For data access, choose one documented mechanism: (a) expose `ingestion` to Supabase Data API with **no** anon/authenticated grants and use `.schema('ingestion')` from service-role only, or (b) use a direct PostgreSQL backend connection. The implementation plan selects (a) for V1 and requires verifying schema exposure at deployment. Regenerate `lib/database.types.ts` through the existing project script after applying a local migration; never hand-edit types.

### Vercel, IAM and services

No new Vercel cron, AWS IAM role, scraping proxy or paid discovery provider is required. Existing Vercel server-side admin infrastructure is reused. A compliant existing geocoder must be verified; if none is available, unresolved event locations remain review-only and live publication is blocked until configured. External website access/robots conditions must be assessed per source.

## Security model

- Worker holds secret credentials only server-side; ingestion schema has RLS and grants no anonymous or authenticated table access.
- Every admin API checks both a real Supabase session and `public.app_admins`; no elevated client is created before the check.
- `ingestion.publish_candidate` is `SECURITY DEFINER`, has an empty search path, schema-qualified objects and service-role-only EXECUTE; transaction locks protect canonical identity across candidates.
- All URL fetches use bounded redirects, allowed protocols, IP/DNS/connection controls against SSRF and DNS rebinding, request size and timeout constraints, and permissions-aware crawling.
- Audit every publish, review, blocked publish and safe ownership change. Never trust HTML, extraction results or model classifications as authority for production permissions.

## Deployment, rollback and success

**Release sequence:** static audit → local additive migration → offline adapters/tests → isolated staging integration → shadow deployment → three distinct daily shadow runs and review sample → explicit trust promotion → explicit live authorization. The Agent must never infer approval from passing CI.

**Rollback:** disable schedules; restore `shadow`; stop publisher; preserve `public.events`, provenance and audit. Do not drop ingestion tables or cascade-delete existing events as part of ordinary rollback.

**Done:** daily autonomous collection, weekly bounded source discovery, normalized evidence-based candidates, hard-gate validation, cross-source/production deduplication, safe reviewed publication, admin exception queue, map visibility, ownership protection, reproducible tests, run metrics, and a documented manual activation gate.
