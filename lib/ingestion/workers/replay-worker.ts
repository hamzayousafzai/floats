import { sanitizeForLog } from "@/lib/ingestion/log";
import { processRawEvent } from "@/lib/ingestion/process-candidate";
import type { IngestionClient } from "@/lib/ingestion/storage/client";
import { ingestionDb, throwIfError } from "@/lib/ingestion/storage/client";
import type { ObservationRow, RunRow, SourceRow } from "@/lib/ingestion/storage/rows";
import { RunInProgressError, abandonStaleRuns, createRun, finishRun, findActiveRun } from "@/lib/ingestion/storage/runs";
import { getSourceById } from "@/lib/ingestion/storage/sources";
import type { RawEvent, SourceCoordinates } from "@/lib/ingestion/types";
import type { GeocodeResult } from "@/lib/ingestion/validation/geocode";
import { DEFAULT_STALE_RUN_MINUTES } from "./daily-collection";
import type { SourceRunConfig } from "./source-runner";

export const DEFAULT_REPLAY_LIMIT = 1000;
export const MAX_REPLAY_LIMIT = 5000;
const BATCH = 200;

export interface ReplayDeps {
  client: IngestionClient;
  config: SourceRunConfig;
  geocode?: (address: string) => Promise<GeocodeResult | null>;
  now?: () => Date;
  staleRunMinutes?: number;
  log?: (message: string) => void;
}

export interface ReplayOptions {
  sourceId?: string;
  /** Replay only the observations a given collection run produced. */
  runId?: string;
  /** Inclusive lower bound on `observed_at` (ISO). */
  since?: string;
  limit?: number;
}

export type ReplayStatus = "succeeded" | "partial" | "failed" | "skipped_overlap";

export interface ReplaySummary {
  status: ReplayStatus;
  runId: string | null;
  observationsReplayed: number;
  candidatesCreated: number;
  /** Candidates that already existed; replay found them again instead of creating another. */
  candidatesMatched: number;
  /** Approved, published or manually overridden candidates, left untouched. */
  candidatesPreserved: number;
  candidatesReview: number;
  invalid: number;
  malformed: number;
  sourcesMissing: number;
  processingErrors: number;
  errorSummary: string | null;
}

function emptySummary(status: ReplayStatus, runId: string | null, errorSummary: string | null): ReplaySummary {
  return {
    status, runId, observationsReplayed: 0, candidatesCreated: 0, candidatesMatched: 0, candidatesPreserved: 0, candidatesReview: 0,
    invalid: 0, malformed: 0, sourcesMissing: 0, processingErrors: 0, errorSummary,
  };
}

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

function coordinatesFrom(value: unknown): SourceCoordinates | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const c = value as Record<string, unknown>;
  if (c.origin !== "jsonld-place-geo" || typeof c.latitude !== "number" || typeof c.longitude !== "number") return null;
  return { latitude: c.latitude, longitude: c.longitude, origin: "jsonld-place-geo" };
}

/**
 * Rebuilds the adapter's RawEvent from a stored observation. The row's own source and URL are authoritative; a payload
 * that is not an object cannot be replayed and yields null.
 */
export function rawEventFromObservation(observation: Pick<ObservationRow, "source_id" | "source_url" | "external_event_id" | "raw_payload">): RawEvent | null {
  const p = observation.raw_payload;
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const record = p as Record<string, unknown>;
  const rawPayload = record.rawPayload && typeof record.rawPayload === "object" && !Array.isArray(record.rawPayload) ? (record.rawPayload as Record<string, unknown>) : {};
  return {
    sourceId: observation.source_id,
    externalEventId: observation.external_event_id ?? text(record.externalEventId),
    sourceUrl: observation.source_url,
    title: text(record.title),
    description: text(record.description),
    startsAt: text(record.startsAt),
    endsAt: text(record.endsAt),
    organizerName: text(record.organizerName),
    venueName: text(record.venueName),
    address: text(record.address),
    coordinates: coordinatesFrom(record.coordinates),
    vendorCount: typeof record.vendorCount === "number" && Number.isFinite(record.vendorCount) ? record.vendorCount : null,
    evidence: strings(record.evidence),
    categories: strings(record.categories),
    cancelled: record.cancelled === true,
    rawPayload,
  };
}

async function loadBatch(client: IngestionClient, options: ReplayOptions, cursor: string | null, size: number): Promise<ObservationRow[]> {
  let query = ingestionDb(client).from("observations").select("*");
  if (options.sourceId) query = query.eq("source_id", options.sourceId);
  if (options.runId) query = query.eq("run_id", options.runId);
  if (options.since) query = query.gte("observed_at", options.since);
  if (cursor) query = query.gt("id", cursor);
  const { data, error } = await query.order("id", { ascending: true }).limit(size);
  throwIfError("Failed to load observations", error);
  return (data ?? []) as ObservationRow[];
}

/**
 * Re-runs stored observations through the same normalization, validation and deduplication as collection, without any
 * network access. It never publishes and never updates or archives imported events: it can only create or refresh
 * candidates, which are keyed by canonical identity, so replaying twice creates nothing new. Approved, published and
 * manually overridden candidates keep their status and fields (the observation is only re-linked as evidence).
 */
export async function runReplay(deps: ReplayDeps, options: ReplayOptions = {}): Promise<ReplaySummary> {
  const { client } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const log = deps.log ?? (() => undefined);
  const staleMinutes = deps.staleRunMinutes ?? DEFAULT_STALE_RUN_MINUTES;
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? DEFAULT_REPLAY_LIMIT), 1), MAX_REPLAY_LIMIT);

  await abandonStaleRuns(client, "replay", staleMinutes, now);
  if (await findActiveRun(client, "replay", staleMinutes, now)) return emptySummary("skipped_overlap", null, "A replay run is already in progress");
  let run: RunRow;
  try {
    run = await createRun(client, "replay", { sourceId: options.sourceId ?? null, runId: options.runId ?? null, since: options.since ?? null, limit });
  } catch (error) {
    if (error instanceof RunInProgressError) return emptySummary("skipped_overlap", null, error.message);
    throw error;
  }

  const summary = emptySummary("succeeded", run.id, null);
  const sources = new Map<string, SourceRow | null>();
  try {
    let cursor: string | null = null;
    let remaining = limit;
    let firstError: string | null = null;
    while (remaining > 0) {
      const batch = await loadBatch(client, options, cursor, Math.min(BATCH, remaining));
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1].id;
      remaining -= batch.length;

      for (const observation of batch) {
        const raw = rawEventFromObservation(observation);
        if (!raw) {
          summary.malformed += 1;
          continue;
        }
        if (!sources.has(observation.source_id)) sources.set(observation.source_id, await getSourceById(client, observation.source_id));
        const source = sources.get(observation.source_id);
        if (!source) {
          summary.sourcesMissing += 1;
          continue;
        }
        try {
          const result = await processRawEvent({ client, config: deps.config, source, observationId: observation.id, geocode: deps.geocode, now: deps.now }, raw);
          summary.observationsReplayed += 1;
          if (result.kind === "invalid") {
            summary.invalid += 1;
            continue;
          }
          if (result.created) summary.candidatesCreated += 1;
          else summary.candidatesMatched += 1;
          if (result.preserved) summary.candidatesPreserved += 1;
          if (result.candidate.status === "needs_review" && (result.created || result.reopened)) summary.candidatesReview += 1;
        } catch (error) {
          summary.processingErrors += 1;
          firstError ??= sanitizeForLog(error);
        }
      }
      if (batch.length < BATCH) break;
    }

    if (summary.processingErrors > 0) {
      summary.status = summary.observationsReplayed > 0 ? "partial" : "failed";
      summary.errorSummary = `${summary.processingErrors} observation(s) failed to process: ${firstError}`.slice(0, 1000);
    }
    log(`[ingest:replay] replayed=${summary.observationsReplayed} created=${summary.candidatesCreated} preserved=${summary.candidatesPreserved}`);
    await finishRun(client, run.id, {
      status: summary.status === "skipped_overlap" ? "failed" : summary.status,
      observationsFound: summary.observationsReplayed,
      candidatesCreated: summary.candidatesCreated,
      candidatesReview: summary.candidatesReview,
      errorSummary: summary.errorSummary,
      metadata: { invalid: summary.invalid, malformed: summary.malformed, sourcesMissing: summary.sourcesMissing, preserved: summary.candidatesPreserved, matched: summary.candidatesMatched },
    });
    return summary;
  } catch (error) {
    try {
      await finishRun(client, run.id, { status: "failed", observationsFound: summary.observationsReplayed, errorSummary: `Fatal: ${sanitizeForLog(error)}` });
    } catch {
      // The stale-run sweep closes it on the next start.
    }
    throw error;
  }
}
