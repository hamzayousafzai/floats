import type { IngestionConfig } from "@/lib/ingestion/config";
import { type VerifiedChanges, toChangePayload } from "@/lib/ingestion/publication/ownership";
import { type IngestionClient, IngestionStorageError, ingestionDb } from "@/lib/ingestion/storage/client";

export type ImportedUpdateConfig = Pick<IngestionConfig, "centerLat" | "centerLng" | "radiusMiles">;

export const UPDATE_OUTCOMES = [
  "updated",
  "unchanged",
  "archived",
  "already_archived",
  "not_imported",
  "not_managed",
  "host_owned",
  "manually_modified",
  "source_unavailable",
  "not_published",
  "event_started",
  "gates_failed",
  "outside_radius",
  "possible_duplicate",
] as const;
export type UpdateOutcome = (typeof UPDATE_OUTCOMES)[number];

export interface UpdateResult {
  eventId: string;
  outcome: UpdateOutcome;
  /** True when a production row was written. */
  changed: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function callUpdate(client: IngestionClient, config: ImportedUpdateConfig, eventId: string, payload: Record<string, unknown>, evidence: string | null): Promise<UpdateResult> {
  if (!UUID.test(eventId)) throw new Error("Invalid event id");
  const { data, error } = await ingestionDb(client).rpc("update_imported_event", {
    p_event_id: eventId,
    p_changes: payload,
    p_cancellation_evidence: evidence,
    p_center_lat: config.centerLat,
    p_center_lng: config.centerLng,
    p_radius_miles: config.radiusMiles,
  });
  if (error) throw new IngestionStorageError("Imported event update failed", error);
  if (typeof data !== "string" || !(UPDATE_OUTCOMES as readonly string[]).includes(data)) {
    throw new IngestionStorageError("Imported event update returned an unknown outcome", { message: String(data) });
  }
  const outcome = data as UpdateOutcome;
  return { eventId, outcome, changed: outcome === "updated" || outcome === "archived" };
}

/**
 * Applies verified source changes to an event that ingestion still owns. The decision to proceed is made in SQL under
 * row locks (link, event, candidate), so a concurrent claim or manual edit always wins. Missing events, host-owned
 * events and manually edited events are never modified.
 */
export async function updateImportedEvent(deps: { client: IngestionClient; config: ImportedUpdateConfig }, eventId: string, changes: VerifiedChanges): Promise<UpdateResult> {
  return callUpdate(deps.client, deps.config, eventId, toChangePayload(changes), null);
}

/** Archives an ingestion-owned event on verified cancellation. `evidence` must quote the source's own cancellation text. */
export async function archiveCancelledEvent(deps: { client: IngestionClient; config: ImportedUpdateConfig }, eventId: string, evidence: string): Promise<UpdateResult> {
  return callUpdate(deps.client, deps.config, eventId, {}, evidence);
}
