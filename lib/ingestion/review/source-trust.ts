import { z } from "zod";
import { ApiError } from "@/lib/ingestion/security/api-errors";
import { sanitizeForLog } from "@/lib/ingestion/log";
import { type IngestionClient, ingestionDb, throwIfError } from "@/lib/ingestion/storage/client";
import type { RunRow, SourceRow } from "@/lib/ingestion/storage/rows";
import { getSourceById } from "@/lib/ingestion/storage/sources";

/** Spec 8: promotion needs source-specific collections and distinct administrator-approved eligible candidates. */
export const TRUST_REQUIREMENTS = { minSuccessfulRuns: 3, minApprovedCandidates: 5 } as const;
export const AUDIT_ENTRY_LIMIT = 50;
const EVIDENCE_QUERY_LIMIT = 1000;

export const sourcePatchSchema = z
  .strictObject({
    trust_state: z.enum(["probation", "trusted", "disabled"]).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((value) => value.trust_state !== undefined || value.enabled !== undefined, { message: "No change requested" });
export type SourcePatch = z.infer<typeof sourcePatchSchema>;

export const RUNS_QUERY_SCHEMA = z.strictObject({ limit: z.coerce.number().int().min(1).max(100).default(25) });

export interface TrustEvidence {
  successfulRuns: number;
  approvedCandidates: number;
  accessRestricted: boolean;
}

export type TrustBlocker =
  | "source_disabled"
  | "source_not_enabled"
  | "discovery_only_source"
  | "access_restricted"
  | "insufficient_successful_runs"
  | "insufficient_approved_candidates";

/**
 * Evidence comes from server state only: the source's own success counter and the review log. A candidate counts once,
 * only if an administrator approved it (a `reviews` row), it belongs to this source, is still approved or published,
 * and passed the eligibility facts (market, verified vendors and location, not cancelled). Nothing is client-supplied.
 */
export async function getTrustEvidence(client: IngestionClient, source: SourceRow): Promise<TrustEvidence> {
  const { data: candidates, error: candidateError } = await ingestionDb(client)
    .from("candidates")
    .select("id")
    .eq("primary_source_id", source.id)
    .in("status", ["approved", "published"])
    .eq("is_market", true)
    .eq("vendor_verified", true)
    .eq("location_verified", true)
    .eq("cancelled", false)
    .limit(EVIDENCE_QUERY_LIMIT);
  throwIfError("Failed to load source candidates", candidateError);
  const ids = ((candidates ?? []) as { id: string }[]).map((row) => row.id);

  let approved = 0;
  if (ids.length > 0) {
    const { data: reviews, error: reviewError } = await ingestionDb(client).from("reviews").select("candidate_id").eq("decision", "approve").in("candidate_id", ids).limit(EVIDENCE_QUERY_LIMIT * 5);
    throwIfError("Failed to load candidate reviews", reviewError);
    approved = new Set(((reviews ?? []) as { candidate_id: string }[]).map((row) => row.candidate_id)).size;
  }

  return {
    successfulRuns: source.successful_runs,
    approvedCandidates: approved,
    accessRestricted: hasAccessRestriction(source),
  };
}

export function hasAccessRestriction(source: Pick<SourceRow, "configuration">): boolean {
  const config = source.configuration ?? {};
  return typeof config.disabledReason === "string" || config.accessRestricted === true;
}

export function trustPromotionBlockers(source: SourceRow, evidence: TrustEvidence, effectiveEnabled: boolean): TrustBlocker[] {
  const blockers: TrustBlocker[] = [];
  if (source.trust_state === "disabled") blockers.push("source_disabled");
  if (!effectiveEnabled) blockers.push("source_not_enabled");
  if (source.discovery_only) blockers.push("discovery_only_source");
  if (evidence.accessRestricted) blockers.push("access_restricted");
  if (evidence.successfulRuns < TRUST_REQUIREMENTS.minSuccessfulRuns) blockers.push("insufficient_successful_runs");
  if (evidence.approvedCandidates < TRUST_REQUIREMENTS.minApprovedCandidates) blockers.push("insufficient_approved_candidates");
  return blockers;
}

export interface SourceControlResult {
  sourceId: string;
  trustState: SourceRow["trust_state"];
  enabled: boolean;
  changed: boolean;
}

/**
 * Applies an administrator's trust/enabled decision. Promotion is never automatic: it happens only here, only on an
 * explicit request, and only when the server-derived evidence meets the requirements. Every change is appended to
 * `configuration.audit` (capped) with the administrator id and the evidence relied on.
 */
export async function updateSourceControls(client: IngestionClient, input: { sourceId: string; adminId: string; patch: SourcePatch; now?: () => Date }): Promise<SourceControlResult> {
  const source = await getSourceById(client, input.sourceId);
  if (!source) throw new ApiError("NOT_FOUND", "Source not found");

  const nextTrust = input.patch.trust_state ?? source.trust_state;
  const nextEnabled = input.patch.enabled ?? source.enabled;
  if (nextTrust === source.trust_state && nextEnabled === source.enabled) {
    return { sourceId: source.id, trustState: source.trust_state, enabled: source.enabled, changed: false };
  }

  const evidence = await getTrustEvidence(client, source);
  if (nextTrust === "trusted" && source.trust_state !== "trusted") {
    const blockers = trustPromotionBlockers(source, evidence, nextEnabled);
    if (blockers.length > 0) throw new ApiError("CONFLICT", `Trust promotion requirements not met: ${blockers.join(", ")}`);
  }
  if (nextEnabled && !source.enabled) {
    if (nextTrust === "disabled") throw new ApiError("CONFLICT", "A disabled source cannot be enabled");
    if (evidence.accessRestricted) throw new ApiError("CONFLICT", "Source has a recorded access restriction");
  }
  if (nextTrust === "trusted" && source.trust_state === "disabled") throw new ApiError("CONFLICT", "A disabled source must return to probation first");

  const at = (input.now ?? (() => new Date()))().toISOString();
  const audit = Array.isArray(source.configuration?.audit) ? (source.configuration.audit as unknown[]) : [];
  const entry = {
    at,
    admin_id: input.adminId,
    trust_state: { from: source.trust_state, to: nextTrust },
    enabled: { from: source.enabled, to: nextEnabled },
    evidence: { successful_runs: evidence.successfulRuns, approved_candidates: evidence.approvedCandidates },
  };
  const configuration = { ...source.configuration, audit: [...audit, entry].slice(-AUDIT_ENTRY_LIMIT) };

  // Compare-and-swap on the row we evaluated, so a concurrent change cannot slip past the evidence check.
  const { data, error } = await ingestionDb(client)
    .from("sources")
    .update({ trust_state: nextTrust, enabled: nextEnabled, configuration, updated_at: at })
    .eq("id", source.id)
    .eq("updated_at", source.updated_at)
    .select("*");
  throwIfError("Failed to update source", error);
  const updated = ((data ?? []) as SourceRow[])[0];
  if (!updated) throw new ApiError("CONFLICT", "Source was modified; reload and retry");
  return { sourceId: updated.id, trustState: updated.trust_state, enabled: updated.enabled, changed: true };
}

export function toSourceItem(row: SourceRow) {
  return {
    id: row.id,
    name: row.name,
    base_url: row.base_url,
    source_type: row.source_type,
    adapter: row.adapter,
    trust_state: row.trust_state,
    enabled: row.enabled,
    valid_events: row.valid_events,
    rejected_events: row.rejected_events,
    successful_runs: row.successful_runs,
    failed_runs: row.failed_runs,
    last_success_at: row.last_success_at,
    discovery_only: row.discovery_only,
    last_attempt_at: row.last_attempt_at,
  };
}

/** Run errors are re-sanitized on the way out as a second line of defense; metadata and raw payloads are never returned. */
export function toRunItem(row: RunRow) {
  return {
    id: row.id,
    run_type: row.run_type,
    status: row.status,
    started_at: row.started_at,
    finished_at: row.finished_at,
    sources_attempted: row.sources_attempted,
    sources_succeeded: row.sources_succeeded,
    observations_found: row.observations_found,
    candidates_created: row.candidates_created,
    candidates_published: row.candidates_published,
    candidates_review: row.candidates_review,
    error_summary: row.error_summary ? sanitizeForLog(row.error_summary) : null,
  };
}
