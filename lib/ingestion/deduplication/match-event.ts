import type { IngestionClient } from "@/lib/ingestion/storage/client";
import type { CandidateRow } from "@/lib/ingestion/storage/rows";
import type { DuplicateState } from "@/lib/ingestion/types";
import { searchCandidatesInWindow, searchProductionEvents } from "./production-search";
import { sameLocalDate, sameOrganizer, placeSimilarity, timeSimilarity, titleSimilarity } from "./similarity";

/** Heuristic thresholds from the spec; they are not statistically calibrated probabilities. */
export const CONFIRMED_THRESHOLD = 0.95;
export const POSSIBLE_THRESHOLD = 0.75;

export interface MatchSubject {
  sourceId: string | null;
  externalEventId: string | null;
  canonicalKey: string | null;
  sourceUrl: string | null;
  title: string;
  startsAt: string | null;
  address: string | null;
  venueName: string | null;
  organizerName: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface Comparison {
  confidence: number;
  reasons: string[];
}

const fixed = (value: number) => value.toFixed(2);

/**
 * Symmetric comparison of two events. Different Eastern calendar dates are always different instances (a weekly
 * market on a new date is a new event). Identity signals (canonical key, source event id) give 1.0; otherwise the
 * score is 45 title + 30 place + 20 start time + 5 organizer, out of 100.
 */
export function compareEvents(a: MatchSubject, b: MatchSubject): Comparison {
  const sameDay = sameLocalDate(a.startsAt, b.startsAt);
  if (sameDay === false) return { confidence: 0, reasons: ["different_date"] };

  if (a.canonicalKey && a.canonicalKey === b.canonicalKey) return { confidence: sameDay === null ? 0.5 : 1, reasons: ["canonical_key"] };
  if (a.sourceId && a.sourceId === b.sourceId && a.externalEventId && a.externalEventId === b.externalEventId) {
    return { confidence: sameDay === null ? 0.5 : 1, reasons: ["source_event_id"] };
  }

  const title = titleSimilarity(a.title, b.title);
  const place = placeSimilarity(a, b);
  const reasons = [`title_similarity=${fixed(title)}`, `place_similarity=${fixed(place)}`];
  let points = title * 45 + place * 30;
  if (sameDay === null) {
    reasons.push("date_unknown");
    return { confidence: Math.min(0.5, Math.round(points) / 100), reasons };
  }
  const time = timeSimilarity(a.startsAt as string, b.startsAt as string);
  points += time * 20;
  reasons.push(`time_similarity=${fixed(time)}`);
  if (sameOrganizer(a.organizerName, b.organizerName)) {
    points += 5;
    reasons.push("same_organizer");
  }
  let confidence = Math.round(points) / 100;
  if (a.sourceUrl && a.sourceUrl === b.sourceUrl && title >= POSSIBLE_THRESHOLD) {
    confidence = Math.max(confidence, CONFIRMED_THRESHOLD);
    reasons.push("same_url");
  }
  return { confidence, reasons };
}

export interface DuplicateSubject extends MatchSubject {
  /** The candidate being checked, if it already exists; it is never its own duplicate. */
  candidateId: string | null;
  /** When the candidate was first seen; null for a brand new candidate (everything else is senior). */
  firstSeenAt: string | null;
  /** The production event this candidate already published, if any. */
  ownEventId: string | null;
}

export interface DuplicateMatch {
  candidateId: string | null;
  eventId: string | null;
  confidence: number;
  reason: string;
  evidence: string[];
  /** More than one distinct record reached the possible threshold. */
  ambiguous: boolean;
}

function candidateSubject(row: CandidateRow): MatchSubject {
  return {
    sourceId: row.primary_source_id,
    externalEventId: row.external_event_id,
    canonicalKey: row.canonical_key,
    sourceUrl: row.source_url,
    title: row.title,
    startsAt: row.starts_at,
    address: row.address,
    venueName: row.venue_name,
    organizerName: row.organizer_name,
    latitude: row.latitude,
    longitude: row.longitude,
  };
}

/**
 * Two candidates for the same event must not both be rejected as each other's duplicate. Only a senior candidate
 * counts: approved or published ones, and otherwise the one first seen earlier (id breaks exact ties).
 */
function isSenior(target: CandidateRow, subject: DuplicateSubject): boolean {
  if (target.status === "approved" || target.status === "published" || target.published_event_id) return true;
  if (!subject.firstSeenAt) return true;
  const mine = Date.parse(subject.firstSeenAt);
  const theirs = Date.parse(target.first_seen_at);
  if (theirs !== mine) return theirs < mine;
  return subject.candidateId !== null && target.id < subject.candidateId;
}

/**
 * Finds the strongest existing match among other candidates and all production events (including manual ones).
 * Returns null when nothing reaches the possible threshold. An incomplete search is reported as a possible match so
 * that it blocks automatic publication. Undated subjects cannot be searched: callers keep them `unchecked`.
 */
export async function findDuplicate(client: IngestionClient, subject: DuplicateSubject): Promise<DuplicateMatch | null> {
  if (!subject.startsAt || Number.isNaN(Date.parse(subject.startsAt))) return null;

  const [candidates, production] = await Promise.all([searchCandidatesInWindow(client, subject.startsAt), searchProductionEvents(client, subject.startsAt)]);

  const matches: DuplicateMatch[] = [];
  const coveredEvents = new Set<string>(subject.ownEventId ? [subject.ownEventId] : []);

  for (const row of candidates.rows) {
    if (row.published_event_id) coveredEvents.add(row.published_event_id);
    if (row.id === subject.candidateId || row.canonical_key === subject.canonicalKey) continue;
    if (!isSenior(row, subject)) continue;
    const { confidence, reasons } = compareEvents(subject, candidateSubject(row));
    if (confidence >= POSSIBLE_THRESHOLD) {
      matches.push({ candidateId: row.id, eventId: row.published_event_id, confidence, reason: reasons[0] ?? "similar", evidence: [`candidate ${row.id}`, ...reasons], ambiguous: false });
    }
  }

  for (const event of production.rows) {
    if (coveredEvents.has(event.id)) continue;
    const { confidence, reasons } = compareEvents(subject, {
      sourceId: null,
      externalEventId: null,
      canonicalKey: null,
      sourceUrl: null,
      title: event.title ?? "",
      startsAt: event.starts_at,
      address: event.address,
      venueName: null,
      organizerName: null,
      latitude: event.latitude,
      longitude: event.longitude,
    });
    if (confidence >= POSSIBLE_THRESHOLD) {
      matches.push({ candidateId: null, eventId: event.id, confidence, reason: "production_event", evidence: [`event ${event.id}`, ...reasons], ambiguous: false });
    }
  }

  if (matches.length === 0) {
    if (candidates.truncated || production.truncated) {
      return { candidateId: null, eventId: null, confidence: POSSIBLE_THRESHOLD, reason: "search_incomplete", evidence: ["search reached its result limit"], ambiguous: false };
    }
    return null;
  }
  matches.sort((x, y) => y.confidence - x.confidence || Number(Boolean(y.eventId)) - Number(Boolean(x.eventId)));
  const best = matches[0];
  return { ...best, ambiguous: matches.length > 1 || candidates.truncated || production.truncated };
}

/** `confirmed` only at >= 0.95; any other match is `possible`, so uncertainty blocks automatic publication. */
export function duplicateStateOf(match: DuplicateMatch | null): DuplicateState {
  if (!match) return "clear";
  return match.confidence >= CONFIRMED_THRESHOLD ? "confirmed" : "possible";
}
