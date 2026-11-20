import type { CandidateStatus, DuplicateState } from "@/lib/ingestion/types";
import { type IngestionClient, UNIQUE_VIOLATION, ingestionDb, throwIfError } from "./client";
import type { CandidateRow } from "./rows";

export interface CandidateUpsertInput {
  primarySourceId: string;
  canonicalKey: string;
  sourceUrl: string;
  externalEventId: string | null;
  title: string;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
  organizerName: string | null;
  venueName: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  categorySlugs: string[];
  vendorCount: number | null;
  vendorEvidence: string[];
  validationReasons: string[];
  score: number;
  isMarket: boolean;
  locationVerified: boolean;
  vendorVerified: boolean;
  cancelled: boolean;
  duplicateState: DuplicateState;
  status: CandidateStatus;
  /** A rejected candidate is re-opened only when the caller has material new evidence. */
  allowReopen?: boolean;
}

export interface CandidateUpsertResult {
  candidate: CandidateRow;
  created: boolean;
  /** True when the stored candidate is approved, published or manually overridden and only `last_seen_at` moved. */
  preserved: boolean;
}

export function isProtectedCandidate(candidate: Pick<CandidateRow, "manual_override" | "status">): boolean {
  return candidate.manual_override || candidate.status === "approved" || candidate.status === "published";
}

export async function getCandidateById(client: IngestionClient, id: string): Promise<CandidateRow | null> {
  const { data, error } = await ingestionDb(client).from("candidates").select("*").eq("id", id).maybeSingle();
  throwIfError("Failed to load candidate", error);
  return (data as CandidateRow | null) ?? null;
}

export async function getCandidateByCanonicalKey(client: IngestionClient, canonicalKey: string): Promise<CandidateRow | null> {
  const { data, error } = await ingestionDb(client).from("candidates").select("*").eq("canonical_key", canonicalKey).maybeSingle();
  throwIfError("Failed to load candidate", error);
  return (data as CandidateRow | null) ?? null;
}

function toRow(input: CandidateUpsertInput) {
  return {
    primary_source_id: input.primarySourceId,
    canonical_key: input.canonicalKey,
    source_url: input.sourceUrl,
    external_event_id: input.externalEventId,
    title: input.title,
    description: input.description,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    organizer_name: input.organizerName,
    venue_name: input.venueName,
    address: input.address,
    latitude: input.latitude,
    longitude: input.longitude,
    category_slugs: input.categorySlugs,
    vendor_count: input.vendorCount,
    vendor_evidence: input.vendorEvidence,
    validation_reasons: input.validationReasons,
    score: Math.min(100, Math.max(0, Math.trunc(input.score))),
    is_market: input.isMarket,
    location_verified: input.locationVerified,
    vendor_verified: input.vendorVerified,
    cancelled: input.cancelled,
    duplicate_state: input.duplicateState,
    status: input.status,
  };
}

async function touchLastSeen(client: IngestionClient, id: string): Promise<CandidateRow> {
  const { data, error } = await ingestionDb(client)
    .from("candidates")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  throwIfError("Failed to update candidate", error);
  return data as CandidateRow;
}

/**
 * Candidate identity is `canonical_key`. A repeat observation never resets approved or published state and
 * never overwrites manually overridden candidates: only `last_seen_at` changes in those cases.
 */
export async function upsertCandidate(client: IngestionClient, input: CandidateUpsertInput): Promise<CandidateUpsertResult> {
  const existing = await getCandidateByCanonicalKey(client, input.canonicalKey);
  if (existing) return updateExisting(client, existing, input);

  const { data, error } = await ingestionDb(client).from("candidates").insert(toRow(input)).select("*").single();
  if (error?.code === UNIQUE_VIOLATION) {
    const raced = await getCandidateByCanonicalKey(client, input.canonicalKey);
    if (raced) return updateExisting(client, raced, input);
  }
  throwIfError("Failed to create candidate", error);
  return { candidate: data as CandidateRow, created: true, preserved: false };
}

async function updateExisting(client: IngestionClient, existing: CandidateRow, input: CandidateUpsertInput): Promise<CandidateUpsertResult> {
  if (isProtectedCandidate(existing)) {
    return { candidate: await touchLastSeen(client, existing.id), created: false, preserved: true };
  }
  const row: Record<string, unknown> = { ...toRow(input) };
  delete row.canonical_key;
  delete row.primary_source_id;
  if (existing.status === "rejected" && !input.allowReopen) row.status = "rejected";
  row.last_seen_at = new Date().toISOString();
  row.updated_at = row.last_seen_at;
  // Compare-and-swap on the state we read: a concurrent approval/publication wins and this write is skipped.
  const { data, error } = await ingestionDb(client)
    .from("candidates")
    .update(row)
    .eq("id", existing.id)
    .eq("status", existing.status)
    .eq("manual_override", false)
    .select("*");
  throwIfError("Failed to update candidate", error);
  const updated = ((data ?? []) as CandidateRow[])[0];
  if (!updated) {
    const current = await getCandidateById(client, existing.id);
    if (!current) throw new Error("Candidate disappeared during update");
    return { candidate: await touchLastSeen(client, current.id), created: false, preserved: true };
  }
  return { candidate: updated, created: false, preserved: false };
}

/** Links an observation to a candidate as evidence; repeating the same link is a no-op. */
export async function linkObservation(client: IngestionClient, candidateId: string, observationId: string, matchReason: string): Promise<void> {
  const { error } = await ingestionDb(client)
    .from("candidate_sources")
    .upsert({ candidate_id: candidateId, observation_id: observationId, match_reason: matchReason }, { onConflict: "candidate_id,observation_id", ignoreDuplicates: true });
  throwIfError("Failed to link observation", error);
}

export interface CandidateSourceLink {
  source_url: string;
  match_reason: string;
}

export async function listCandidateSources(client: IngestionClient, candidateId: string): Promise<CandidateSourceLink[]> {
  const { data, error } = await ingestionDb(client)
    .from("candidate_sources")
    .select("match_reason, observations(source_url)")
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: true });
  throwIfError("Failed to list candidate evidence", error);
  return ((data ?? []) as unknown as { match_reason: string; observations: { source_url: string } | { source_url: string }[] | null }[]).map((row) => {
    const observation = Array.isArray(row.observations) ? row.observations[0] : row.observations;
    return { source_url: observation?.source_url ?? "", match_reason: row.match_reason };
  });
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

export interface CandidateCursor {
  updated_at: string;
  id: string;
}

export function encodeCursor(cursor: CandidateCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** Returns null for anything that is not a well-formed `(updated_at, id)` cursor. */
export function decodeCursor(value: string): CandidateCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<CandidateCursor>;
    if (typeof parsed.id !== "string" || !UUID_PATTERN.test(parsed.id)) return null;
    if (typeof parsed.updated_at !== "string" || !ISO_TIMESTAMP.test(parsed.updated_at)) return null;
    const time = new Date(parsed.updated_at);
    if (Number.isNaN(time.getTime())) return null;
    return { updated_at: time.toISOString(), id: parsed.id.toLowerCase() };
  } catch {
    return null;
  }
}

export interface ListCandidatesOptions {
  status?: CandidateStatus;
  limit?: number;
  cursor?: string | null;
}

export interface ListCandidatesResult {
  rows: CandidateRow[];
  nextCursor: string | null;
}

export class InvalidCursorError extends Error {
  constructor() {
    super("Invalid cursor");
    this.name = "InvalidCursorError";
  }
}

/** Keyset pagination ordered by `(updated_at, id)` descending; no offsets. */
export async function listCandidates(client: IngestionClient, options: ListCandidatesOptions = {}): Promise<ListCandidatesResult> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 25), 1), 100);
  let query = ingestionDb(client).from("candidates").select("*");
  if (options.status) query = query.eq("status", options.status);
  if (options.cursor) {
    const cursor = decodeCursor(options.cursor);
    if (!cursor) throw new InvalidCursorError();
    // Both values were validated above (ISO timestamp, UUID), so interpolating them is safe.
    query = query.or(`updated_at.lt.${cursor.updated_at},and(updated_at.eq.${cursor.updated_at},id.lt.${cursor.id})`);
  }
  const { data, error } = await query.order("updated_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
  throwIfError("Failed to list candidates", error);
  const all = (data ?? []) as CandidateRow[];
  const rows = all.slice(0, limit);
  const last = rows[rows.length - 1];
  const nextCursor = all.length > limit && last ? encodeCursor({ updated_at: last.updated_at, id: last.id }) : null;
  return { rows, nextCursor };
}
