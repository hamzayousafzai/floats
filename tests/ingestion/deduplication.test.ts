/**
 * @jest-environment node
 */
import { MemoryDb } from "./helpers/memory-db";
import { CONFIRMED_THRESHOLD, POSSIBLE_THRESHOLD, compareEvents, duplicateStateOf, findDuplicate, type DuplicateSubject, type MatchSubject } from "@/lib/ingestion/deduplication/match-event";
import { SEARCH_LIMIT } from "@/lib/ingestion/deduplication/production-search";
import { placeSimilarity, sameLocalDate, timeSimilarity, titleSimilarity } from "@/lib/ingestion/deduplication/similarity";
import { generateCanonicalKey } from "@/lib/ingestion/normalize/canonical-key";
import type { IngestionClient } from "@/lib/ingestion/storage/client";

const START = "2031-12-06T15:00:00.000Z";

function subject(overrides: Partial<DuplicateSubject> = {}): DuplicateSubject {
  const base = {
    title: "Winter Makers Market",
    address: "100 Example St, Charlotte, NC 28202",
    venueName: "Example Pavilion",
    startsAt: START,
  };
  return {
    sourceId: "src-1",
    externalEventId: "ext-1",
    canonicalKey: generateCanonicalKey(base),
    sourceUrl: "https://a.example.test/market",
    organizerName: "Example Collective",
    latitude: 35.2271,
    longitude: -80.8431,
    candidateId: null,
    firstSeenAt: null,
    ownEventId: null,
    ...base,
    ...overrides,
  };
}

function plain(overrides: Partial<MatchSubject> = {}): MatchSubject {
  const { candidateId, firstSeenAt, ownEventId, ...rest } = subject();
  void candidateId; void firstSeenAt; void ownEventId;
  return { ...rest, ...overrides };
}

function setup() {
  const db = new MemoryDb();
  return { db, client: db.client() as unknown as IngestionClient };
}

function candidateRow(overrides: Record<string, unknown> = {}) {
  const base = { title: "Winter Makers Market", address: "100 Example St, Charlotte, NC 28202", startsAt: START };
  return {
    primary_source_id: "src-2",
    canonical_key: generateCanonicalKey({ ...base, venueName: null }),
    source_url: "https://b.example.test/x",
    external_event_id: null,
    title: base.title,
    description: null,
    starts_at: base.startsAt,
    ends_at: null,
    organizer_name: null,
    venue_name: null,
    address: base.address,
    latitude: 35.2271,
    longitude: -80.8431,
    status: "needs_review",
    ...overrides,
  };
}

function productionEvent(overrides: Record<string, unknown> = {}) {
  return { title: "Winter Makers Market", address: "100 Example Street, Charlotte", starts_at: START, latitude: 35.2271, longitude: -80.8431, status: "published", ...overrides };
}

describe("similarity primitives", () => {
  it("scores titles by significant tokens", () => {
    expect(titleSimilarity("Makers Market", "Maker's Market!")).toBe(1);
    expect(titleSimilarity("The Winter Makers Market", "Winter Makers Market")).toBe(1);
    expect(titleSimilarity("Charlotte Makers Market", "Makers Market")).toBeCloseTo(0.8, 5);
    expect(titleSimilarity("Makers Market", "Vintage Vinyl Fair")).toBe(0);
    expect(titleSimilarity("", "Makers Market")).toBe(0);
  });

  it("scores place by street, proximity and venue", () => {
    const here = { address: "100 Example St", venueName: null, latitude: 35.2271, longitude: -80.8431 };
    expect(placeSimilarity(here, { ...here, address: "100 EXAMPLE STREET, Charlotte" })).toBe(1);
    expect(placeSimilarity(here, { address: null, venueName: null, latitude: 35.2275, longitude: -80.8431 })).toBe(0.9);
    expect(placeSimilarity(here, { address: null, venueName: null, latitude: 35.2301, longitude: -80.8431 })).toBe(0.5);
    expect(placeSimilarity(here, { address: null, venueName: null, latitude: 35.3, longitude: -80.8431 })).toBe(0);
    expect(placeSimilarity({ ...here, address: null, venueName: "Example Pavilion" }, { ...here, address: null, venueName: "example pavilion", latitude: null, longitude: null })).toBe(0.8);
    expect(placeSimilarity({ address: null, venueName: null, latitude: null, longitude: null }, { address: null, venueName: null, latitude: null, longitude: null })).toBe(0);
  });

  it("compares Eastern dates and start times", () => {
    expect(sameLocalDate("2031-12-07T03:30:00.000Z", "2031-12-06T15:00:00.000Z")).toBe(true);
    expect(sameLocalDate("2031-12-07T05:30:00.000Z", "2031-12-06T15:00:00.000Z")).toBe(false);
    expect(sameLocalDate(null, START)).toBeNull();
    expect(timeSimilarity(START, "2031-12-06T15:45:00.000Z")).toBe(1);
    expect(timeSimilarity(START, "2031-12-06T17:00:00.000Z")).toBe(0.7);
    expect(timeSimilarity(START, "2031-12-06T22:00:00.000Z")).toBe(0.35);
  });
});

describe("compareEvents", () => {
  it("treats the same canonical key or source event id as the same event", () => {
    expect(compareEvents(plain(), plain())).toMatchObject({ confidence: 1, reasons: ["canonical_key"] });
    expect(compareEvents(plain({ canonicalKey: "x" }), plain({ canonicalKey: "y" }))).toMatchObject({ confidence: 1, reasons: ["source_event_id"] });
    expect(compareEvents(plain({ canonicalKey: "x" }), plain({ canonicalKey: "y", externalEventId: "other" })).confidence).toBeGreaterThanOrEqual(CONFIRMED_THRESHOLD);
  });

  it("never matches the same market on a different date", () => {
    const next = plain({ startsAt: "2031-12-13T15:00:00.000Z", canonicalKey: "next" });
    expect(compareEvents(plain(), next)).toEqual({ confidence: 0, reasons: ["different_date"] });
    expect(compareEvents(plain({ canonicalKey: "x" }), plain({ canonicalKey: "x", startsAt: "2031-12-13T15:00:00.000Z" })).confidence).toBe(0);
  });

  it("places similar titles at the same place and time in the possible band, not confirmed", () => {
    const result = compareEvents(plain({ canonicalKey: "a", externalEventId: null }), plain({ canonicalKey: "b", externalEventId: null, title: "Charlotte Winter Makers Market", sourceUrl: null, organizerName: null }));
    expect(result.confidence).toBeGreaterThanOrEqual(POSSIBLE_THRESHOLD);
    expect(result.confidence).toBeLessThan(CONFIRMED_THRESHOLD);
  });

  it("does not match different events that share a venue and time", () => {
    const result = compareEvents(plain({ canonicalKey: "a", externalEventId: null }), plain({ canonicalKey: "b", externalEventId: null, title: "Vintage Vinyl Fair", sourceUrl: null, organizerName: null }));
    expect(result.confidence).toBeLessThan(POSSIBLE_THRESHOLD);
  });

  it("caps matches with an unknown date below the possible threshold", () => {
    const result = compareEvents(plain({ canonicalKey: "a", externalEventId: null, startsAt: null }), plain({ canonicalKey: "b", externalEventId: null }));
    expect(result.confidence).toBeLessThan(POSSIBLE_THRESHOLD);
    expect(result.reasons).toContain("date_unknown");
  });

  it("is symmetric", () => {
    const a = plain({ canonicalKey: "a", externalEventId: null, title: "Holiday Makers Market" });
    const b = plain({ canonicalKey: "b", externalEventId: null, address: "100 Example St", organizerName: null });
    expect(compareEvents(a, b).confidence).toBe(compareEvents(b, a).confidence);
  });
});

describe("findDuplicate", () => {
  it("finds nothing for a new event and never matches the candidate with itself", async () => {
    const { db, client } = setup();
    await expect(findDuplicate(client, subject())).resolves.toBeNull();
    const [self] = db.seed("ingestion.candidates", [candidateRow({ canonical_key: subject().canonicalKey })]);
    await expect(findDuplicate(client, subject({ candidateId: self.id as string }))).resolves.toBeNull();
  });

  it("repeat observation of the same candidate is not a duplicate of itself, nor of its own published event", async () => {
    const { db, client } = setup();
    const [event] = db.seed("public.events", [productionEvent()]);
    const [self] = db.seed("ingestion.candidates", [candidateRow({ canonical_key: subject().canonicalKey, status: "published", published_event_id: event.id })]);
    await expect(findDuplicate(client, subject({ candidateId: self.id as string, ownEventId: event.id as string }))).resolves.toBeNull();
  });

  it("confirms one event reported by two sources when the identity signals agree", async () => {
    const { db, client } = setup();
    const [first] = db.seed("ingestion.candidates", [candidateRow({ canonical_key: "other-key", primary_source_id: "src-1", external_event_id: "ext-1" })]);
    const match = await findDuplicate(client, subject({ canonicalKey: "new-key" }));
    expect(match).toMatchObject({ candidateId: first.id, eventId: null, confidence: 1, reason: "source_event_id", ambiguous: false });
    expect(duplicateStateOf(match)).toBe("confirmed");
  });

  it("flags a manually created production event at the same place and time as a confirmed duplicate", async () => {
    const { db, client } = setup();
    const [event] = db.seed("public.events", [productionEvent()]);
    const match = await findDuplicate(client, subject({ canonicalKey: "new-key", organizerName: null }));
    expect(match).toMatchObject({ eventId: event.id, candidateId: null, reason: "production_event" });
    expect(match?.confidence).toBeGreaterThanOrEqual(CONFIRMED_THRESHOLD);
    expect(duplicateStateOf(match)).toBe("confirmed");
  });

  it("treats similar but not identical production events as possible, which blocks auto-publication", async () => {
    const { db, client } = setup();
    db.seed("public.events", [productionEvent({ title: "Charlotte Winter Makers Market" })]);
    const match = await findDuplicate(client, subject({ canonicalKey: "new-key" }));
    expect(duplicateStateOf(match)).toBe("possible");
    expect(match?.evidence).toEqual(expect.arrayContaining([expect.stringMatching(/^event /), expect.stringMatching(/title_similarity=/)]));
  });

  it("ignores archived events, rejected candidates and other dates", async () => {
    const { db, client } = setup();
    db.seed("public.events", [productionEvent({ status: "archived" }), productionEvent({ starts_at: "2031-12-13T15:00:00.000Z" })]);
    db.seed("ingestion.candidates", [candidateRow({ canonical_key: "rejected", status: "rejected" }), candidateRow({ canonical_key: "next-week", starts_at: "2031-12-13T15:00:00.000Z" })]);
    await expect(findDuplicate(client, subject({ canonicalKey: "new-key" }))).resolves.toBeNull();
  });

  it("recognises a weekly recurrence on a new date as a new event", async () => {
    const { db, client } = setup();
    db.seed("ingestion.candidates", [candidateRow()]);
    db.seed("public.events", [productionEvent()]);
    const nextWeek = "2031-12-13T15:00:00.000Z";
    const key = generateCanonicalKey({ title: "Winter Makers Market", address: "100 Example St, Charlotte, NC 28202", venueName: null, startsAt: nextWeek });
    await expect(findDuplicate(client, subject({ startsAt: nextWeek, canonicalKey: key, externalEventId: null }))).resolves.toBeNull();
  });

  it("reports ambiguity when several records match", async () => {
    const { db, client } = setup();
    db.seed("public.events", [productionEvent({ title: "Charlotte Winter Makers Market" }), productionEvent({ title: "Winter Makers Market Charlotte NC", address: "100 Example St" })]);
    const match = await findDuplicate(client, subject({ canonicalKey: "new-key" }));
    expect(match?.ambiguous).toBe(true);
    expect(match?.confidence).toBeGreaterThanOrEqual(POSSIBLE_THRESHOLD);
  });

  it("avoids counting an imported event and its own candidate as two matches", async () => {
    const { db, client } = setup();
    const [event] = db.seed("public.events", [productionEvent()]);
    db.seed("ingestion.candidates", [candidateRow({ canonical_key: "published-one", status: "published", published_event_id: event.id })]);
    const match = await findDuplicate(client, subject({ canonicalKey: "new-key", externalEventId: null }));
    expect(match?.ambiguous).toBe(false);
    expect(match?.candidateId).toBeTruthy();
  });

  it("does not let two candidates for the same event both become duplicates of each other", async () => {
    const { db, client } = setup();
    const [older] = db.seed("ingestion.candidates", [candidateRow({ canonical_key: "older", first_seen_at: "2031-11-01T00:00:00.000Z", primary_source_id: "src-1", external_event_id: "ext-1" })]);
    const [newer] = db.seed("ingestion.candidates", [candidateRow({ canonical_key: "newer", first_seen_at: "2031-11-02T00:00:00.000Z", primary_source_id: "src-1", external_event_id: "ext-1" })]);
    const olderSubject = subject({ canonicalKey: "older", candidateId: older.id as string, firstSeenAt: older.first_seen_at as string });
    const newerSubject = subject({ canonicalKey: "newer", candidateId: newer.id as string, firstSeenAt: newer.first_seen_at as string });
    await expect(findDuplicate(client, olderSubject)).resolves.toBeNull();
    await expect(findDuplicate(client, newerSubject)).resolves.toMatchObject({ candidateId: older.id });
  });

  it("treats an incomplete search as a possible match", async () => {
    const { db, client } = setup();
    db.seed("public.events", Array.from({ length: SEARCH_LIMIT }, (_, i) => productionEvent({ title: `Unrelated Event ${i}`, address: `${i + 500} Elsewhere Rd` })));
    const match = await findDuplicate(client, subject({ canonicalKey: "new-key" }));
    expect(match).toMatchObject({ reason: "search_incomplete", confidence: POSSIBLE_THRESHOLD });
    expect(duplicateStateOf(match)).toBe("possible");
  });

  it("cannot search undated events and maps no match to clear", async () => {
    const { client } = setup();
    await expect(findDuplicate(client, subject({ startsAt: null }))).resolves.toBeNull();
    expect(duplicateStateOf(null)).toBe("clear");
  });

  it("propagates storage errors instead of reporting no duplicate", async () => {
    const { db, client } = setup();
    db.failNext.push({ key: "public.events", op: "select", error: { code: "XX000", message: "boom" } });
    await expect(findDuplicate(client, subject())).rejects.toThrow(/Failed to search production events/);
  });
});
