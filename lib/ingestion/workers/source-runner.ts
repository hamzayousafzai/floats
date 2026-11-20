import type { AdapterRegistry } from "@/lib/ingestion/adapters/registry";
import type { CollectionContext, SourceDefinition } from "@/lib/ingestion/adapters/types";
import type { IngestionConfig } from "@/lib/ingestion/config";
import { sanitizeForLog } from "@/lib/ingestion/log";
import { processRawEvent } from "@/lib/ingestion/process-candidate";
import { type VerifiedChanges, planSourceChange } from "@/lib/ingestion/publication/ownership";
import { publishCandidate } from "@/lib/ingestion/publication/publish-candidate";
import { archiveCancelledEvent, updateImportedEvent } from "@/lib/ingestion/publication/update-imported-event";
import type { IngestionClient } from "@/lib/ingestion/storage/client";
import { saveObservation } from "@/lib/ingestion/storage/observations";
import type { CandidateRow, SourceRow } from "@/lib/ingestion/storage/rows";
import { updateSourceMetrics } from "@/lib/ingestion/storage/sources";
import type { CollectionResult, NormalizedEvent, RawEvent } from "@/lib/ingestion/types";
import type { GeocodeResult } from "@/lib/ingestion/validation/geocode";

/** Version of the adapter output shape stored with each observation (bump when RawEvent semantics change). */
export const PARSER_VERSION = "1";
export const MAX_EVENTS_PER_SOURCE = 500;
export const DEFAULT_SOURCE_TIMEOUT_MS = 5 * 60_000;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_RETRY_BASE_DELAY_MS = 1000;

export type SourceRunConfig = Pick<
  IngestionConfig,
  "centerLat" | "centerLng" | "radiusMiles" | "horizonDays" | "minVendorCount" | "autoPublishScore" | "reviewScore" | "publishMode"
>;

export interface SourceRunDeps {
  client: IngestionClient;
  config: SourceRunConfig;
  registry: Pick<AdapterRegistry, "resolve">;
  geocode?: (address: string) => Promise<GeocodeResult | null>;
  now?: () => Date;
  /** Injectable so tests never wait. */
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  sourceTimeoutMs?: number;
  maxEvents?: number;
}

export type FailureKind = "robots_denied" | "adapter_unavailable" | "transient_exhausted" | "source_error" | "aborted" | "processing_failed";

export interface SourceRunReport {
  sourceId: string;
  name: string;
  status: "succeeded" | "failed";
  failureKind: FailureKind | null;
  /** Sanitized, bounded error text. Never contains credentials. */
  error: string | null;
  /** Partial-parse warning carried by a successful result. */
  warning: string | null;
  attempts: number;
  /** The source was fetched and parsed correctly and listed no events. Distinct from a parser failure. */
  noEvents: boolean;
  truncated: boolean;
  eventsFound: number;
  observationsNew: number;
  observationsReused: number;
  validEvents: number;
  rejectedEvents: number;
  invalidEvents: number;
  processingErrors: number;
  candidatesCreated: number;
  candidatesReview: number;
  published: number;
  shadowDecisions: number;
  publicationBlocked: number;
  updatesApplied: number;
  archivesApplied: number;
  updatesShadowed: number;
}

const TRANSIENT_PATTERN = /timed out|timeout|network request failed|dns resolution failed|failed to read response|unexpected http status (?:5\d\d|429|408)|econnreset|econnrefused|etimedout|eai_again|socket hang up/i;
const ROBOTS_PATTERN = /robots\.txt/i;
const ABORT_PATTERN = /run aborted|run ended before|deadline reached/i;

type MessageKind = "robots" | "aborted" | "transient" | "permanent";

export function classifyFailureMessage(message: string): MessageKind {
  if (ROBOTS_PATTERN.test(message)) return "robots";
  if (ABORT_PATTERN.test(message)) return "aborted";
  if (TRANSIENT_PATTERN.test(message)) return "transient";
  return "permanent";
}

export function toSourceDefinition(row: SourceRow): SourceDefinition {
  return { id: row.id, name: row.name, baseUrl: row.base_url, adapter: row.adapter, crawlDelayMs: row.crawl_delay_ms, configuration: row.configuration ?? {} };
}

function emptyReport(row: SourceRow): SourceRunReport {
  return {
    sourceId: row.id,
    name: row.name,
    status: "succeeded",
    failureKind: null,
    error: null,
    warning: null,
    attempts: 0,
    noEvents: false,
    truncated: false,
    eventsFound: 0,
    observationsNew: 0,
    observationsReused: 0,
    validEvents: 0,
    rejectedEvents: 0,
    invalidEvents: 0,
    processingErrors: 0,
    candidatesCreated: 0,
    candidatesReview: 0,
    published: 0,
    shadowDecisions: 0,
    publicationBlocked: 0,
    updatesApplied: 0,
    archivesApplied: 0,
    updatesShadowed: 0,
  };
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs one adapter attempt with a hard deadline, even when the adapter ignores the abort signal. */
async function collectOnce(deps: SourceRunDeps, definition: SourceDefinition, runId: string, parent: AbortSignal): Promise<CollectionResult> {
  if (parent.aborted) throw new Error("Run aborted");
  const adapter = deps.registry.resolve(definition);
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  parent.addEventListener("abort", onParentAbort, { once: true });
  const timeoutMs = deps.sourceTimeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const context: CollectionContext = { runId, now: (deps.now ?? (() => new Date()))(), horizonDays: deps.config.horizonDays, signal: controller.signal };
  let rejectAborted: (reason: Error) => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => {
    rejectAborted = reject;
  });
  const onAbort = () => rejectAborted(new Error(parent.aborted ? "Run aborted" : "Source collection timed out"));
  controller.signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([adapter.collect(definition, context), aborted]);
  } finally {
    clearTimeout(timer);
    parent.removeEventListener("abort", onParentAbort);
    controller.signal.removeEventListener("abort", onAbort);
  }
}

interface CollectOutcome {
  result: CollectionResult | null;
  attempts: number;
  failureKind: FailureKind | null;
  error: string | null;
}

/** Retries transient failures only (timeouts, network errors, HTTP 5xx/429). Robots denials and parser failures are final. */
async function collectWithRetry(deps: SourceRunDeps, definition: SourceDefinition, runId: string, signal: AbortSignal): Promise<CollectOutcome> {
  const maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelay = deps.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const sleep = deps.sleep ?? defaultSleep;
  let attempts = 0;
  for (;;) {
    attempts += 1;
    let message: string;
    try {
      const result = await collectOnce(deps, definition, runId, signal);
      if (result.success) return { result, attempts, failureKind: null, error: null };
      message = result.error ?? "Source collection failed";
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
      if (error instanceof Error && error.name === "UnknownAdapterError") {
        return { result: null, attempts, failureKind: "adapter_unavailable", error: message };
      }
    }
    const kind = classifyFailureMessage(message);
    if (kind === "robots") return { result: null, attempts, failureKind: "robots_denied", error: message };
    if (kind === "aborted") return { result: null, attempts, failureKind: "aborted", error: message };
    if (kind === "permanent") return { result: null, attempts, failureKind: "source_error", error: message };
    if (attempts > maxRetries || signal.aborted) return { result: null, attempts, failureKind: "transient_exhausted", error: message };
    await sleep(baseDelay * 2 ** (attempts - 1));
  }
}

const CANCELLATION_SENTENCE = /[^.!?\n]*\b(?:cancell?ed|postponed|called[\s-]+off)\b[^.!?\n]*/i;

/** Quotes the source's own cancellation wording. Falls back to the title only when the status itself was structured. */
export function cancellationEvidence(raw: RawEvent): string {
  const text = `${raw.title ?? ""}. ${raw.description ?? ""}`;
  const match = CANCELLATION_SENTENCE.exec(text);
  if (match && match[0].trim().length >= 10) return match[0].trim().slice(0, 1000);
  return `Source lists "${(raw.title ?? "event").slice(0, 200)}" with a cancelled status`;
}

const sameInstant = (a: string | null, b: string | null): boolean => (a === null || b === null ? a === b : new Date(a).getTime() === new Date(b).getTime());

/** Verified differences between what ingestion stored for the event and what the source says now. Never fabricates fields. */
export function diffVerifiedChanges(stored: Pick<CandidateRow, "title" | "description" | "starts_at" | "ends_at" | "address">, event: NormalizedEvent): VerifiedChanges {
  const changes: VerifiedChanges = {};
  if (event.title && event.title !== stored.title) changes.title = event.title;
  if (event.description && event.description !== stored.description) changes.description = event.description;
  if (event.startsAt && !sameInstant(event.startsAt, stored.starts_at)) changes.startsAt = event.startsAt;
  if (event.endsAt && !sameInstant(event.endsAt, stored.ends_at)) changes.endsAt = event.endsAt;
  // An address only changes together with coordinates for it; a bare address would leave the map pin wrong.
  if (event.address && event.address !== stored.address && event.latitude !== null && event.longitude !== null) {
    changes.address = event.address;
    changes.latitude = event.latitude;
    changes.longitude = event.longitude;
  }
  return changes;
}

async function handleImportedChange(deps: SourceRunDeps, report: SourceRunReport, candidate: CandidateRow, raw: RawEvent, event: NormalizedEvent, cancelled: boolean): Promise<void> {
  if (!candidate.published_event_id) return;
  const plan = planSourceChange({
    fetchOutcome: "ok",
    eventPresent: true,
    cancelled,
    cancellationText: cancelled ? cancellationEvidence(raw) : null,
    changes: diffVerifiedChanges(candidate, event),
  });
  if (plan.action === "none") return;
  // Shadow mode never writes to production, including updates of events ingestion published earlier.
  if (deps.config.publishMode !== "live") {
    report.updatesShadowed += 1;
    return;
  }
  const target = { client: deps.client, config: deps.config };
  if (plan.action === "archive") {
    const result = await archiveCancelledEvent(target, candidate.published_event_id, plan.evidence);
    if (result.changed) report.archivesApplied += 1;
  } else {
    const result = await updateImportedEvent(target, candidate.published_event_id, plan.changes);
    if (result.changed) report.updatesApplied += 1;
  }
}

async function processEvent(deps: SourceRunDeps, row: SourceRow, runId: string, raw: RawEvent, report: SourceRunReport): Promise<void> {
  const { observation, created } = await saveObservation(deps.client, {
    sourceId: row.id,
    runId,
    externalEventId: raw.externalEventId,
    sourceUrl: raw.sourceUrl,
    rawPayload: JSON.parse(JSON.stringify(raw)) as Record<string, unknown>,
    parserVersion: PARSER_VERSION,
  });
  if (created) report.observationsNew += 1;
  else report.observationsReused += 1;

  const processed = await processRawEvent({ client: deps.client, config: deps.config, source: row, observationId: observation.id, geocode: deps.geocode, now: deps.now }, raw);
  if (processed.kind === "invalid") {
    report.invalidEvents += 1;
    report.rejectedEvents += 1;
    return;
  }

  const { candidate } = processed;
  if (candidate.status === "rejected") report.rejectedEvents += 1;
  else report.validEvents += 1;
  if (processed.created) report.candidatesCreated += 1;
  if (candidate.status === "needs_review" && (processed.created || processed.reopened)) report.candidatesReview += 1;

  if (processed.preserved) {
    await handleImportedChange(deps, report, candidate, raw, processed.event, processed.outcome.cancelled);
    return;
  }
  if (candidate.status !== "ready") return;
  const publication = await publishCandidate({ client: deps.client, config: deps.config }, candidate.id, false);
  if (publication.status === "published") report.published += 1;
  else if (publication.status === "shadow") report.shadowDecisions += 1;
  else report.publicationBlocked += 1;
}

async function recordMetrics(deps: SourceRunDeps, report: SourceRunReport, now: Date): Promise<void> {
  try {
    await updateSourceMetrics(deps.client, report.sourceId, {
      attemptedAt: now,
      success: report.status === "succeeded",
      validEvents: report.validEvents,
      rejectedEvents: report.rejectedEvents,
    });
  } catch (error) {
    // Metrics are bookkeeping; losing them must not turn a collected source into a failure.
    report.warning = sanitizeForLog(`Source metrics not recorded: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

/**
 * Collects one source end to end. It never throws for source-level problems: failures are returned in the report so one
 * broken source cannot stop the others. Each event is processed independently for the same reason.
 */
export async function runSource(deps: SourceRunDeps, row: SourceRow, runId: string, signal: AbortSignal): Promise<SourceRunReport> {
  const now = (deps.now ?? (() => new Date()))();
  const report = emptyReport(row);
  const outcome = await collectWithRetry(deps, toSourceDefinition(row), runId, signal);
  report.attempts = outcome.attempts;

  if (!outcome.result) {
    report.status = "failed";
    report.failureKind = outcome.failureKind;
    report.error = sanitizeForLog(outcome.error ?? "Source collection failed");
    await recordMetrics(deps, report, now);
    return report;
  }

  const limit = deps.maxEvents ?? MAX_EVENTS_PER_SOURCE;
  const events = outcome.result.events;
  report.eventsFound = events.length;
  report.truncated = events.length > limit;
  report.warning = outcome.result.error ? sanitizeForLog(outcome.result.error) : null;
  report.noEvents = events.length === 0;

  let firstProcessingError: string | null = null;
  for (const raw of events.slice(0, limit)) {
    if (signal.aborted) break;
    try {
      await processEvent(deps, row, runId, raw, report);
    } catch (error) {
      report.processingErrors += 1;
      firstProcessingError ??= sanitizeForLog(error);
    }
  }

  const attempted = Math.min(events.length, limit);
  if (signal.aborted && report.validEvents + report.rejectedEvents + report.processingErrors < attempted) {
    report.status = "failed";
    report.failureKind = "aborted";
    report.error = "Run deadline reached before all events were processed";
  } else if (attempted > 0 && report.processingErrors === attempted) {
    // Everything the source listed failed to process: the pipeline, not the source, is broken. Surface it as a failure.
    report.status = "failed";
    report.failureKind = "processing_failed";
    report.error = firstProcessingError;
  } else if (firstProcessingError) {
    report.warning = report.warning ?? `Some events failed to process: ${firstProcessingError}`;
  }

  await recordMetrics(deps, report, now);
  return report;
}
