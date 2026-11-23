# Automated Event Ingestion - Runbook

Publication stays in shadow mode (`INGESTION_PUBLISH_MODE=shadow`) until the launch checklist is signed off. Never put real secrets in this document.

## Shadow mode, precisely
- Automatic workers (`ingest:daily`, `ingest:replay`, `ingest:verify`) never write to `public.events` in shadow mode. They record would-be publications in `ingestion.publication_audit` (`shadow_approved`).
- An administrator may still publish a reviewed candidate manually in shadow mode (ADR section 6/7). That is a deliberate human action and DOES create a public event. Count automatic writes and manual publishes separately in the shadow results.
- Live automatic publication requires `INGESTION_PUBLISH_MODE=live`, which needs explicit owner approval and is not part of this work.

## Commands
| Purpose | Command |
|---------|---------|
| Daily run | `npm run ingest:daily` |
| Discovery | `npm run ingest:discover` |
| Seed sources | `npm run ingest:seed` |
| Replay stored observations (offline, never publishes) | `npm run ingest:replay` |
| Verify (missed runs, stale sources, owned events) | `npm run ingest:verify` |
| Retention (dry run by default) | `npm run ingest:retain`; delete with `npm run ingest:retain -- --apply` |
| Ingestion tests (serial; required with the SQL suites) | `npm run test:ingestion` |
| SQL harness (substitute DB) | `$env:INGESTION_PG_TOOLS_DIR="<tools>"; node tests/ingestion/db-harness/verify-sql.mjs` |
| Quality gate | `npm run lint; npx tsc --noEmit; npx jest --ci --runInBand; npm run build:ci` |

Baseline: 30 pre-existing tsc errors and 30 eslint errors in old `__tests__`; judge changes by "no new errors". Always use `--runInBand` when the SQL env var is set; parallel embedded PostgreSQL instances contend and produce false failures.

## Schedules
- GitHub only runs `schedule` workflows from the default branch. Merging to `main` is what starts them; until then only `workflow_dispatch` works.
- Cron is UTC and not DST aware. Daily 09:15 UTC is 05:15 EDT in summer and 04:15 EST in winter. Discovery runs Sundays 10:15 UTC.
- The daily workflow runs `ingest:verify` after collection even when collection fails (`if: !cancelled()`). Collection and verification have separate budgets: collection deadline 25 min (step timeout 30), verification deadline 15 min (step timeout 20), job timeout 60. A collection timeout does not consume verification time.
- `ingest:verify` exit codes: `succeeded` 0, `partial` 0 (warnings only, shown as workflow annotations `ingest:verify <code>`), `skipped_overlap` 0 (warning annotation; another verify holds the lock), `failed` 1 (any error finding, including a missed deadline). `partial` and `skipped_overlap` do not fail the job, so read the annotations after any run that shows them.
- GitHub emails the workflow owner on scheduled-workflow failure only if notifications are enabled. Turn on failure notifications for the repository, and treat "no successful run recorded in 36 hours" (`missed_daily_run` finding) as an alert.
- GitHub disables scheduled workflows after 60 days without repository activity; re-enable them if needed.

## Procedures
- **Manual rerun:** trigger the `ingestion-daily` workflow (workflow_dispatch) or run `npm run ingest:daily` with an isolated environment. A second concurrent run is refused by the run lock; runs older than 90 minutes are abandoned.
- **Disable a source:** admin UI `/admin/ingestion/sources`, or set `enabled=false`. Restricted sources cannot be enabled.
- **Inspect run logs:** `/admin/ingestion/runs`, or `ingestion.runs` and its logs.
- **Review candidates:** `/admin/ingestion/candidates`. Request review, then approve/reject/edit. Approval never publishes; edits and rejections set `manual_override`.
- **Promote trust:** from the source page. Blocked for discovery-only, access-restricted or disabled sources.
- **Trust source coordinates (operator only):** the admin API cannot edit `configuration`. After reviewing a source whose JSON-LD `geo` is accurate, set `configuration.coordinateTrust = "verified"` directly in the database or in the seed definition. Without it, address-only events stay in review (no geocoder is configured).
- **Cancel / archive an imported event:** there is NO admin archive or cancel action. In shadow mode a source-reported cancellation is only counted (`updatesShadowed`, `cancellation_pending`). In live mode the worker archives it when the source states the cancellation explicitly. To remove a wrong event in the meantime, edit or delete it as an ordinary public event. Deleting leaves the candidate `published` with a null event pointer and an `event_deleted` audit row, so it is not re-created.
- **Disable schedules / live mode:** disable both workflows in GitHub Actions and keep `INGESTION_PUBLISH_MODE=shadow`.
- **Rotate credentials:** rotate the Supabase service key and GitHub secrets; update the secret store; rerun verify. Rotate the credentials in `.env.local` as they are production.
- **Roll back migrations:** the three ingestion migrations (`20261120000100`, `20261120000200`, `20261121000100`) only add objects under `ingestion`, `public.event_ingestion_links` and functions. Disable workflows first, then drop those objects in reverse order. Do NOT delete public events; keep them and review them by hand.
- **Partial failures:** rerun the daily job (idempotent, observation key is `source_id, source_url, content_hash`). Use replay to rebuild candidates from stored observations.
- **Retention:** raw payloads 90 days, runs 365 days. Always dry-run first. Evidence for live or reviewed candidates is kept.

## Verify findings
| Code | Meaning |
|------|---------|
| `missed_daily_run` | No successful daily collection in the last 36 hours (or ever) |
| `source_failing` / `source_stale` | Latest attempt failed / no success for 3 days |
| `recheck_failed` | A source with owned upcoming events could not be rechecked |
| `recheck_incomplete` | Warning: more than 1000 upcoming published candidates exist, so only the soonest 1000 were examined. Error: the 15-minute verification deadline passed before every source was rechecked |
| `recheck_skipped` | Warning: a collection run was in progress, so no source was rechecked (verify never runs alongside collection). Rerun verify after collection ends |
| `owned_event_not_seen` | A source stopped listing an owned event; it stays published (disappearance is not cancellation) |
| `cancellation_pending` | A cancellation or change was reported but shadow mode did not apply it |

## Known gaps
- Playwright rendering is disabled (not SSRF-safe); only fetch-based adapters run.
- No geocoder is configured.
- Real Supabase, PostGIS, PostgREST exposure, `public.events` triggers, source ToS and live selectors are unverified.
