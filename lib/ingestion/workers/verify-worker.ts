import { sanitizeForLog } from "@/lib/ingestion/log";
import type { IngestionClient } from "@/lib/ingestion/storage/client";
import { ingestionDb, throwIfError } from "@/lib/ingestion/storage/client";
import type { CandidateRow, RunRow, SourceRow } from "@/lib/ingestion/storage/rows";
import { RunInProgressError, abandonStaleRuns, createRun, finishRun, findActiveRun, getLastSuccessfulRun } from "@/lib/ingestion/storage/runs";
import { getEnabledSources, getSourceById } from "@/lib/ingestion/storage/sources";
import { DEFAULT_RUN_DEADLINE_MS, DEFAULT_STALE_RUN_MINUTES } from "./daily-collection";
import { type SourceRunDeps, type SourceRunReport, runSource } from "./source-runner";

/** A daily run is due every 24h; a day and a half without a successful one means a run was missed. */
export const DEFAULT_MISSED_RUN_HOURS = 36;
export const DEFAULT_SOURCE_STALE_DAYS = 3;
export const MAX_RECHECKED_EVENTS = 1000;

export interface VerificationDeps extends SourceRunDeps {
  runDeadlineMs?: number;
  staleRunMinutes?: number;
  missedRunHours?: number;
  sourceStaleDays?: number;
  log?: (message: string) => void;
}

export type FindingCode = "missed_daily_run" | "source_failing" | "source_stale" | "recheck_failed" | "owned_event_not_seen" | "cancellation_pending" | "recheck_incomplete";
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

/** Failure and freshness checks that need no network access. */
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

/** Upcoming candidates ingestion published and still owns (not manually edited or claimed by an organizer). */
async function listOwnedUpcoming(client: IngestionClient, now: Date): Promise<{ owned: CandidateRow[]; capped: boolean }> {
  const { data, error } = await ingestionDb(client)
    .from("candidates")
    .select("*")
    .eq("status", "published")
    .not("published_event_id", "is", null)
    .gte("starts_at", now.toISOString())
    .order("starts_at", { ascending: true })
    .limit(MAX_RECHECKED_EVENTS);
  throwIfError("Failed to load published candidates", error);
  const candidates = (data ?? []) as CandidateRow[];
  if (candidates.length === 0) return { owned: [], capped: false };

  const { data: links, error: linkError } = await client
    .from("event_ingestion_links")
    .select("candidate_id, management_state")
    .in("candidate_id", candidates.map((c) => c.id))
    .eq("management_state", "ingestion");
  if (linkError) throw new Error(`Failed to load ownership links: ${sanitizeForLog(linkError.message)}`);
  const owned = new Set(((links ?? []) as { candidate_id: string }[]).map((l) => l.candidate_id));
  return { owned: candidates.filter((c) => owned.has(c.id)), capped: candidates.length >= MAX_RECHECKED_EVENTS };
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
  if (await findActiveRun(client, "verification", staleMinutes, now)) {
    return emptySummary("skipped_overlap", null, config.publishMode);
  }
  let run: RunRow;
  try {
    run = await createRun(client, "verification", { publishMode: config.publishMode });
  } catch (error) {
    if (error instanceof RunInProgressError) return emptySummary("skipped_overlap", null, config.publishMode);
    throw error;
  }

  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), deps.runDeadlineMs ?? DEFAULT_RUN_DEADLINE_MS);
  const summary = emptySummary("succeeded", run.id, config.publishMode);
  try {
    summary.findings.push(...(await detectOperationalFindings(client, now, deps.missedRunHours ?? DEFAULT_MISSED_RUN_HOURS, deps.sourceStaleDays ?? DEFAULT_SOURCE_STALE_DAYS)));

    const { owned, capped } = await listOwnedUpcoming(client, now);
    if (capped) {
      summary.findings.push({ code: "recheck_incomplete", severity: "warning", message: `More than ${MAX_RECHECKED_EVENTS} published upcoming candidates exist; only the soonest ${MAX_RECHECKED_EVENTS} were considered for recheck` });
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
      const refreshed = await Promise.all(
        candidates.map(async (c) => {
          const { data, error } = await ingestionDb(client).from("candidates").select("id, title, last_seen_at").eq("id", c.id).maybeSingle();
          throwIfError("Failed to reload candidate", error);
          return data as { id: string; title: string; last_seen_at: string } | null;
        }),
      );
      for (const c of refreshed) {
        if (c && c.last_seen_at < startedWall) {
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
