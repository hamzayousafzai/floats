import { createHash } from "node:crypto";
import { type IngestionClient, UNIQUE_VIOLATION, ingestionDb, throwIfError } from "./client";
import type { ObservationRow } from "./rows";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/** Deterministic SHA-256 of a payload, independent of object key order. */
export function hashPayload(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export interface ObservationInput {
  sourceId: string;
  runId: string;
  externalEventId: string | null;
  sourceUrl: string;
  rawPayload: Record<string, unknown>;
  parserVersion: string;
  contentHash?: string;
}

export interface SaveObservationResult {
  observation: ObservationRow;
  created: boolean;
}

export async function getObservationByIdentity(
  client: IngestionClient,
  sourceId: string,
  sourceUrl: string,
  contentHash: string,
): Promise<ObservationRow | null> {
  const { data, error } = await ingestionDb(client)
    .from("observations")
    .select("*")
    .eq("source_id", sourceId)
    .eq("source_url", sourceUrl)
    .eq("content_hash", contentHash)
    .maybeSingle();
  throwIfError("Failed to load observation", error);
  return (data as ObservationRow | null) ?? null;
}

/**
 * Observations are immutable raw evidence. The identity is `(source_id, source_url, content_hash)`;
 * saving the same content again returns the stored observation instead of inserting another.
 */
export async function saveObservation(client: IngestionClient, input: ObservationInput): Promise<SaveObservationResult> {
  const contentHash = input.contentHash ?? hashPayload(input.rawPayload);
  const existing = await getObservationByIdentity(client, input.sourceId, input.sourceUrl, contentHash);
  if (existing) return { observation: existing, created: false };

  const { data, error } = await ingestionDb(client)
    .from("observations")
    .insert({
      source_id: input.sourceId,
      run_id: input.runId,
      external_event_id: input.externalEventId,
      source_url: input.sourceUrl,
      raw_payload: input.rawPayload,
      content_hash: contentHash,
      parser_version: input.parserVersion,
    })
    .select("*")
    .single();

  if (error?.code === UNIQUE_VIOLATION) {
    const raced = await getObservationByIdentity(client, input.sourceId, input.sourceUrl, contentHash);
    if (raced) return { observation: raced, created: false };
  }
  throwIfError("Failed to save observation", error);
  return { observation: data as ObservationRow, created: true };
}

export async function getObservationById(client: IngestionClient, id: string): Promise<ObservationRow | null> {
  const { data, error } = await ingestionDb(client).from("observations").select("*").eq("id", id).maybeSingle();
  throwIfError("Failed to load observation", error);
  return (data as ObservationRow | null) ?? null;
}
