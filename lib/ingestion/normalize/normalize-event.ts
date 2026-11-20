import * as cheerio from "cheerio";
import { formatInTimeZone, fromZonedTime, getTimezoneOffset } from "date-fns-tz";
import type { NormalizedEvent, RawEvent } from "@/lib/ingestion/types";
import { INGESTION_TIMEZONE, generateCanonicalKey } from "./canonical-key";
import { NormalizationError, normalizeSourceUrl } from "./normalize-url";

export type NormalizationIssue =
  | "missing_start"
  | "date_only"
  | "unparseable_start"
  | "ambiguous_local_time"
  | "nonexistent_local_time"
  | "unparseable_end"
  | "end_not_after_start";

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\u2060\uFEFF]/g;
const MAX_DESCRIPTION = 8000;
const MAX_EVIDENCE_ITEMS = 10;
const MAX_EVIDENCE_LENGTH = 300;

function stripMarkup(value: string): string {
  if (!/[<&]/.test(value)) return value;
  const spaced = value.replace(/<(?:br|\/p|\/li|\/div|\/h[1-6]|\/tr)\b[^>]*>/gi, "\n").replace(/<li\b[^>]*>/gi, "\n");
  const $ = cheerio.load(`<body>${spaced}</body>`);
  $("script, style, noscript, template, iframe, object").remove();
  return $("body").text();
}

export function cleanDisplayText(value: string | null | undefined, multiline = false): string | null {
  if (typeof value !== "string") return null;
  const stripped = stripMarkup(value).normalize("NFC").replace(CONTROL_CHARS, "").replace(/\u00A0/g, " ");
  const text = multiline
    ? stripped.replace(/[ \t\f\v]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim()
    : stripped.replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

const LOCAL_OR_OFFSET = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i;

interface ParsedInstant {
  /** UTC instant, or null when the value has no usable instant. */
  instant: Date | null;
  /** Calendar date as written (local) or in America/New_York for absolute instants. */
  localDate: string | null;
  issue: NormalizationIssue | null;
}

function validCalendar(y: number, m: number, d: number, h = 0, mi = 0, s = 0): boolean {
  const probe = new Date(Date.UTC(y, m - 1, d, h, mi, s));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d && h < 24 && mi < 60 && s < 60;
}

function offsetMinutes(token: string): number {
  if (token.toUpperCase() === "Z") return 0;
  const sign = token[0] === "-" ? -1 : 1;
  const digits = token.slice(1).replace(":", "");
  return sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
}

/** Resolves a wall-clock string in America/New_York, rejecting nonexistent (spring forward) and ambiguous (fall back) times. */
function resolveNewYorkWallTime(local: string): { instant: Date | null; issue: NormalizationIssue | null } {
  const wallAsUtc = Date.parse(`${local}Z`);
  const offsets = new Set([getTimezoneOffset(INGESTION_TIMEZONE, new Date(wallAsUtc - 86_400_000)), getTimezoneOffset(INGESTION_TIMEZONE, new Date(wallAsUtc + 86_400_000))]);
  const candidates = [...offsets]
    .map((offset) => new Date(wallAsUtc - offset))
    .filter((instant) => formatInTimeZone(instant, INGESTION_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss") === local);
  if (candidates.length === 0) return { instant: null, issue: "nonexistent_local_time" };
  if (candidates.length > 1 && new Set(candidates.map((c) => c.getTime())).size > 1) return { instant: null, issue: "ambiguous_local_time" };
  return { instant: fromZonedTime(local, INGESTION_TIMEZONE), issue: null };
}

function parseInstant(value: string | null, unparseable: NormalizationIssue): ParsedInstant {
  if (value === null || value.trim() === "") return { instant: null, localDate: null, issue: null };
  const match = LOCAL_OR_OFFSET.exec(value.trim());
  if (!match) return { instant: null, localDate: null, issue: unparseable };
  const [, ys, ms, ds, hs, mis, ss, zone] = match;
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  if (!validCalendar(y, m, d, Number(hs ?? 0), Number(mis ?? 0), Number(ss ?? 0))) return { instant: null, localDate: null, issue: unparseable };
  const day = `${ys}-${ms}-${ds}`;
  if (hs === undefined) return { instant: null, localDate: day, issue: "date_only" };
  const local = `${day}T${hs}:${mis}:${ss ?? "00"}`;
  if (zone) {
    const instant = new Date(Date.parse(`${local}Z`) - offsetMinutes(zone) * 60_000);
    return { instant, localDate: formatInTimeZone(instant, INGESTION_TIMEZONE, "yyyy-MM-dd"), issue: null };
  }
  const resolved = resolveNewYorkWallTime(local);
  return { instant: resolved.instant, localDate: day, issue: resolved.issue };
}

function slug(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export interface DetailedNormalization {
  event: NormalizedEvent;
  issues: NormalizationIssue[];
}

/**
 * Normalizes without mutating the input. Missing or unusable values stay null and are reported as issues rather than
 * guessed. Local times without an offset are interpreted as America/New_York; ambiguous or nonexistent local times
 * produce a null instant. `now` is accepted for contract compatibility; normalization itself is time independent.
 */
export function normalizeEventDetailed(raw: RawEvent, now: Date): DetailedNormalization {
  void now;
  const title = cleanDisplayText(raw.title);
  if (!title) throw new NormalizationError("Event has no title");
  let sourceUrl: string;
  try {
    sourceUrl = normalizeSourceUrl(raw.sourceUrl);
  } catch (error) {
    throw new NormalizationError(`Event has an invalid source URL: ${error instanceof Error ? error.message : "invalid"}`);
  }

  const issues: NormalizationIssue[] = [];
  const start = parseInstant(raw.startsAt, "unparseable_start");
  if (raw.startsAt === null || raw.startsAt.trim() === "") issues.push("missing_start");
  else if (start.issue) issues.push(start.issue);

  const end = parseInstant(raw.endsAt, "unparseable_end");
  let endsAt: Date | null = end.instant;
  if (end.issue && end.issue !== "date_only") issues.push("unparseable_end");
  if (endsAt && start.instant && endsAt.getTime() <= start.instant.getTime()) {
    issues.push("end_not_after_start");
    endsAt = null;
  }
  if (endsAt && !start.instant) endsAt = null;

  const evidence: string[] = [];
  for (const item of raw.evidence) {
    const cleaned = cleanDisplayText(item);
    if (cleaned && !evidence.includes(cleaned.slice(0, MAX_EVIDENCE_LENGTH))) evidence.push(cleaned.slice(0, MAX_EVIDENCE_LENGTH));
    if (evidence.length >= MAX_EVIDENCE_ITEMS) break;
  }
  const categories = [...new Set(raw.categories.map((c) => slug(cleanDisplayText(c) ?? "")).filter(Boolean))];
  const description = cleanDisplayText(raw.description, true);

  const base = {
    title,
    address: cleanDisplayText(raw.address),
    venueName: cleanDisplayText(raw.venueName),
    startsAt: start.instant ? start.instant.toISOString() : null,
  };
  const event: NormalizedEvent = {
    canonicalKey: generateCanonicalKey(base, start.localDate, raw.startsAt ?? ""),
    title,
    description: description ? description.slice(0, MAX_DESCRIPTION) : null,
    startsAt: base.startsAt,
    endsAt: endsAt ? endsAt.toISOString() : null,
    timezone: INGESTION_TIMEZONE,
    organizerName: cleanDisplayText(raw.organizerName),
    venueName: base.venueName,
    address: base.address,
    latitude: null,
    longitude: null,
    vendorCount: Number.isSafeInteger(raw.vendorCount) && (raw.vendorCount as number) >= 0 ? raw.vendorCount : null,
    vendorEvidence: evidence,
    categorySlugs: categories,
    cancelled: raw.cancelled === true,
    sourceUrl,
  };
  return { event, issues };
}

export function normalizeEvent(raw: RawEvent, now: Date): NormalizedEvent {
  return normalizeEventDetailed(raw, now).event;
}
