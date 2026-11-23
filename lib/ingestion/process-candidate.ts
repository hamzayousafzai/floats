import { duplicateStateOf, findDuplicate, type DuplicateMatch } from "@/lib/ingestion/deduplication/match-event";
import { NormalizationError } from "@/lib/ingestion/normalize/normalize-url";
import { type NormalizationIssue, normalizeEventDetailed } from "@/lib/ingestion/normalize/normalize-event";
import type { IngestionClient } from "@/lib/ingestion/storage/client";
import { getCandidateByCanonicalKey, linkObservation, upsertCandidate } from "@/lib/ingestion/storage/candidates";
import type { CandidateRow, SourceRow } from "@/lib/ingestion/storage/rows";
import type { DuplicateState, NormalizedEvent, RawEvent, SourceCoordinates } from "@/lib/ingestion/types";
import { resolveRescrapeStatus } from "./candidate-state";
import { type GeocodeResult, geocodeAddress } from "@/lib/ingestion/validation/geocode";
import { isValidCoordinate } from "@/lib/ingestion/validation/within-radius";
import { type ValidationConfig, type ValidationOutcome, sourceInfoFromRow, validateEvent } from "@/lib/ingestion/validation/validate-event";

export interface ProcessDependencies {
  client: IngestionClient;
  config: ValidationConfig;
  source: SourceRow;
  /** Observation that produced the raw event; linked to the candidate as evidence. */
  observationId?: string | null;
  geocode?: (address: string) => Promise<GeocodeResult | null>;
  now?: () => Date;
}

export type ProcessResult =
  | { kind: "invalid"; reason: string }
  | {
      kind: "candidate";
      candidate: CandidateRow;
      created: boolean;
      /** True when the stored candidate is approved/published/overridden and was left unchanged. */
      preserved: boolean;
      reopened: boolean;
      outcome: ValidationOutcome;
      duplicate: DuplicateMatch | null;
      issues: NormalizationIssue[];
      /** The normalized (and geocoded) event the candidate was built from. */
      event: NormalizedEvent;
    };

/** Source-published coordinates need 4+ decimal places (about 11 m); rounded city centroids prove nothing. */
function hasStreetPrecision(value: number): boolean {
  return (value.toString().split(".")[1] ?? "").length >= 4;
}

/**
 * Coordinates published by the source count as verified only when ALL hold: they were read from structured data attached
 * to the same place as the address, they are valid and precise, and an operator explicitly marked this source's
 * coordinates as reviewed (`configuration.coordinateTrust = "verified"`, set out of band, never by an adapter or the
 * review API). Anything else is ignored, so the candidate stays unresolved and goes to review.
 */
export function verifiedSourceCoordinates(raw: RawEvent, source: Pick<SourceRow, "configuration">): SourceCoordinates | null {
  const c = raw.coordinates;
  if (!c || c.origin !== "jsonld-place-geo" || !raw.address) return null;
  if (source.configuration?.coordinateTrust !== "verified") return null;
  if (!isValidCoordinate(c.latitude, c.longitude)) return null;
  if (!hasStreetPrecision(c.latitude) || !hasStreetPrecision(c.longitude)) return null;
  return c;
}

/**
 * raw -> normalize -> geocode -> duplicate search -> validate/score -> persist candidate and evidence links.
 * Invalid raw data (no title, unusable URL) yields `kind: "invalid"` and writes nothing. Locked candidates keep their
 * status and fields; the observation is still linked as evidence.
 */
export async function processRawEvent(deps: ProcessDependencies, raw: RawEvent): Promise<ProcessResult> {
  const now = (deps.now ?? (() => new Date()))();

  let event: NormalizedEvent;
  let issues: NormalizationIssue[];
  try {
    ({ event, issues } = normalizeEventDetailed(raw, now));
  } catch (error) {
    if (error instanceof NormalizationError) return { kind: "invalid", reason: error.message };
    throw error;
  }

  let locationVerified = false;
  if (event.address) {
    const geocoded = await (deps.geocode ?? ((address: string) => geocodeAddress(address)))(event.address);
    if (geocoded) {
      event = { ...event, latitude: geocoded.latitude, longitude: geocoded.longitude };
      locationVerified = geocoded.verified;
    } else {
      const sourceCoordinates = verifiedSourceCoordinates(raw, deps.source);
      if (sourceCoordinates) {
        event = { ...event, latitude: sourceCoordinates.latitude, longitude: sourceCoordinates.longitude };
        locationVerified = true;
      }
    }
  }

  const existing = await getCandidateByCanonicalKey(deps.client, event.canonicalKey);

  let duplicate: DuplicateMatch | null = null;
  let duplicateState: DuplicateState = "unchecked";
  if (event.startsAt) {
    duplicate = await findDuplicate(deps.client, {
      sourceId: deps.source.id,
      externalEventId: raw.externalEventId,
      canonicalKey: event.canonicalKey,
      sourceUrl: event.sourceUrl,
      title: event.title,
      startsAt: event.startsAt,
      address: event.address,
      venueName: event.venueName,
      organizerName: event.organizerName,
      latitude: event.latitude,
      longitude: event.longitude,
      candidateId: existing?.id ?? null,
      firstSeenAt: existing?.first_seen_at ?? null,
      ownEventId: existing?.published_event_id ?? null,
    });
    duplicateState = duplicateStateOf(duplicate);
  }

  const outcome = validateEvent({
    event,
    issues,
    source: sourceInfoFromRow(deps.source),
    locationVerified,
    duplicateState,
    config: deps.config,
    now,
  });

  const resolution = resolveRescrapeStatus(existing, outcome.status);
  const result = await upsertCandidate(deps.client, {
    primarySourceId: deps.source.id,
    canonicalKey: event.canonicalKey,
    sourceUrl: event.sourceUrl,
    externalEventId: raw.externalEventId,
    title: event.title,
    description: event.description,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    organizerName: event.organizerName,
    venueName: event.venueName,
    address: event.address,
    latitude: event.latitude,
    longitude: event.longitude,
    categorySlugs: event.categorySlugs,
    vendorCount: event.vendorCount,
    vendorEvidence: event.vendorEvidence,
    validationReasons: outcome.reasons,
    score: outcome.score,
    isMarket: outcome.isMarket,
    locationVerified: outcome.locationVerified,
    vendorVerified: outcome.vendorVerified,
    cancelled: outcome.cancelled,
    duplicateState,
    status: resolution.status,
    allowReopen: resolution.reopened,
  });

  if (deps.observationId) {
    await linkObservation(deps.client, result.candidate.id, deps.observationId, "canonical_key");
    // The same event seen elsewhere is extra evidence for the senior candidate, never a second production event.
    if (duplicateState === "confirmed" && duplicate?.candidateId) {
      await linkObservation(deps.client, duplicate.candidateId, deps.observationId, "duplicate_confirmed");
    }
  }

  return { kind: "candidate", ...result, reopened: resolution.reopened, outcome, duplicate, issues, event };
}
