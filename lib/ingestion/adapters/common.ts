import type { CollectionResult, RawEvent } from "@/lib/ingestion/types";
import type { CollectionContext, SourceDefinition } from "./types";
import type { SafeFetchResult } from "@/lib/ingestion/security/safe-fetch";

/** Fetch capability injected into adapters. The production implementation is `safeFetch` plus robots checks. */
export interface AdapterDeps {
  fetchPage(url: string, source: SourceDefinition, context: CollectionContext, accept?: string): Promise<SafeFetchResult>;
}

/** Raised by parsers when the document does not have the structure the adapter expects. */
export class ParserStructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParserStructureError";
  }
}

export function collectionFailure(sourceId: string, error: unknown): CollectionResult {
  const message = error instanceof Error ? error.message : String(error);
  return { sourceId, success: false, events: [], discoveredUrls: [], error: message.slice(0, 500) };
}

export function collectionSuccess(sourceId: string, events: RawEvent[], discoveredUrls: string[] = [], warning: string | null = null): CollectionResult {
  return { sourceId, success: true, events, discoveredUrls, error: warning };
}

export function emptyRawEvent(sourceId: string, sourceUrl: string): RawEvent {
  return {
    sourceId,
    externalEventId: null,
    sourceUrl,
    title: null,
    description: null,
    startsAt: null,
    endsAt: null,
    organizerName: null,
    venueName: null,
    address: null,
    vendorCount: null,
    evidence: [],
    categories: [],
    cancelled: false,
    rawPayload: {},
  };
}

export function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

export function resolveUrl(value: unknown, base: string): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const url = new URL(value.trim(), base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

const VENDOR_COUNT_PATTERNS = [
  /\b(\d{1,4})\s*\+?\s*(?:local\s+|handmade\s+|artisan\s+|craft\s+|maker\s+|small[- ]business\s+)?(?:vendors?|makers?|artisans?|exhibitors?|sellers?)\b/i,
  /\b(?:more than|over|up to|featuring)\s+(\d{1,4})\s+(?:\w+\s+)?(?:vendors?|makers?|artisans?|exhibitors?|sellers?)\b/i,
];

/** Extracts an explicitly stated vendor count and the sentence that states it. Never estimates. */
export function extractVendorEvidence(text: string | null): { count: number | null; evidence: string[] } {
  if (!text) return { count: null, evidence: [] };
  for (const pattern of VENDOR_COUNT_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      const count = Number(match[1]);
      if (Number.isSafeInteger(count) && count > 0) {
        const start = Math.max(0, match.index - 40);
        return { count, evidence: [text.slice(start, match.index + match[0].length + 40).replace(/\s+/g, " ").trim()] };
      }
    }
  }
  return { count: null, evidence: [] };
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_NAMES = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const TIME = "(\\d{1,2})(?::(\\d{2}))?\\s*([ap])?\\.?m?\\.?";
const DATE_NAMED = new RegExp(`${MONTH_NAMES}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})`, "i");
const DATE_NUMERIC = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/;
const TIME_RANGE = new RegExp(`${TIME}\\s*(?:-|–|—|to|until)\\s*${TIME}`, "i");
const TIME_SINGLE = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?/i;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toMinutes(hourText: string, minuteText: string | undefined, meridiem: string | undefined): number | null {
  let hour = Number(hourText);
  const minute = minuteText ? Number(minuteText) : 0;
  if (!Number.isInteger(hour) || minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    const pm = meridiem.toLowerCase() === "p";
    hour = hour % 12 + (pm ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }
  return hour * 60 + minute;
}

function localTime(date: string, minutes: number): string {
  return `${date}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00`;
}

/** Parses a single clock time that states am/pm, such as `6:30 PM`. Returns minutes after midnight or null. */
export function parseClockMinutes(text: string | null): number | null {
  const match = text ? TIME_SINGLE.exec(text) : null;
  return match ? toMinutes(match[1], match[2], match[3]) : null;
}

/** Builds a local wall-clock string (no offset) from `YYYY-MM-DD` and minutes after midnight. */
export function localDateTime(date: string, minutes: number): string {
  return localTime(date, minutes);
}

export interface ParsedDateText {
  /** Local wall-clock `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm:ss` with no offset; the zone is decided during normalization. */
  start: string;
  /** Only set when an explicit end time on the same day is stated. */
  end: string | null;
}

/**
 * Deterministic parser for English listing dates. It requires an explicit four digit year and never infers one,
 * never invents an end time, and ignores end times that are not after the start.
 */
export function parseHumanDateRange(text: string | null): ParsedDateText | null {
  if (!text) return null;
  const named = DATE_NAMED.exec(text);
  let year: number;
  let month: number;
  let day: number;
  let consumedEnd: number;
  if (named) {
    month = MONTHS[named[1].toLowerCase().slice(0, named[1].toLowerCase().startsWith("sept") ? 4 : 3)];
    day = Number(named[2]);
    year = Number(named[3]);
    consumedEnd = named.index + named[0].length;
  } else {
    const numeric = DATE_NUMERIC.exec(text);
    if (!numeric) return null;
    month = Number(numeric[1]);
    day = Number(numeric[2]);
    year = Number(numeric[3]);
    consumedEnd = numeric.index + numeric[0].length;
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  const date = `${year}-${pad(month)}-${pad(day)}`;
  const rest = text.slice(consumedEnd);

  const range = TIME_RANGE.exec(rest);
  if (range) {
    const endMeridiem = range[6];
    let startMeridiem = range[3];
    const endMinutes = toMinutes(range[4], range[5], endMeridiem);
    if (endMinutes === null) return { start: date, end: null };
    if (!startMeridiem && endMeridiem) {
      // "10-4pm": same meridiem unless that would put the start after the end, then morning.
      const sameMeridiem = toMinutes(range[1], range[2], endMeridiem);
      startMeridiem = sameMeridiem !== null && sameMeridiem < endMinutes ? endMeridiem : "a";
    }
    const startMinutes = toMinutes(range[1], range[2], startMeridiem);
    if (startMinutes === null) return { start: date, end: null };
    return { start: localTime(date, startMinutes), end: endMinutes > startMinutes ? localTime(date, endMinutes) : null };
  }
  const single = TIME_SINGLE.exec(rest);
  if (single) {
    const minutes = toMinutes(single[1], single[2], single[3]);
    if (minutes !== null) return { start: localTime(date, minutes), end: null };
  }
  return { start: date, end: null };
}
