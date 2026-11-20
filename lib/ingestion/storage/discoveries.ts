import type { AdapterType } from "@/lib/ingestion/types";
import { type IngestionClient, UNIQUE_VIOLATION, ingestionDb, throwIfError } from "./client";
import type { DiscoveryEvaluation, DiscoveryRow } from "./rows";

export interface SourceDiscoveryInput {
  discoveredUrl: string;
  parentSourceId: string | null;
  evaluation: DiscoveryEvaluation;
  reason: string | null;
  adapterDetected: AdapterType | null;
  registeredSourceId?: string | null;
}

export async function getSourceDiscovery(client: IngestionClient, discoveredUrl: string): Promise<DiscoveryRow | null> {
  const { data, error } = await ingestionDb(client).from("source_discoveries").select("*").eq("discovered_url", discoveredUrl).maybeSingle();
  throwIfError("Failed to load discovery", error);
  return (data as DiscoveryRow | null) ?? null;
}

/** Idempotent on `discovered_url`; an existing registration link is never cleared. */
export async function saveSourceDiscovery(client: IngestionClient, input: SourceDiscoveryInput): Promise<{ discovery: DiscoveryRow; created: boolean }> {
  const existing = await getSourceDiscovery(client, input.discoveredUrl);
  if (existing) return { discovery: await updateDiscovery(client, existing, input), created: false };

  const { data, error } = await ingestionDb(client)
    .from("source_discoveries")
    .insert({
      discovered_url: input.discoveredUrl,
      parent_source_id: input.parentSourceId,
      evaluation: input.evaluation,
      reason: input.reason,
      adapter_detected: input.adapterDetected,
      registered_source_id: input.registeredSourceId ?? null,
      evaluated_at: input.evaluation === "pending" ? null : new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error?.code === UNIQUE_VIOLATION) {
    const raced = await getSourceDiscovery(client, input.discoveredUrl);
    if (raced) return { discovery: await updateDiscovery(client, raced, input), created: false };
  }
  throwIfError("Failed to save discovery", error);
  return { discovery: data as DiscoveryRow, created: true };
}

async function updateDiscovery(client: IngestionClient, existing: DiscoveryRow, input: SourceDiscoveryInput): Promise<DiscoveryRow> {
  const patch = {
    evaluation: input.evaluation,
    reason: input.reason,
    adapter_detected: input.adapterDetected,
    registered_source_id: input.registeredSourceId ?? existing.registered_source_id,
    evaluated_at: input.evaluation === "pending" ? existing.evaluated_at : new Date().toISOString(),
  };
  const { data, error } = await ingestionDb(client).from("source_discoveries").update(patch).eq("id", existing.id).select("*").single();
  throwIfError("Failed to update discovery", error);
  return data as DiscoveryRow;
}

/** Every discovery already evaluated, so a weekly run never re-evaluates (or re-fetches) a known domain. */
export async function listSourceDiscoveries(client: IngestionClient, limit = 5000): Promise<DiscoveryRow[]> {
  const { data, error } = await ingestionDb(client).from("source_discoveries").select("*").order("discovered_at", { ascending: true }).limit(limit);
  throwIfError("Failed to list discoveries", error);
  return (data ?? []) as DiscoveryRow[];
}
