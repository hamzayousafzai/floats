import { createHash } from "node:crypto";
import { formatInTimeZone } from "date-fns-tz";
import type { NormalizedEvent } from "@/lib/ingestion/types";
import { normalizeAddress, streetKey } from "./normalize-address";

export const INGESTION_TIMEZONE = "America/New_York" as const;

/** Lowercase, accent-free, punctuation-free title for identity only. Cancellation wording never changes identity. */
export function normalizeTitleForKey(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/\b(?:cancell?ed|postponed)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function localDateInNewYork(startsAtIso: string): string {
  return formatInTimeZone(new Date(startsAtIso), INGESTION_TIMEZONE, "yyyy-MM-dd");
}

type KeyInput = Pick<NormalizedEvent, "title" | "address" | "venueName" | "startsAt">;

/**
 * Lowercase SHA-256 hex of `title|address-or-venue|YYYY-MM-DD` (date in America/New_York). The same event always gets
 * the same key and a different date or place gets a different key. `localDate` lets normalization supply the date for
 * events whose instant could not be established (for example an ambiguous local time); `undatedSalt` keeps genuinely
 * undated events distinct instead of merging them into one identity.
 */
export function generateCanonicalKey(event: KeyInput, localDate?: string | null, undatedSalt?: string | null): string {
  const place = streetKey(event.address) ?? normalizeAddress(event.venueName) ?? "";
  const date = localDate ?? (event.startsAt ? localDateInNewYork(event.startsAt) : `undated:${undatedSalt ?? ""}`);
  const material = `${normalizeTitleForKey(event.title)}|${place || "unknown-location"}|${date}`;
  return createHash("sha256").update(material, "utf8").digest("hex");
}
