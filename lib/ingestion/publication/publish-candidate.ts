import type { IngestionConfig } from "@/lib/ingestion/config";
import { sanitizeForLog } from "@/lib/ingestion/log";
import { recordShadowDecision } from "@/lib/ingestion/publication/record-shadow-decision";
import { type AuditAction, appendPublicationAudit } from "@/lib/ingestion/storage/audit";
import { getCandidateById } from "@/lib/ingestion/storage/candidates";
import { type IngestionClient, IngestionStorageError, ingestionDb } from "@/lib/ingestion/storage/client";

export type PublicationConfig = Pick<IngestionConfig, "centerLat" | "centerLng" | "radiusMiles" | "horizonDays" | "autoPublishScore" | "publishMode">;

export interface PublicationDependencies {
  client: IngestionClient;
  config: PublicationConfig;
}

export type PublicationStatus = "published" | "shadow" | "blocked";

export type PublicationReason =
  | "published"
  | "shadow_mode"
  | "candidate_not_found"
  | "not_ready"
  | "score_below_threshold"
  | "approval_required"
  | "source_unavailable"
  | "automatic_not_permitted"
  | "hard_gates_failed"
  | "outside_radius"
  | "existing_identity"
  | "possible_duplicate"
  | "service_role_required"
  | "invalid_configuration";

export interface PublicationResult {
  candidateId: string;
  eventId: string | null;
  status: PublicationStatus;
  reason: PublicationReason;
}

/** Exact exception messages raised by `ingestion.publish_candidate`. Anything else is an unexpected failure. */
const RPC_ERROR_REASONS: ReadonlyArray<readonly [string, PublicationReason]> = [
  ["Candidate not found", "candidate_not_found"],
  ["Source unavailable", "source_unavailable"],
  ["Candidate requires recorded admin approval", "approval_required"],
  ["Automatic publication not permitted", "automatic_not_permitted"],
  ["Candidate failed hard publication gates", "hard_gates_failed"],
  ["Event is outside radius", "outside_radius"],
  ["Existing published event identity", "existing_identity"],
  ["Possible existing production duplicate", "possible_duplicate"],
  ["Service role required", "service_role_required"],
  ["Invalid publication configuration", "invalid_configuration"],
];

const DUPLICATE_REASONS: ReadonlySet<PublicationReason> = new Set(["existing_identity", "possible_duplicate"]);
const UNAUDITED: ReadonlySet<PublicationReason> = new Set(["candidate_not_found", "not_ready", "score_below_threshold"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reasonForRpcError(message: string): PublicationReason | null {
  const hit = RPC_ERROR_REASONS.find(([text]) => message.includes(text));
  return hit ? hit[1] : null;
}

async function block(client: IngestionClient, candidateId: string, reason: PublicationReason, manual: boolean): Promise<PublicationResult> {
  const action: AuditAction = DUPLICATE_REASONS.has(reason) ? "skipped_duplicate" : "blocked";
  // The publisher rolls back its own writes on failure, so the refusal is recorded here. Plain eligibility pre-checks
  // (missing candidate, not ready, low score) are caller errors, not publication attempts, and are not audited.
  if (!UNAUDITED.has(reason)) await appendPublicationAudit(client, { candidateId, action, reason, details: { manual } });
  return { candidateId, eventId: null, status: "blocked", reason };
}

/**
 * Publishes one candidate through the single SQL publisher (`ingestion.publish_candidate`).
 *
 * - `manual = false` (the automatic path): only `ready` candidates that meet the score threshold are considered. In
 *   shadow mode the decision is audited and NOTHING is written to production. In live mode the publisher still
 *   re-checks trust, hard gates, radius and duplicates inside one transaction.
 * - `manual = true`: the caller MUST already have verified admin authorization. The candidate must be `approved`
 *   with a recorded approver (also enforced in SQL). Manual publication is allowed in shadow mode because it is an
 *   explicit admin action, not automation.
 *
 * Repeating a call for an already published candidate returns the existing event id and creates nothing.
 */
export async function publishCandidate(deps: PublicationDependencies, candidateId: string, manual = false): Promise<PublicationResult> {
  const { client, config } = deps;
  const candidate = await getCandidateById(client, candidateId);
  if (!candidate) return block(client, candidateId, "candidate_not_found", manual);
  if (candidate.published_event_id) return { candidateId, eventId: candidate.published_event_id, status: "published", reason: "published" };

  if (manual) {
    if (candidate.status !== "approved" || !candidate.approved_by) return block(client, candidateId, "approval_required", manual);
  } else {
    if (candidate.status !== "ready") return block(client, candidateId, "not_ready", manual);
    if (candidate.score < config.autoPublishScore) return block(client, candidateId, "score_below_threshold", manual);
    if (config.publishMode !== "live") {
      await recordShadowDecision(client, candidate);
      return { candidateId, eventId: null, status: "shadow", reason: "shadow_mode" };
    }
  }

  const { data, error } = await ingestionDb(client).rpc("publish_candidate", {
    p_candidate_id: candidateId,
    p_min_score: config.autoPublishScore,
    p_center_lat: config.centerLat,
    p_center_lng: config.centerLng,
    p_radius_miles: config.radiusMiles,
    p_horizon_days: config.horizonDays,
    p_manual: manual,
  });

  if (error) {
    const reason = reasonForRpcError(error.message);
    if (!reason) throw new IngestionStorageError("Unexpected publication failure", error);
    return block(client, candidateId, reason, manual);
  }
  if (typeof data !== "string" || !UUID.test(data)) {
    throw new IngestionStorageError("Publisher returned an invalid event id", { message: sanitizeForLog(String(data)) });
  }
  return { candidateId, eventId: data, status: "published", reason: "published" };
}
