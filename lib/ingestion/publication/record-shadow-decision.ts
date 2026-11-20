import type { CandidateRow } from "@/lib/ingestion/storage/rows";
import { type AuditAction, appendPublicationAudit, hasPublicationAudit } from "@/lib/ingestion/storage/audit";
import type { IngestionClient } from "@/lib/ingestion/storage/client";

export interface ShadowDecisionResult {
  recorded: boolean;
}

/**
 * Shadow mode: appends one `shadow_approved` audit row stating that the candidate would have been published, and
 * writes nothing to `public.events`. Repeating the call for the same candidate is a no-op so daily runs do not
 * grow the audit table.
 */
export async function recordShadowDecision(client: IngestionClient, candidate: Pick<CandidateRow, "id" | "score" | "status" | "primary_source_id" | "canonical_key">): Promise<ShadowDecisionResult> {
  const action: AuditAction = "shadow_approved";
  if (await hasPublicationAudit(client, candidate.id, action)) return { recorded: false };
  await appendPublicationAudit(client, {
    candidateId: candidate.id,
    action,
    reason: "shadow_mode",
    details: { score: candidate.score, status: candidate.status, sourceId: candidate.primary_source_id, canonicalKey: candidate.canonical_key },
  });
  return { recorded: true };
}
