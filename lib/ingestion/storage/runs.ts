import { sanitizeForLog } from "@/lib/ingestion/log";
import type { RunType } from "@/lib/ingestion/types";
import { type IngestionClient, UNIQUE_VIOLATION, ingestionDb, throwIfError } from "./client";
import type { RunRow, RunStatus } from "./rows";

/**
 * Runs that write observations, candidates and imported events share one lock (a partial unique index), so at most
 * one of them is `running`. Discovery only registers sources and keeps its own per-type lock.
 */
export const PIPELINE_RUN_TYPES: readonly RunType[] = ["collection", "verification", "replay"];
const lockGroup = (runType: RunType): readonly RunType[] => (PIPELINE_RUN_TYPES.includes(runType) ? PIPELINE_RUN_TYPES : [runType]);

/** Another run that holds the same lock is already in progress. */
export class RunInProgressError extends Error {
  constructor(runType: RunType) {
    super(PIPELINE_RUN_TYPES.includes(runType) ? `Another ingestion run (collection, verification or replay) is already in progress; cannot start ${runType}` : `A ${runType} run is already in progress`);
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
    .in("run_type", [...lockGroup(runType)])
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

/** Returns a run holding this type's lock (any pipeline type for a pipeline run) that is still `running` within the staleness window. */
export async function findActiveRun(client: IngestionClient, runType: RunType, staleAfterMinutes: number, now: Date = new Date()): Promise<RunRow | null> {
  const since = new Date(now.getTime() - staleAfterMinutes * 60_000).toISOString();
  const { data, error } = await ingestionDb(client)
    .from("runs")
    .select("*")
    .in("run_type", [...lockGroup(runType)])
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

/** The pipeline heartbeat: a `partial` run counts because at least one source completed; per-source freshness is tracked separately. */
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

/** The most recent run of this type that has finished (any outcome). */
export async function getLatestFinishedRun(client: IngestionClient, runType: RunType): Promise<RunRow | null> {
  const { data, error } = await ingestionDb(client)
    .from("runs")
    .select("*")
    .eq("run_type", runType)
    .in("status", ["succeeded", "partial", "failed"])
    .order("started_at", { ascending: false })
    .limit(1);
  throwIfError("Failed to load latest finished run", error);
  return ((data ?? []) as RunRow[])[0] ?? null;
}
