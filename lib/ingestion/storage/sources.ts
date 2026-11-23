import type { AdapterType, SourceType } from "@/lib/ingestion/types";
import { type IngestionClient, UNIQUE_VIOLATION, ingestionDb, throwIfError } from "./client";
import type { SourceRow } from "./rows";

export interface GetEnabledSourcesOptions {
  /** Include sources used only for discovery (never collected for events). Defaults to false. */
  includeDiscoveryOnly?: boolean;
}

/** Enabled, non-disabled sources eligible for collection. */
export async function getEnabledSources(client: IngestionClient, options: GetEnabledSourcesOptions = {}): Promise<SourceRow[]> {
  let query = ingestionDb(client).from("sources").select("*").eq("enabled", true).neq("trust_state", "disabled");
  if (!options.includeDiscoveryOnly) query = query.eq("discovery_only", false);
  const { data, error } = await query.order("name", { ascending: true });
  throwIfError("Failed to load sources", error);
  return (data ?? []) as SourceRow[];
}

export async function getSourceById(client: IngestionClient, id: string): Promise<SourceRow | null> {
  const { data, error } = await ingestionDb(client).from("sources").select("*").eq("id", id).maybeSingle();
  throwIfError("Failed to load source", error);
  return (data as SourceRow | null) ?? null;
}

export async function getSourceByBaseUrl(client: IngestionClient, baseUrl: string): Promise<SourceRow | null> {
  const { data, error } = await ingestionDb(client).from("sources").select("*").eq("base_url", baseUrl).maybeSingle();
  throwIfError("Failed to load source", error);
  return (data as SourceRow | null) ?? null;
}

export async function listSources(client: IngestionClient): Promise<SourceRow[]> {
  const { data, error } = await ingestionDb(client).from("sources").select("*").order("name", { ascending: true });
  throwIfError("Failed to list sources", error);
  return (data ?? []) as SourceRow[];
}

export interface SourceUpsertInput {
  name: string;
  baseUrl: string;
  sourceType: SourceType;
  adapter: AdapterType;
  discoveryOnly?: boolean;
  crawlDelayMs?: number;
  configuration?: Record<string, unknown>;
  /** Applied only when the source is first created, unless `forceDisable` is set. */
  enabled?: boolean;
  /** Disables an existing source (for example when access terms forbid automated fetching). */
  forceDisable?: boolean;
}

export interface SourceUpsertResult {
  source: SourceRow;
  created: boolean;
}

/**
 * Idempotent registration keyed on the canonical base URL. New sources always start in `probation`.
 * Existing sources keep their trust state, enabled flag and metrics; they are never promoted here.
 */
export async function upsertSource(client: IngestionClient, input: SourceUpsertInput): Promise<SourceUpsertResult> {
  const existing = await getSourceByBaseUrl(client, input.baseUrl);
  if (existing) return { source: await refreshSource(client, existing, input), created: false };

  const row = {
    name: input.name,
    base_url: input.baseUrl,
    source_type: input.sourceType,
    adapter: input.adapter,
    trust_state: "probation",
    enabled: input.forceDisable ? false : (input.enabled ?? true),
    discovery_only: input.discoveryOnly ?? false,
    crawl_delay_ms: input.crawlDelayMs ?? 2000,
    configuration: input.configuration ?? {},
  };
  const { data, error } = await ingestionDb(client).from("sources").insert(row).select("*").single();
  if (error?.code === UNIQUE_VIOLATION) {
    const raced = await getSourceByBaseUrl(client, input.baseUrl);
    if (raced) return { source: await refreshSource(client, raced, input), created: false };
  }
  throwIfError("Failed to create source", error);
  return { source: data as SourceRow, created: true };
}

async function refreshSource(client: IngestionClient, existing: SourceRow, input: SourceUpsertInput): Promise<SourceRow> {
  const patch: Record<string, unknown> = {
    name: input.name,
    source_type: input.sourceType,
    adapter: input.adapter,
    discovery_only: input.discoveryOnly ?? existing.discovery_only,
    configuration: { ...existing.configuration, ...(input.configuration ?? {}) },
    updated_at: new Date().toISOString(),
  };
  if (input.forceDisable) patch.enabled = false;
  const { data, error } = await ingestionDb(client).from("sources").update(patch).eq("id", existing.id).select("*").single();
  throwIfError("Failed to update source", error);
  return data as SourceRow;
}

export interface SourceMetricsDelta {
  attemptedAt?: Date;
  success?: boolean;
  validEvents?: number;
  rejectedEvents?: number;
}

/**
 * Applies one source attempt to its counters. `successful_runs` increases once per successful source attempt.
 * The write is a compare-and-swap on the counters it read, retried a few times, so a collection run and a manual
 * verification or replay touching the same source cannot silently overwrite each other's increments.
 */
export async function updateSourceMetrics(client: IngestionClient, sourceId: string, delta: SourceMetricsDelta): Promise<SourceRow> {
  const at = (delta.attemptedAt ?? new Date()).toISOString();
  for (let attempt = 0; attempt < METRICS_CAS_ATTEMPTS; attempt += 1) {
    const current = await getSourceById(client, sourceId);
    if (!current) throw new Error("Source not found");
    const patch: Record<string, unknown> = {
      last_attempt_at: at,
      valid_events: current.valid_events + Math.max(0, delta.validEvents ?? 0),
      rejected_events: current.rejected_events + Math.max(0, delta.rejectedEvents ?? 0),
      updated_at: at,
    };
    if (delta.success === true) {
      patch.successful_runs = current.successful_runs + 1;
      patch.last_success_at = at;
    } else if (delta.success === false) {
      patch.failed_runs = current.failed_runs + 1;
    }
    const { data, error } = await ingestionDb(client)
      .from("sources")
      .update(patch)
      .eq("id", sourceId)
      .eq("valid_events", current.valid_events)
      .eq("rejected_events", current.rejected_events)
      .eq("successful_runs", current.successful_runs)
      .eq("failed_runs", current.failed_runs)
      .select("*")
      .maybeSingle();
    throwIfError("Failed to update source metrics", error);
    if (data) return data as SourceRow;
  }
  throw new Error("Failed to update source metrics: concurrent updates did not settle");
}

const METRICS_CAS_ATTEMPTS = 4;
