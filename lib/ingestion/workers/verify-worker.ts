import { sanitizeForLog } from "@/lib/ingestion/log";
import type { IngestionClient } from "@/lib/ingestion/storage/client";
import { ingestionDb, throwIfError } from "@/lib/ingestion/storage/client";
import type { CandidateRow, RunRow, SourceRow } from "@/lib/ingestion/storage/rows";
import { RunInProgressError, abandonStaleRuns, createRun, finishRun, findActiveRun, getLastSuccessfulRun, getLatestFinishedRun } from "@/lib/ingestion/storage/runs";
import { getEnabledSources, getSourceById } from "@/lib/ingestion/storage/sources";
import type { RunType } from "@/lib/ingestion/types";
import { DEFAULT_STALE_RUN_MINUTES } from "./daily-collection";
import { type SourceRunDeps, type SourceRunReport, runSource } from "./source-runner";

/** A daily run is due every 24h; a day and a half without a successful one means a run was missed. */
export const DEFAULT_MISSED_RUN_HOURS = 36;
export const DEFAULT_SOURCE_STALE_DAYS = 3;
export const MAX_RECHECKED_EVENTS = 1000;
/** Stays under PostgREST's max_rows (1000 on Supabase). */
const PAGE_SIZE = 500;
/** Keeps `in (...)` filters within URL length limits. */
const ID_CHUNK = 100;
/** Verification has its own budget, separate from collection's 25 minutes; the workflow step timeouts are sized from both. */
export const DEFAULT_VERIFY_DEADLINE_MS = 15 * 60_000;

export interface VerificationDeps extends SourceRunDeps {
  runDeadlineMs?: number;
  staleRunMinutes?: number;
  missedRunHours?: number;
  sourceStaleDays?: number;
  log?: (message: string) => void;
}

export type FindingCode = "missed_daily_run" | "collection_partial" | "source_failing" | "source_stale" | "recheck_failed" | "owned_event_not_seen" | "cancellation_pending" | "recheck_incomplete" | "recheck_skipped";
export interface VerificationFinding {
  code: FindingCode;
  severity: "error" | "warning";
  message: string;
  sourceId?: string;
}

export type VerificationStatus = "succeeded" | "partial" | "failed" | "skipped_overlap";

export interface VerificationSummary {
  status: VerificationStatus;
  runId: string | null;
  publishMode: string;
  ownedUpcomingEvents: number;
  sourcesRechecked: number;
  /** Rechecks that actually completed; `sourcesRechecked` counts every attempt, including failures. */
  sourcesSucceeded: number;
  updatesApplied: number;
  archivesApplied: number;
  /** Changes or cancellations the source reported that shadow mode deliberately did not apply. */
  updatesShadowed: number;
  findings: VerificationFinding[];
}

function emptySummary(status: VerificationStatus, runId: string | null, publishMode: string, findings: VerificationFinding[] = []): VerificationSummary {
  return { status, runId, publishMode, ownedUpcomingEvents: 0, sourcesRechecked: 0, sourcesSucceeded: 0, updatesApplied: 0, archivesApplied: 0, updatesShadowed: 0, findings };
}

/**
 * Failure and freshness checks that need no network access.
 * Freshness: a `partial` collection counts as a daily run (at least one source completed), so it does not raise
 * `missed_daily_run`. Sources it skipped or failed surface through `source_failing` / `source_stale`, and the latest
 * partial run is itself reported as `collection_partial` so it is never silently green.
 */
export async function detectOperationalFindings(client: IngestionClient, now: Date, missedRunHours: number, sourceStaleDays: number): Promise<VerificationFinding[]> {
  const findings: VerificationFinding[] = [];
  const last = await getLastSuccessfulRun(client, "collection");
  const lastAt = last ? new Date(last.finished_at ?? last.started_at).getTime() : null;
  if (lastAt === null) {
    findings.push({ code: "missed_daily_run", severity: "error", message: "No successful daily collection run has been recorded" });
  } else if (now.getTime() - lastAt > missedRunHours * 3_600_000) {
    const hours = Math.floor((now.getTime() - lastAt) / 3_600_000);
    findings.push({ code: "missed_daily_run", severity: "error", message: `Last successful daily collection finished ${hours}h ago (limit ${missedRunHours}h)` });
  }

  const latest = await getLatestFinishedRun(client, "collection");
  if (latest?.status === "partial") {
    const detail = latest.error_summary ? `: ${latest.error_summary.slice(0, 200)}` : "";
    findings.push({ code: "collection_partial", severity: "warning", message: `The latest daily collection was partial (${latest.sources_succeeded} of ${latest.sources_attempted} attempted source(s) succeeded)${detail}` });
  }

  for (const source of await getEnabledSources(client)) {
    const attempt = source.last_attempt_at ? new Date(source.last_attempt_at).getTime() : null;
    const success = source.last_success_at ? new Date(source.last_success_at).getTime() : null;
    if (attempt !== null && (success === null || attempt > success)) {
      findings.push({ code: "source_failing", severity: "warning", sourceId: source.id, message: `${source.name}: the latest collection attempt failed` });
    } else if (success !== null && now.getTime() - success > sourceStaleDays * 86_400_000) {
      findings.push({ code: "source_stale", severity: "warning", sourceId: source.id, message: `${source.name}: no successful collection for over ${sourceStaleDays} days` });
    }
  }
  return findings;
}

const chunksOf = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

async function ownedCandidateIds(client: IngestionClient, candidateIds: string[]): Promise<Set<string>> {
  const owned = new Set<string>();
  for (const ids of chunksOf(candidateIds, ID_CHUNK)) {
    const { data, error } = await client.from("event_ingestion_links").select("candidate_id, management_state").in("candidate_id", ids).eq("management_state", "ingestion");
    if (error) throw new Error(`Failed to load ownership links: ${sanitizeForLog(error.message)}`);
    for (const link of (data ?? []) as { candidate_id: string }[]) owned.add(link.candidate_id);
  }
  return owned;
}

/**
 * Upcoming candidates ingestion published and still owns (not manually edited or claimed by an organizer), soonest first.
 * Candidates are read page by page because the API silently truncates any single response at `max_rows`; ownership is
 * applied per page so manual and claimed events never use up the 1000-event budget. One owned row beyond the budget is
 * enough to report `capped`, so `capped` means more exist, not merely that the limit was reached.
 */
async function listOwnedUpcoming(client: IngestionClient, now: Date): Promise<{ owned: CandidateRow[]; capped: boolean }> {
  const owned: CandidateRow[] = [];
  let from = 0;
  while (owned.length <= MAX_RECHECKED_EVENTS) {
    const { data, error } = await ingestionDb(client)
      .from("candidates")
      .select("*")
      .eq("status", "published")
      .not("published_event_id", "is", null)
      .gte("starts_at", now.toISOString())
      .order("starts_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    throwIfError("Failed to load published candidates", error);
    const page = (data ?? []) as CandidateRow[];
    // An empty page ends the scan; a short page does not, because the server may cap pages below PAGE_SIZE.
    if (page.length === 0) break;
    from += page.length;
    const ownedIds = await ownedCandidateIds(client, page.map((c) => c.id));
    owned.push(...page.filter((c) => ownedIds.has(c.id)));
  }
  return { owned: owned.slice(0, MAX_RECHECKED_EVENTS), capped: owned.length > MAX_RECHECKED_EVENTS };
}

/**
 * The lock is held by another run (any pipeline run type shares it). Verification then does only its read-only checks
 * so a hung or long collection can still raise `missed_daily_run`, and reports that no source was rechecked.
 */
async function withoutLock(deps: VerificationDeps, now: Date, holder: RunType | null): Promise<VerificationSummary> {
  const { client, config } = deps;
  if (holder === "verification") return emptySummary("skipped_overlap", null, config.publishMode);
  const findings = await detectOperationalFindings(client, now, deps.missedRunHours ?? DEFAULT_MISSED_RUN_HOURS, deps.sourceStaleDays ?? DEFAULT_SOURCE_STALE_DAYS);
  findings.push({ code: "recheck_skipped", severity: "warning", message: `${holder ? `A ${holder}` : "Another ingestion"} run is in progress; operational checks ran but no source was rechecked` });
  return emptySummary(findings.some((f) => f.severity === "error") ? "failed" : "partial", null, config.publishMode, findings);
}

/**
 * Operational verification. Reports a missed daily run and failing/stale sources, then re-collects every source that
 * owns upcoming ingestion-published events so source changes and explicit cancellations go through the same guarded
 * update path as collection (live mode only; shadow mode counts them). A source that stops listing an event is
 * reported, never treated as a cancellation.
 */
export async function runVerification(deps: VerificationDeps): Promise<VerificationSummary> {
  const { client, config } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const log = deps.log ?? (() => undefined);
  const staleMinutes = deps.staleRunMinutes ?? DEFAULT_STALE_RUN_MINUTES;

  await abandonStaleRuns(client, "verification", staleMinutes, now);
  const active = await findActiveRun(client, "verification", staleMinutes, now);
  if (active) return withoutLock(deps, now, active.run_type);
  let run: RunRow;
  try {
    run = await createRun(client, "verification", { publishMode: config.publishMode });
  } catch (error) {
    if (error instanceof RunInProgressError) return withoutLock(deps, now, (await findActiveRun(client, "verification", staleMinutes, now))?.run_type ?? null);
    throw error;
  }

  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), deps.runDeadlineMs ?? DEFAULT_VERIFY_DEADLINE_MS);
  const summary = emptySummary("succeeded", run.id, config.publishMode);
  try {
    summary.findings.push(...(await detectOperationalFindings(client, now, deps.missedRunHours ?? DEFAULT_MISSED_RUN_HOURS, deps.sourceStaleDays ?? DEFAULT_SOURCE_STALE_DAYS)));

    const { owned, capped } = await listOwnedUpcoming(client, now);
    if (capped) {
      summary.findings.push({ code: "recheck_incomplete", severity: "warning", message: `More than ${MAX_RECHECKED_EVENTS} published upcoming candidates exist; only the soonest ${MAX_RECHECKED_EVENTS} were examined for recheck` });
    }
    summary.ownedUpcomingEvents = owned.length;
    const bySource = new Map<string, CandidateRow[]>();
    for (const candidate of owned) bySource.set(candidate.primary_source_id, [...(bySource.get(candidate.primary_source_id) ?? []), candidate]);

    for (const [sourceId, candidates] of bySource) {
      if (deadline.signal.aborted) {
        summary.findings.push({ code: "recheck_incomplete", severity: "error", message: "The run deadline passed before every source with owned upcoming events was rechecked" });
        break;
      }
      const source: SourceRow | null = await getSourceById(client, sourceId);
      if (!source || !source.enabled || source.trust_state === "disabled") {
        summary.findings.push({ code: "recheck_failed", severity: "warning", sourceId, message: `${source?.name ?? sourceId}: source is disabled; ${candidates.length} owned upcoming event(s) not rechecked` });
        continue;
      }
      const startedWall = new Date().toISOString();
      let report: SourceRunReport;
      try {
        report = await runSource(deps, source, run.id, deadline.signal);
      } catch (error) {
        summary.findings.push({ code: "recheck_failed", severity: "error", sourceId, message: `${source.name}: ${sanitizeForLog(error)}` });
        continue;
      }
      summary.sourcesRechecked += 1;
      summary.updatesApplied += report.updatesApplied;
      summary.archivesApplied += report.archivesApplied;
      summary.updatesShadowed += report.updatesShadowed;
      log(`[ingest:verify] ${source.name} ${report.status} owned=${candidates.length}`);
      if (report.status === "failed") {
        summary.findings.push({ code: "recheck_failed", severity: "warning", sourceId, message: `${source.name}: ${report.failureKind ?? "failed"}: ${report.error ?? ""}`.trim() });
        continue;
      }
      summary.sourcesSucceeded += 1;
      if (report.updatesShadowed > 0) {
        summary.findings.push({ code: "cancellation_pending", severity: "warning", sourceId, message: `${source.name}: ${report.updatesShadowed} source change(s) or cancellation(s) not applied in shadow mode` });
      }
      const refreshed: { id: string; title: string; last_seen_at: string }[] = [];
      for (const ids of chunksOf(candidates.map((c) => c.id), ID_CHUNK)) {
        const { data, error } = await ingestionDb(client).from("candidates").select("id, title, last_seen_at").in("id", ids);
        throwIfError("Failed to reload candidates", error);
        refreshed.push(...((data ?? []) as { id: string; title: string; last_seen_at: string }[]));
      }
      for (const c of refreshed) {
        if (c.last_seen_at < startedWall) {
          summary.findings.push({ code: "owned_event_not_seen", severity: "warning", sourceId, message: `${source.name}: "${c.title.slice(0, 80)}" was not listed by its source; left published (disappearance is not cancellation)` });
        }
      }
    }

    const hasError = summary.findings.some((f) => f.severity === "error");
    summary.status = hasError ? "failed" : summary.findings.length > 0 ? "partial" : "succeeded";
    await finishRun(client, run.id, {
      status: summary.status,
      sourcesAttempted: summary.sourcesRechecked,
      sourcesSucceeded: summary.sourcesSucceeded,
      errorSummary: summary.findings.length > 0 ? summary.findings.map((f) => `${f.code}: ${f.message}`).join("; ").slice(0, 1000) : null,
      metadata: {
        publishMode: config.publishMode,
        ownedUpcomingEvents: summary.ownedUpcomingEvents,
        updatesApplied: summary.updatesApplied,
        archivesApplied: summary.archivesApplied,
        updatesShadowed: summary.updatesShadowed,
        findings: summary.findings.slice(0, 50),
      },
    });
    return summary;
  } catch (error) {
    try {
      await finishRun(client, run.id, { status: "failed", errorSummary: `Fatal: ${sanitizeForLog(error)}` });
    } catch {
      // The stale-run sweep closes it on the next start.
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
