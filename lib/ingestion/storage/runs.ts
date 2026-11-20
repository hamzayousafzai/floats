import { sanitizeForLog } from "@/lib/ingestion/log";
import type { RunType } from "@/lib/ingestion/types";
import { type IngestionClient, UNIQUE_VIOLATION, ingestionDb, throwIfError } from "./client";
import type { RunRow, RunStatus } from "./rows";

/** Another run of the same type is already in progress (enforced by a partial unique index). */
export class RunInProgressError extends Error {
  constructor(runType: RunType) {
    super(`A ${runType} run is already in progress`);
    this.name = "RunInProgressError";
  }
}

export async function createRun(
  client: IngestionClient,
  runType: RunType,
  metadata: Record<string, unknown> = {},
): Promise<RunRow> {
  const { data, error } = await ingestionDb(client)
    .from("runs")
    .insert({ run_type: runType, status: "running", metadata })
    .select("*")
    .single();
  if (error?.code === UNIQUE_VIOLATION) throw new RunInProgressError(runType);
  throwIfError("Failed to create run", error);
  return data as RunRow;
}

/**
 * Closes `running` runs older than the staleness window (a crashed or killed worker) as failed so they cannot hold the
 * run lock forever. Returns how many were closed.
 */
export async function abandonStaleRuns(client: IngestionClient, runType: RunType, staleAfterMinutes: number, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - staleAfterMinutes * 60_000).toISOString();
  const { data, error } = await ingestionDb(client)
    .from("runs")
    .update({ status: "failed", finished_at: now.toISOString(), error_summary: "Run abandoned: no completion recorded within the staleness window" })
    .eq("run_type", runType)
    .eq("status", "running")
    .lt("started_at", cutoff)
    .select("id");
  throwIfError("Failed to close stale runs", error);
  return (data ?? []).length;
}

export interface RunSummary {
  status: Exclude<RunStatus, "running">;
  sourcesAttempted?: number;
  sourcesSucceeded?: number;
  observationsFound?: number;
  candidatesCreated?: number;
  candidatesPublished?: number;
  candidatesReview?: number;
  errorSummary?: string | null;
  metadata?: Record<string, unknown>;
}

/** Closes a run. The error summary is sanitised here so no caller can persist a credential. */
export async function finishRun(client: IngestionClient, runId: string, summary: RunSummary): Promise<RunRow> {
  const patch: Record<string, unknown> = {
    status: summary.status,
    finished_at: new Date().toISOString(),
    error_summary: summary.errorSummary ? sanitizeForLog(summary.errorSummary) : null,
  };
  if (summary.sourcesAttempted !== undefined) patch.sources_attempted = summary.sourcesAttempted;
  if (summary.sourcesSucceeded !== undefined) patch.sources_succeeded = summary.sourcesSucceeded;
  if (summary.observationsFound !== undefined) patch.observations_found = summary.observationsFound;
  if (summary.candidatesCreated !== undefined) patch.candidates_created = summary.candidatesCreated;
  if (summary.candidatesPublished !== undefined) patch.candidates_published = summary.candidatesPublished;
  if (summary.candidatesReview !== undefined) patch.candidates_review = summary.candidatesReview;
  if (summary.metadata !== undefined) patch.metadata = summary.metadata;
  const { data, error } = await ingestionDb(client).from("runs").update(patch).eq("id", runId).select("*").single();
  throwIfError("Failed to finish run", error);
  return data as RunRow;
}

/** Returns a run of this type that is still `running` and started within the staleness window. */
export async function findActiveRun(client: IngestionClient, runType: RunType, staleAfterMinutes: number, now: Date = new Date()): Promise<RunRow | null> {
  const since = new Date(now.getTime() - staleAfterMinutes * 60_000).toISOString();
  const { data, error } = await ingestionDb(client)
    .from("runs")
    .select("*")
    .eq("run_type", runType)
    .eq("status", "running")
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(1);
  throwIfError("Failed to check active runs", error);
  const rows = (data ?? []) as RunRow[];
  return rows[0] ?? null;
}

export async function listRuns(client: IngestionClient, limit: number): Promise<RunRow[]> {
  const bounded = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const { data, error } = await ingestionDb(client).from("runs").select("*").order("started_at", { ascending: false }).limit(bounded);
  throwIfError("Failed to list runs", error);
  return (data ?? []) as RunRow[];
}

export async function getLastSuccessfulRun(client: IngestionClient, runType: RunType): Promise<RunRow | null> {
  const { data, error } = await ingestionDb(client)
    .from("runs")
    .select("*")
    .eq("run_type", runType)
    .in("status", ["succeeded", "partial"])
    .order("started_at", { ascending: false })
    .limit(1);
  throwIfError("Failed to load last run", error);
  return ((data ?? []) as RunRow[])[0] ?? null;
}
