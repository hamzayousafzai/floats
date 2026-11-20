/**
 * Ownership rules for events that ingestion published (spec section 7). Only `management_state = 'ingestion'` events may
 * be changed by automation. The SQL function `ingestion.update_imported_event` enforces these rules transactionally;
 * the helpers here let callers plan work and explain outcomes without any database round trip.
 */

export type ManagementState = "ingestion" | "manual" | "claimed";

/** The only event fields automation may change. Everything else (status, org/vendor/market/series, media...) is never touched. */
export const UPDATABLE_FIELDS = ["title", "description", "startsAt", "endsAt", "address", "latitude", "longitude"] as const;
export type UpdatableField = (typeof UPDATABLE_FIELDS)[number];

export type VerifiedChanges = Partial<{
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  address: string;
  latitude: number;
  longitude: number;
}>;

/** Column names used by the SQL function. */
const COLUMN: Record<UpdatableField, string> = {
  title: "title",
  description: "description",
  startsAt: "starts_at",
  endsAt: "ends_at",
  address: "address",
  latitude: "latitude",
  longitude: "longitude",
};

export function canAutomateUpdate(state: ManagementState): boolean {
  return state === "ingestion";
}

export interface OwnershipSnapshot {
  management_state: ManagementState;
  org_id?: string | null;
  vendor_id?: string | null;
  market_id?: string | null;
  series_id?: string | null;
}

/** A relationship set by a host or administrator means the event is no longer owned by ingestion. */
export function isHostOwned(event: Pick<OwnershipSnapshot, "org_id" | "vendor_id" | "market_id" | "series_id">): boolean {
  return Boolean(event.org_id || event.vendor_id || event.market_id || event.series_id);
}

export function ownershipOf(snapshot: OwnershipSnapshot): ManagementState {
  if (snapshot.management_state !== "ingestion") return snapshot.management_state;
  return isHostOwned(snapshot) ? "claimed" : "ingestion";
}

export class InvalidChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidChangeError";
  }
}

const MAX_TEXT = 10_000;

/**
 * Validates and converts verified changes to the snake_case jsonb payload. Unknown keys are rejected rather than
 * dropped so a bug cannot silently pass an unexpected field (the SQL function rejects them as well).
 */
export function toChangePayload(changes: VerifiedChanges): Record<string, string | number> {
  const payload: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(changes as Record<string, unknown>)) {
    if (value === undefined) continue;
    if (!(UPDATABLE_FIELDS as readonly string[]).includes(key)) throw new InvalidChangeError(`Unsupported change field: ${key}`);
    const column = COLUMN[key as UpdatableField];
    if (key === "latitude" || key === "longitude") {
      if (typeof value !== "number" || !Number.isFinite(value)) throw new InvalidChangeError(`${key} must be a finite number`);
      payload[column] = value;
    } else if (key === "startsAt" || key === "endsAt") {
      if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new InvalidChangeError(`${key} must be an ISO timestamp`);
      payload[column] = new Date(value).toISOString();
    } else {
      if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_TEXT) throw new InvalidChangeError(`${key} must be a non-empty string`);
      payload[column] = value.trim();
    }
  }
  return payload;
}

export type FetchOutcome = "ok" | "not_found" | "error" | "robots_denied";

export interface SourceChangeInput {
  /** What happened when the source was fetched this run. */
  fetchOutcome: FetchOutcome;
  /** True only when the event itself was found on a successfully fetched page. */
  eventPresent: boolean;
  /** The adapter's explicit cancellation signal for this event. */
  cancelled: boolean;
  /** The text on the source that states the cancellation. Required as evidence. */
  cancellationText: string | null;
  changes?: VerifiedChanges;
}

export type SourceChangePlan =
  | { action: "none"; reason: "source_unreachable" | "event_missing_not_cancellation" | "no_changes" }
  | { action: "update"; changes: VerifiedChanges }
  | { action: "archive"; evidence: string };

const MIN_EVIDENCE = 10;

/**
 * Archival needs explicit, quoted cancellation on a page that was fetched successfully. A 404, an error, a robots
 * denial, a timeout or an event that merely vanished from a listing never cancels anything (spec 7 and 9).
 */
export function planSourceChange(input: SourceChangeInput): SourceChangePlan {
  if (input.fetchOutcome !== "ok") return { action: "none", reason: "source_unreachable" };
  if (!input.eventPresent) return { action: "none", reason: "event_missing_not_cancellation" };
  const evidence = input.cancellationText?.trim() ?? "";
  if (input.cancelled && evidence.length >= MIN_EVIDENCE) return { action: "archive", evidence: evidence.slice(0, 1000) };
  const changes = input.changes ?? {};
  return Object.values(changes).some((v) => v !== undefined) ? { action: "update", changes } : { action: "none", reason: "no_changes" };
}
