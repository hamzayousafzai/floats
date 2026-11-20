import { localDateInNewYork, normalizeTitleForKey } from "@/lib/ingestion/normalize/canonical-key";
import { normalizeAddress, streetKey } from "@/lib/ingestion/normalize/normalize-address";
import { distanceMeters, isValidCoordinate } from "@/lib/ingestion/validation/within-radius";

const STOP_WORDS = new Set(["the", "a", "an", "at", "of", "in", "on", "and", "for", "to", "with", "presents", "by"]);

export function titleTokens(title: string | null | undefined): string[] {
  if (!title) return [];
  return [...new Set(normalizeTitleForKey(title).split(" ").filter((token) => token.length > 0 && !STOP_WORDS.has(token)))];
}

/** Sorensen-Dice coefficient over distinct significant title tokens, 0..1. */
export function titleSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const left = titleTokens(a);
  const right = titleTokens(b);
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  const shared = left.filter((token) => rightSet.has(token)).length;
  return (2 * shared) / (left.length + right.length);
}

export interface PlaceFields {
  address: string | null;
  venueName: string | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * 1 for the same street address, 0.9 within 150 m, 0.8 for the same venue name, 0.5 within 500 m, otherwise 0.
 * The best applicable signal wins; missing data never counts as a match.
 */
export function placeSimilarity(a: PlaceFields, b: PlaceFields): number {
  const streetA = streetKey(a.address);
  const streetB = streetKey(b.address);
  if (streetA && streetB && streetA === streetB) return 1;
  let best = 0;
  if (isValidCoordinate(a.latitude, a.longitude) && isValidCoordinate(b.latitude, b.longitude)) {
    const meters = distanceMeters(a.latitude as number, a.longitude as number, b.latitude as number, b.longitude as number);
    if (meters <= 150) best = 0.9;
    else if (meters <= 500) best = 0.5;
  }
  const venueA = normalizeAddress(a.venueName);
  const venueB = normalizeAddress(b.venueName);
  if (venueA && venueB && venueA === venueB) best = Math.max(best, 0.8);
  return best;
}

export function sameLocalDate(startA: string | null, startB: string | null): boolean | null {
  if (!startA || !startB) return null;
  const a = Date.parse(startA);
  const b = Date.parse(startB);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return localDateInNewYork(startA) === localDateInNewYork(startB);
}

/** For events on the same Eastern date: 1 within an hour, 0.7 within three hours, otherwise 0.35. */
export function timeSimilarity(startA: string, startB: string): number {
  const diffMinutes = Math.abs(Date.parse(startA) - Date.parse(startB)) / 60_000;
  if (diffMinutes <= 60) return 1;
  if (diffMinutes <= 180) return 0.7;
  return 0.35;
}

export function sameOrganizer(a: string | null, b: string | null): boolean {
  const left = a ? normalizeTitleForKey(a) : "";
  const right = b ? normalizeTitleForKey(b) : "";
  return left.length > 0 && left === right;
}
