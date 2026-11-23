export type SourceType = "organizer" | "venue" | "aggregator" | "platform";
export type AdapterType = "jsonld" | "ics" | "html" | "playwright";
export type TrustState = "probation" | "trusted" | "disabled";
export type RunType = "collection" | "discovery" | "replay" | "verification";
export type CandidateStatus =
  | "pending"
  | "validating"
  | "ready"
  | "needs_review"
  | "approved"
  | "rejected"
  | "published";
export type DuplicateState = "unchecked" | "clear" | "possible" | "confirmed";
export type ValidationReason =
  | "invalid_date"
  | "missing_end_time"
  | "outside_horizon"
  | "missing_location"
  | "outside_radius"
  | "insufficient_vendor_evidence"
  | "excluded_event_type"
  | "missing_description"
  | "cancelled"
  | "possible_duplicate"
  | "confirmed_duplicate"
  | "untrusted_source"
  | "source_unavailable"
  | "expired"
  | "incomplete_title"
  | "unclear_event_type";

export interface SourceCoordinates {
  latitude: number;
  longitude: number;
  /** Where the pair was read from. Only structured data attached to the same place as the address qualifies. */
  origin: "jsonld-place-geo";
}

export interface RawEvent {
  sourceId: string;
  externalEventId: string | null;
  sourceUrl: string;
  title: string | null;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
  organizerName: string | null;
  venueName: string | null;
  address: string | null;
  /** Coordinates published by the source next to its address. Unverified unless the source is explicitly trusted for them. */
  coordinates?: SourceCoordinates | null;
  vendorCount: number | null;
  evidence: string[];
  categories: string[];
  cancelled: boolean;
  rawPayload: Record<string, unknown>;
}

export interface NormalizedEvent {
  canonicalKey: string;
  title: string;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
  timezone: "America/New_York";
  organizerName: string | null;
  venueName: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  vendorCount: number | null;
  vendorEvidence: string[];
  categorySlugs: string[];
  cancelled: boolean;
  sourceUrl: string;
}

export interface ValidationResult {
  isMarket: boolean;
  vendorVerified: boolean;
  locationVerified: boolean;
  duplicateState: DuplicateState;
  score: number;
  status: CandidateStatus;
  reasons: ValidationReason[];
}

export interface CollectionResult {
  sourceId: string;
  success: boolean;
  events: RawEvent[];
  discoveredUrls: string[];
  error: string | null;
}

export interface PublicationResult {
  candidateId: string;
  eventId: string | null;
  status: "published" | "shadow" | "blocked";
  reason: string | null;
}
