import { z } from "zod";
import { duplicateStateOf, findDuplicate } from "@/lib/ingestion/deduplication/match-event";
import { ApiError } from "@/lib/ingestion/security/api-errors";
import { getCandidateById } from "@/lib/ingestion/storage/candidates";
import { type IngestionClient, IngestionStorageError, ingestionDb } from "@/lib/ingestion/storage/client";
import type { CandidateRow } from "@/lib/ingestion/storage/rows";
import { getSourceById } from "@/lib/ingestion/storage/sources";
import type { NormalizedEvent } from "@/lib/ingestion/types";
import { type GeocodeResult, geocodeAddress } from "@/lib/ingestion/validation/geocode";
import { type ValidationConfig, sourceInfoFromRow, validateEvent } from "@/lib/ingestion/validation/validate-event";

export const REVIEW_ACTIONS = ["approve", "reject", "request_review"] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();
const timestamp = z.iso.datetime({ offset: true });

/** Spec 8: only these keys are editable; unknown keys are rejected rather than ignored. */
const changesSchema = z
  .strictObject({
    title: z.string().trim().min(5).max(200).optional(),
    description: optionalText(5000),
    starts_at: timestamp.optional(),
    ends_at: timestamp.nullable().optional(),
    address: optionalText(300),
    organizer_name: optionalText(200),
    venue_name: optionalText(200),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    category_slugs: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,49}$/)).max(20).optional(),
    vendor_count: z.number().int().min(0).max(10000).nullable().optional(),
  })
  .refine((value) => (value.latitude === undefined) === (value.longitude === undefined), {
    message: "latitude and longitude must be supplied together",
  });

export const reviewPatchSchema = z.strictObject({
  action: z.enum(REVIEW_ACTIONS),
  reason: z.string().trim().min(1).max(1000),
  changes: changesSchema.optional(),
});
export type ReviewPatch = z.infer<typeof reviewPatchSchema>;
export type ReviewChanges = z.infer<typeof changesSchema>;

export type ReviewConfig = ValidationConfig;

export interface ReviewDependencies {
  client: IngestionClient;
  config: ReviewConfig;
  geocode?: (address: string) => Promise<GeocodeResult | null>;
  now?: () => Date;
}

export interface ReviewResult {
  candidateId: string;
  status: "approved" | "rejected" | "needs_review";
  /** Reviews never publish; publication is a separate explicit administrator action. */
  publishedEventId: null;
}

const ALLOWED_FROM: Readonly<Record<ReviewAction, readonly string[]>> = {
  approve: ["needs_review"],
  reject: ["needs_review"],
  request_review: ["ready", "needs_review"],
};

/** Exact messages raised by `ingestion.apply_review`, mapped to public API errors with static text. */
const RPC_ERRORS: ReadonlyArray<readonly [string, () => ApiError]> = [
  ["Candidate changed", () => new ApiError("CONFLICT", "Candidate was modified; reload and retry")],
  ["Invalid status transition", () => new ApiError("CONFLICT", "Candidate status does not allow this action")],
  ["Hard gates unresolved", () => new ApiError("CONFLICT", "Hard gates are unresolved")],
  ["Candidate not found", () => new ApiError("NOT_FOUND", "Candidate not found")],
  ["Administrator required", () => new ApiError("FORBIDDEN")],
  ["Invalid review request", () => new ApiError("VALIDATION_ERROR")],
  ["Unsupported review field", () => new ApiError("VALIDATION_ERROR")],
];

const toIso = (value: string): string => new Date(value).toISOString();

function applyChanges(candidate: CandidateRow, changes: ReviewChanges) {
  return {
    title: changes.title ?? candidate.title,
    description: changes.description !== undefined ? changes.description : candidate.description,
    startsAt: changes.starts_at !== undefined ? toIso(changes.starts_at) : candidate.starts_at,
    endsAt: changes.ends_at !== undefined ? (changes.ends_at === null ? null : toIso(changes.ends_at)) : candidate.ends_at,
    address: changes.address !== undefined ? changes.address : candidate.address,
    organizerName: changes.organizer_name !== undefined ? changes.organizer_name : candidate.organizer_name,
    venueName: changes.venue_name !== undefined ? changes.venue_name : candidate.venue_name,
    categorySlugs: changes.category_slugs ?? candidate.category_slugs,
    vendorCount: changes.vendor_count !== undefined ? changes.vendor_count : candidate.vendor_count,
  };
}

/**
 * Applies one administrator decision. The route has already verified admin authorization. Steps: load, check the status
 * transition, merge the validated patch, re-verify location, re-run the duplicate search and validation, then write
 * everything (review row, candidate update) in one SQL transaction guarded by the `updated_at` we read.
 *
 * Coordinates supplied by the administrator count as administrator-verified and are recorded in the review row;
 * changing the address alone clears the coordinates unless the geocoder verifies the new address.
 * Approval is refused while any hard gate fails; it never publishes.
 */
export async function reviewCandidate(deps: ReviewDependencies, input: { candidateId: string; adminId: string; patch: ReviewPatch }): Promise<ReviewResult> {
  const { client, config } = deps;
  const { patch } = input;
  const now = (deps.now ?? (() => new Date()))();

  const candidate = await getCandidateById(client, input.candidateId);
  if (!candidate) throw new ApiError("NOT_FOUND", "Candidate not found");
  if (candidate.published_event_id || !ALLOWED_FROM[patch.action].includes(candidate.status)) {
    throw new ApiError("CONFLICT", "Candidate status does not allow this action");
  }
  const source = await getSourceById(client, candidate.primary_source_id);
  if (!source) throw new ApiError("CONFLICT", "Candidate source is unavailable");

  const changes = patch.changes ?? {};
  const merged = applyChanges(candidate, changes);
  if (merged.startsAt && merged.endsAt && Date.parse(merged.endsAt) <= Date.parse(merged.startsAt)) {
    throw new ApiError("VALIDATION_ERROR", "ends_at must be after starts_at");
  }

  let latitude = changes.latitude ?? candidate.latitude;
  let longitude = changes.longitude ?? candidate.longitude;
  let locationVerified = candidate.location_verified;
  if (changes.latitude !== undefined) {
    locationVerified = true;
  } else if (changes.address !== undefined && changes.address !== candidate.address) {
    latitude = null;
    longitude = null;
    locationVerified = false;
    if (merged.address) {
      const geocoded = await (deps.geocode ?? ((address: string) => geocodeAddress(address)))(merged.address);
      if (geocoded) {
        latitude = geocoded.latitude;
        longitude = geocoded.longitude;
        locationVerified = geocoded.verified;
      }
    }
  }

  const duplicate = merged.startsAt
    ? await findDuplicate(client, {
        sourceId: source.id,
        externalEventId: candidate.external_event_id,
        canonicalKey: candidate.canonical_key,
        sourceUrl: candidate.source_url,
        title: merged.title,
        startsAt: merged.startsAt,
        address: merged.address,
        venueName: merged.venueName,
        organizerName: merged.organizerName,
        latitude,
        longitude,
        candidateId: candidate.id,
        firstSeenAt: candidate.first_seen_at,
        ownEventId: candidate.published_event_id,
      })
    : null;
  const duplicateState = merged.startsAt ? duplicateStateOf(duplicate) : "unchecked";

  const event: NormalizedEvent = {
    canonicalKey: candidate.canonical_key,
    title: merged.title,
    description: merged.description,
    startsAt: merged.startsAt,
    endsAt: merged.endsAt,
    timezone: "America/New_York",
    organizerName: merged.organizerName,
    venueName: merged.venueName,
    address: merged.address,
    latitude,
    longitude,
    vendorCount: merged.vendorCount,
    vendorEvidence: Array.isArray(candidate.vendor_evidence) ? candidate.vendor_evidence : [],
    categorySlugs: merged.categorySlugs,
    cancelled: candidate.cancelled,
    sourceUrl: candidate.source_url,
  };
  const outcome = validateEvent({ event, source: sourceInfoFromRow(source), locationVerified, duplicateState, config, now });

  if (patch.action === "approve" && !outcome.hardGatesPassed) {
    throw new ApiError("CONFLICT", `Hard gates are unresolved: ${outcome.hardGateFailures.join(", ")}`);
  }

  const fields = {
    title: merged.title,
    description: merged.description,
    starts_at: merged.startsAt,
    ends_at: merged.endsAt,
    address: merged.address,
    organizer_name: merged.organizerName,
    venue_name: merged.venueName,
    latitude,
    longitude,
    category_slugs: merged.categorySlugs,
    vendor_count: merged.vendorCount,
    validation_reasons: outcome.reasons,
    score: outcome.score,
    is_market: outcome.isMarket,
    location_verified: outcome.locationVerified,
    vendor_verified: outcome.vendorVerified,
    cancelled: outcome.cancelled,
    duplicate_state: duplicateState,
  };

  const { data, error } = await ingestionDb(client).rpc("apply_review", {
    p_candidate_id: candidate.id,
    p_reviewer_id: input.adminId,
    p_decision: patch.action,
    p_reason: patch.reason,
    p_changes: changes,
    p_expected_updated_at: candidate.updated_at,
    p_fields: fields,
    p_hard_gates_passed: outcome.hardGatesPassed,
  });
  if (error) {
    const hit = RPC_ERRORS.find(([text]) => error.message.includes(text));
    if (hit) throw hit[1]();
    throw new IngestionStorageError("Candidate review failed", error);
  }
  if (data !== "approved" && data !== "rejected" && data !== "needs_review") {
    throw new IngestionStorageError("Candidate review returned an unknown status", { message: String(data) });
  }
  return { candidateId: candidate.id, status: data, publishedEventId: null };
}

export const LIST_QUERY_SCHEMA = z.strictObject({
  status: z.enum(["pending", "validating", "ready", "needs_review", "approved", "rejected", "published"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(512).optional(),
});

export function toListItem(row: CandidateRow) {
  return {
    id: row.id,
    title: row.title,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    address: row.address,
    organizer_name: row.organizer_name,
    source_url: row.source_url,
    score: row.score,
    status: row.status,
    validation_reasons: row.validation_reasons,
    duplicate_state: row.duplicate_state,
    published_event_id: row.published_event_id,
  };
}

export function toDetail(row: CandidateRow, sources: { source_url: string; match_reason: string }[]) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    timezone: row.timezone,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    organizer_name: row.organizer_name,
    venue_name: row.venue_name,
    category_slugs: row.category_slugs,
    vendor_count: row.vendor_count,
    vendor_evidence: row.vendor_evidence,
    score: row.score,
    status: row.status,
    source_url: row.source_url,
    validation_reasons: row.validation_reasons,
    duplicate_state: row.duplicate_state,
    published_event_id: row.published_event_id,
    sources,
  };
}
