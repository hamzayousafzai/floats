import { sanitizeForLog } from "@/lib/ingestion/log";
import type { IngestionConfig } from "@/lib/ingestion/config";
import { RunInProgressError, abandonStaleRuns, createRun, finishRun, findActiveRun } from "@/lib/ingestion/storage/runs";
import type { RunRow, SourceRow } from "@/lib/ingestion/storage/rows";
import { getEnabledSources } from "@/lib/ingestion/storage/sources";
import { type SourceRunDeps, type SourceRunReport, runSource } from "./source-runner";

export const DEFAULT_RUN_DEADLINE_MS = 25 * 60_000;
/** Longer than the run deadline so a live run is never mistaken for an abandoned one. */
export const DEFAULT_STALE_RUN_MINUTES = 90;

export type DailyCollectionConfig = SourceRunDeps["config"] & Pick<IngestionConfig, "maxConcurrency">;

export interface DailyCollectionDeps extends Omit<SourceRunDeps, "config"> {
  config: DailyCollectionConfig;
  runDeadlineMs?: number;
  staleRunMinutes?: number;
  log?: (message: string) => void;
}

export type DailyRunStatus = "succeeded" | "partial" | "failed" | "skipped_overlap";

export interface DailyCollectionSummary {
  status: DailyRunStatus;
  runId: string | null;
  publishMode: string;
  sourcesAttempted: number;
  sourcesSucceeded: number;
  sourcesFailed: number;
  sourcesNotStarted: number;
  observationsFound: number;
  candidatesCreated: number;
  candidatesPublished: number;
  candidatesReview: number;
  shadowDecisions: number;
  updatesShadowed: number;
  errorSummary: string | null;
  sources: SourceRunReport[];
}

function emptySummary(status: DailyRunStatus, runId: string | null, publishMode: string, errorSummary: string | null): DailyCollectionSummary {
  return {
    status, runId, publishMode, sourcesAttempted: 0, sourcesSucceeded: 0, sourcesFailed: 0, sourcesNotStarted: 0, observationsFound: 0,
    candidatesCreated: 0, candidatesPublished: 0, candidatesReview: 0, shadowDecisions: 0, updatesShadowed: 0, errorSummary, sources: [],
  };
}

/** Bounded worker pool. Each task is isolated: a rejected task is converted to a report by `task` itself. */
async function runPool<T>(items: readonly T[], limit: number, signal: AbortSignal, task: (item: T) => Promise<void>): Promise<number> {
  let next = 0;
  let started = 0;
  const worker = async () => {
    while (!signal.aborted) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      started += 1;
      await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return started;
}

function failedReport(row: SourceRow, error: unknown): SourceRunReport {
  return {
    sourceId: row.id, name: row.name, status: "failed", failureKind: "processing_failed", error: sanitizeForLog(error), warning: null, attempts: 0,
    noEvents: false, truncated: false, eventsFound: 0, observationsNew: 0, observationsReused: 0, validEvents: 0, rejectedEvents: 0, invalidEvents: 0,
    processingErrors: 0, candidatesCreated: 0, candidatesReview: 0, published: 0, shadowDecisions: 0, publicationBlocked: 0, updatesApplied: 0,
    archivesApplied: 0, updatesShadowed: 0,
  };
}

function sum(reports: SourceRunReport[], pick: (r: SourceRunReport) => number): number {
  return reports.reduce((total, report) => total + pick(report), 0);
}

/**
 * The daily collection pipeline: lock -> enabled sources -> bounded concurrency -> per-source collect/process/publish ->
 * metrics -> run summary. A failed source never fails the others. The run is always finalized, including on a fatal
 * error (which is rethrown afterwards so the CLI exits nonzero). Shadow mode makes zero production writes.
 */
export async function runDailyCollection(deps: DailyCollectionDeps): Promise<DailyCollectionSummary> {
  const { client, config } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const log = deps.log ?? (() => undefined);
  const staleMinutes = deps.staleRunMinutes ?? DEFAULT_STALE_RUN_MINUTES;

  await abandonStaleRuns(client, "collection", staleMinutes, now);
  if (await findActiveRun(client, "collection", staleMinutes, now)) {
    return emptySummary("skipped_overlap", null, config.publishMode, "A collection run is already in progress");
  }
  let run: RunRow;
  try {
    run = await createRun(client, "collection", { publishMode: config.publishMode });
  } catch (error) {
    if (error instanceof RunInProgressError) return emptySummary("skipped_overlap", null, config.publishMode, error.message);
    throw error;
  }

  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), deps.runDeadlineMs ?? DEFAULT_RUN_DEADLINE_MS);
  const reports: SourceRunReport[] = [];
  let attemptedCount = 0;
  let sourceCount = 0;
  try {
    const sources = await getEnabledSources(client);
    sourceCount = sources.length;
    attemptedCount = await runPool(sources, config.maxConcurrency, deadline.signal, async (row) => {
      log(`[ingest:daily] source start: ${row.name}`);
      let report: SourceRunReport;
      try {
        report = await runSource({ ...deps, config }, row, run.id, deadline.signal);
      } catch (error) {
        report = failedReport(row, error);
      }
      reports.push(report);
      log(`[ingest:daily] source ${report.status}: ${row.name} events=${report.eventsFound}${report.error ? ` error=${report.error}` : ""}`);
    });

    const succeeded = reports.filter((r) => r.status === "succeeded").length;
    const failed = reports.length - succeeded;
    const notStarted = sourceCount - attemptedCount;
    const notes: string[] = [];
    if (sourceCount === 0) notes.push("No enabled collection sources");
    if (notStarted > 0) notes.push(`Run deadline reached; ${notStarted} source(s) not started`);
    for (const r of reports.filter((x) => x.status === "failed")) notes.push(`${r.name}: ${r.failureKind ?? "failed"}`);

    const status: Exclude<DailyRunStatus, "skipped_overlap"> =
      reports.length > 0 && failed === 0 && notStarted === 0 ? "succeeded" : succeeded > 0 ? "partial" : "failed";
    const summary: DailyCollectionSummary = {
      status,
      runId: run.id,
      publishMode: config.publishMode,
      sourcesAttempted: reports.length,
      sourcesSucceeded: succeeded,
      sourcesFailed: failed,
      sourcesNotStarted: notStarted,
      observationsFound: sum(reports, (r) => r.eventsFound),
      candidatesCreated: sum(reports, (r) => r.candidatesCreated),
      candidatesPublished: sum(reports, (r) => r.published),
      candidatesReview: sum(reports, (r) => r.candidatesReview),
      shadowDecisions: sum(reports, (r) => r.shadowDecisions),
      updatesShadowed: sum(reports, (r) => r.updatesShadowed),
      errorSummary: notes.length > 0 ? notes.join("; ").slice(0, 1000) : null,
      sources: reports,
    };
    await finishRun(client, run.id, {
      status,
      sourcesAttempted: summary.sourcesAttempted,
      sourcesSucceeded: summary.sourcesSucceeded,
      observationsFound: summary.observationsFound,
      candidatesCreated: summary.candidatesCreated,
      candidatesPublished: summary.candidatesPublished,
      candidatesReview: summary.candidatesReview,
      errorSummary: summary.errorSummary,
      metadata: {
        publishMode: config.publishMode,
        shadowDecisions: summary.shadowDecisions,
        updatesShadowed: summary.updatesShadowed,
        noEventSources: reports.filter((r) => r.noEvents).map((r) => r.name),
        sources: reports.map((r) => ({
          id: r.sourceId, name: r.name, status: r.status, failureKind: r.failureKind, attempts: r.attempts, events: r.eventsFound, noEvents: r.noEvents,
          valid: r.validEvents, rejected: r.rejectedEvents, created: r.candidatesCreated, review: r.candidatesReview, published: r.published,
          shadow: r.shadowDecisions, processingErrors: r.processingErrors, truncated: r.truncated, warning: r.warning, error: r.error,
        })),
      },
    });
    return summary;
  } catch (error) {
    // Fatal (for example the database became unreachable). Finalize best-effort so the run cannot stay `running`.
    try {
      await finishRun(client, run.id, {
        status: "failed",
        sourcesAttempted: reports.length,
        sourcesSucceeded: reports.filter((r) => r.status === "succeeded").length,
        errorSummary: `Fatal: ${sanitizeForLog(error)}`,
      });
    } catch {
      // The stale-run sweep on the next start closes it.
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
