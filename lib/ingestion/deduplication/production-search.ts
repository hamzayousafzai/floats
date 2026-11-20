import { type IngestionClient, ingestionDb, throwIfError } from "@/lib/ingestion/storage/client";
import type { CandidateRow } from "@/lib/ingestion/storage/rows";

const WINDOW_MS = 36 * 60 * 60 * 1000;
/** Upper bound per search. A full page is treated as "possibly incomplete" by callers, which blocks auto-publication. */
export const SEARCH_LIMIT = 500;

export interface ProductionEvent {
  id: string;
  title: string | null;
  address: string | null;
  starts_at: string;
  latitude: number | null;
  longitude: number | null;
  status: string | null;
}

export interface WindowSearch<T> {
  rows: T[];
  /** True when the result reached `SEARCH_LIMIT`, so matches may be missing. */
  truncated: boolean;
}

function window(startsAt: string): { from: string; to: string } {
  const start = Date.parse(startsAt);
  if (Number.isNaN(start)) throw new RangeError("startsAt must be an ISO timestamp");
  return { from: new Date(start - WINDOW_MS).toISOString(), to: new Date(start + WINDOW_MS).toISOString() };
}

/**
 * Every production event near the start time, including manually created ones. Archived events are ignored, as in the
 * publisher's SQL check. Imported events appear here too; callers skip the candidate's own event.
 */
export async function searchProductionEvents(client: IngestionClient, startsAt: string): Promise<WindowSearch<ProductionEvent>> {
  const { from, to } = window(startsAt);
  const { data, error } = await client
    .from("events")
    .select("id,title,address,starts_at,latitude,longitude,status")
    .gte("starts_at", from)
    .lte("starts_at", to)
    .order("starts_at", { ascending: true })
    .limit(SEARCH_LIMIT);
  throwIfError("Failed to search production events", error);
  const rows = ((data ?? []) as ProductionEvent[]).filter((row) => row.status !== "archived");
  return { rows, truncated: (data ?? []).length >= SEARCH_LIMIT };
}

/** Non-rejected candidates near the start time; a rejected candidate is not evidence that an event exists. */
export async function searchCandidatesInWindow(client: IngestionClient, startsAt: string): Promise<WindowSearch<CandidateRow>> {
  const { from, to } = window(startsAt);
  const { data, error } = await ingestionDb(client)
    .from("candidates")
    .select("*")
    .gte("starts_at", from)
    .lte("starts_at", to)
    .neq("status", "rejected")
    .order("starts_at", { ascending: true })
    .limit(SEARCH_LIMIT);
  throwIfError("Failed to search candidates", error);
  const rows = (data ?? []) as CandidateRow[];
  return { rows, truncated: rows.length >= SEARCH_LIMIT };
}
