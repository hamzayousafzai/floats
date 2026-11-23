# Automated Event Ingestion - Shadow Results

Status: PENDING OPERATIONAL EVIDENCE. No shadow run has been executed against a real environment. Nothing in this file is a result until an operator fills it in from real run output.

Automatic writes and admin manual publishes are counted separately. In shadow mode the automatic count must be zero; a manual publish is an allowed human action (ADR section 6/7).

| Day | Run id | Sources ok/failed | Candidates | Would-publish (`shadow_approved`) | Automatic writes to `public.events` (must be 0) | Admin manual publishes | `ingest:verify` findings | Notes |
|-----|--------|-------------------|-----------|-----------------------------------|--------------------------------------------------|------------------------|--------------------------|-------|
| 1 | - | - | - | - | - | - | - | BLOCKED: no authorized staging credentials |
| 2 | - | - | - | - | - | - | - | BLOCKED |
| 3 | - | - | - | - | - | - | - | BLOCKED |

Offline evidence only: fixture-based end-to-end tests show zero automatic writes in shadow mode, idempotent replay and stable map JSON. A no-env smoke run of the CLI exits 1 with a sanitized config error.
