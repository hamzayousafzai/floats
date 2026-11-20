import type { IngestionConfig } from "@/lib/ingestion/config";
import type { NormalizationIssue } from "@/lib/ingestion/normalize/normalize-event";
import type { SourceRow } from "@/lib/ingestion/storage/rows";
import type { DuplicateState, NormalizedEvent, ValidationReason, ValidationResult } from "@/lib/ingestion/types";
import { type MarketClassification, classifyMarket, isCancelled } from "./classify";
import { type LocationState, type ScoreBreakdown, type ScoreSource, type StartState, type VendorBasis, calculateCandidateScore } from "./score";
import { isValidCoordinate, isWithinRadius } from "./within-radius";

export interface ValidationSourceInfo extends ScoreSource {
  enabled: boolean;
  /** Set explicitly in `sources.configuration` for an organizer whose recurring multi-vendor format is documented. */
  documentedMultiVendorFormat: boolean;
}

export type ValidationConfig = Pick<
  IngestionConfig,
  "centerLat" | "centerLng" | "radiusMiles" | "horizonDays" | "minVendorCount" | "autoPublishScore" | "reviewScore"
>;

export interface ValidateEventInput {
  event: NormalizedEvent;
  /** Issues reported by `normalizeEventDetailed`. */
  issues?: readonly NormalizationIssue[];
  source: ValidationSourceInfo;
  /** True only when a compliant geocoder (or trusted structured data) verified `event.latitude/longitude`. */
  locationVerified: boolean;
  duplicateState: DuplicateState;
  config: ValidationConfig;
  now: Date;
}

export interface ValidationOutcome extends ValidationResult {
  /** True when every hard gate passes; the source trust tier and the score are not part of the gates. */
  hardGatesPassed: boolean;
  hardGateFailures: ValidationReason[];
  breakdown: ScoreBreakdown;
  classification: MarketClassification;
  vendorBasis: VendorBasis;
  cancelled: boolean;
}

const MIN_TITLE = 5;
const MIN_DESCRIPTION = 20;
const MIN_ADDRESS = 10;
const DAY_MS = 86_400_000;
const DATE_ISSUES: readonly NormalizationIssue[] = ["missing_start", "date_only", "unparseable_start", "ambiguous_local_time", "nonexistent_local_time"];
const DEFINITE_REJECTIONS: readonly ValidationReason[] = ["excluded_event_type", "expired", "cancelled", "confirmed_duplicate", "outside_radius"];

export function sourceInfoFromRow(row: SourceRow): ValidationSourceInfo {
  return {
    trustState: row.trust_state,
    enabled: row.enabled,
    successfulRuns: row.successful_runs,
    failedRuns: row.failed_runs,
    validEvents: row.valid_events,
    rejectedEvents: row.rejected_events,
    documentedMultiVendorFormat: row.configuration?.documentedMultiVendorFormat === true,
  };
}

function textLength(value: string | null): number {
  return value ? value.trim().length : 0;
}

/**
 * Applies the spec 6.3 hard gates, scores the candidate and chooses a status. Definite problems reject; recoverable
 * problems need review; events beyond the horizon are held as `pending` and re-evaluated on later runs. A candidate
 * is `ready` only when every gate passes, the source is trusted and the score reaches the automatic threshold.
 */
export function validateEvent(input: ValidateEventInput): ValidationOutcome {
  const { event, source, config, now } = input;
  const issues = input.issues ?? [];
  const reasons = new Set<ValidationReason>();

  const classification = classifyMarket(event);
  if (classification.excluded) reasons.add("excluded_event_type");
  else if (!classification.isMarket) reasons.add("unclear_event_type");

  const cancelled = isCancelled(event);
  if (cancelled) reasons.add("cancelled");
  if (textLength(event.title) < MIN_TITLE) reasons.add("incomplete_title");
  if (textLength(event.description) < MIN_DESCRIPTION) reasons.add("missing_description");

  // Dates.
  const startMs = event.startsAt ? Date.parse(event.startsAt) : Number.NaN;
  const endMs = event.endsAt ? Date.parse(event.endsAt) : Number.NaN;
  const startValid = !Number.isNaN(startMs);
  let startState: StartState = "invalid";
  if (!startValid || issues.some((issue) => DATE_ISSUES.includes(issue))) {
    reasons.add("invalid_date");
  } else if (startMs < now.getTime()) {
    reasons.add("expired");
  } else if (startMs >= now.getTime() + config.horizonDays * DAY_MS) {
    reasons.add("outside_horizon");
    startState = "out_of_window";
  } else {
    startState = "in_window";
  }
  const endValid = startValid && !Number.isNaN(endMs) && endMs > startMs;
  if (!endValid && startValid) {
    const endPresent = event.endsAt !== null || issues.includes("unparseable_end") || issues.includes("end_not_after_start");
    reasons.add(endPresent ? "invalid_date" : "missing_end_time");
  }

  // Location.
  const coordinatesValid = isValidCoordinate(event.latitude, event.longitude);
  let location: LocationState = "none";
  if (textLength(event.address) < MIN_ADDRESS || !coordinatesValid || !input.locationVerified) {
    reasons.add("missing_location");
    if (textLength(event.address) >= MIN_ADDRESS) location = "unverified";
  } else if (isWithinRadius(event.latitude as number, event.longitude as number, config)) {
    location = "verified_in_radius";
  } else {
    location = "outside_radius";
    reasons.add("outside_radius");
  }

  // Vendors: an explicit count, or a documented multi-vendor format on a trusted source for a market event.
  let vendorBasis: VendorBasis = null;
  if (typeof event.vendorCount === "number" && Number.isSafeInteger(event.vendorCount) && event.vendorCount >= config.minVendorCount) vendorBasis = "count";
  else if (source.trustState === "trusted" && source.documentedMultiVendorFormat && classification.isMarket) vendorBasis = "documented_format";
  if (vendorBasis === null) reasons.add("insufficient_vendor_evidence");

  if (input.duplicateState === "confirmed") reasons.add("confirmed_duplicate");
  else if (input.duplicateState !== "clear") reasons.add("possible_duplicate");

  if (!source.enabled || source.trustState === "disabled") reasons.add("source_unavailable");

  const breakdown = calculateCandidateScore({
    source,
    vendorCount: event.vendorCount,
    vendorBasis,
    startState,
    endValid,
    location,
    classification,
  });

  const hardGateFailures = [...reasons];
  const hardGatesPassed = hardGateFailures.length === 0;

  let status: ValidationResult["status"];
  if (DEFINITE_REJECTIONS.some((reason) => reasons.has(reason)) || (reasons.has("unclear_event_type") && breakdown.total < config.reviewScore)) {
    status = "rejected";
  } else if (reasons.has("outside_horizon")) {
    status = "pending";
  } else if (!hardGatesPassed) {
    status = "needs_review";
  } else if (source.trustState === "trusted" && breakdown.total >= config.autoPublishScore) {
    status = "ready";
  } else {
    status = "needs_review";
    if (source.trustState !== "trusted") reasons.add("untrusted_source");
  }

  return {
    isMarket: classification.isMarket,
    vendorVerified: vendorBasis !== null,
    locationVerified: location === "verified_in_radius",
    duplicateState: input.duplicateState,
    score: breakdown.total,
    status,
    reasons: [...reasons],
    hardGatesPassed,
    hardGateFailures,
    breakdown,
    classification,
    vendorBasis,
    cancelled,
  };
}
