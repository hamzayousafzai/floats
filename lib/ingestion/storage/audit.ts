import { type IngestionClient, ingestionDb, throwIfError } from "./client";

export type AuditAction = "shadow_approved" | "published" | "skipped_duplicate" | "blocked" | "archived" | "updated" | "event_deleted";

export interface AuditInput {
  candidateId: string;
  eventId?: string | null;
  action: AuditAction;
  reason: string | null;
  details?: Record<string, unknown>;
}

export async function appendPublicationAudit(client: IngestionClient, input: AuditInput): Promise<void> {
  const { error } = await ingestionDb(client)
    .from("publication_audit")
    .insert({ candidate_id: input.candidateId, event_id: input.eventId ?? null, action: input.action, reason: input.reason, details: input.details ?? {} });
  throwIfError("Failed to write publication audit", error);
}

export async function hasPublicationAudit(client: IngestionClient, candidateId: string, action: AuditAction): Promise<boolean> {
  const { data, error } = await ingestionDb(client).from("publication_audit").select("id").eq("candidate_id", candidateId).eq("action", action).limit(1);
  throwIfError("Failed to read publication audit", error);
  return (data ?? []).length > 0;
}
