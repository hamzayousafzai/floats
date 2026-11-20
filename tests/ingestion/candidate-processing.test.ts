/**
 * @jest-environment node
 */
import { MemoryDb } from "./helpers/memory-db";
import { CANDIDATE_TRANSITIONS, InvalidTransitionError, assertTransition, canTransition, isTerminalStatus, resolveRescrapeStatus } from "@/lib/ingestion/candidate-state";
import { normalizeEvent } from "@/lib/ingestion/normalize/normalize-event";
import { processRawEvent, type ProcessDependencies } from "@/lib/ingestion/process-candidate";
import type { IngestionClient } from "@/lib/ingestion/storage/client";
import type { CandidateRow, SourceRow } from "@/lib/ingestion/storage/rows";
import type { CandidateStatus, RawEvent } from "@/lib/ingestion/types";

const NOW = new Date("2031-11-20T12:00:00Z");
const CONFIG = { centerLat: 35.2271, centerLng: -80.8431, radiusMiles: 35, horizonDays: 60, minVendorCount: 3, autoPublishScore: 90, reviewScore: 70 };
const GEO = { latitude: 35.2271, longitude: -80.8431, formattedAddress: "x", provider: "mock", verified: true };

function raw(overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    sourceId: "src",
    externalEventId: "ext-1",
    sourceUrl: "https://a.example.test/events/market",
    title: "Example Winter Makers Market",
    description: "Shop with more than forty local makers and artists.",
    startsAt: "2031-12-06T10:00:00",
    endsAt: "2031-12-06T16:00:00",
    organizerName: "Example Collective",
    venueName: "Example Pavilion",
    address: "100 Example St, Charlotte, NC 28202",
    vendorCount: 45,
    evidence: ["45 local vendors"],
    categories: [],
    cancelled: false,
    rawPayload: {},
    ...overrides,
  };
}

function setup(sourceOverrides: Record<string, unknown> = {}) {
  const db = new MemoryDb();
  const [source] = db.seed("ingestion.sources", [
    { name: "A", base_url: "https://a.example.test", source_type: "organizer", adapter: "html", trust_state: "trusted", successful_runs: 10, valid_events: 30, ...sourceOverrides },
  ]);
  const deps = (overrides: Partial<ProcessDependencies> = {}): ProcessDependencies => ({
    client: db.client() as unknown as IngestionClient,
    config: CONFIG,
    source: source as unknown as SourceRow,
    geocode: async () => GEO,
    now: () => NOW,
    ...overrides,
  });
  const candidates = () => db.rows("ingestion.candidates") as unknown as CandidateRow[];
  return { db, source, deps, candidates };
}

describe("processRawEvent", () => {
  it("creates a ready candidate from a trusted, verified, complete market and links the observation", async () => {
    const { db, deps, candidates } = setup();
    const result = await processRawEvent(deps({ observationId: "obs-1" }), raw());
    expect(result.kind).toBe("candidate");
    if (result.kind !== "candidate") return;
    expect(result).toMatchObject({ created: true, preserved: false, reopened: false });
    expect(result.candidate).toMatchObject({ status: "ready", is_market: true, vendor_verified: true, location_verified: true, duplicate_state: "clear", validation_reasons: [], latitude: 35.2271 });
    expect(result.candidate.score).toBeGreaterThanOrEqual(90);
    expect(candidates()).toHaveLength(1);
    expect(db.rows("ingestion.candidate_sources")).toEqual([expect.objectContaining({ candidate_id: result.candidate.id, observation_id: "obs-1", match_reason: "canonical_key" })]);
  });

  it("sends probation sources to review and persists reason codes", async () => {
    const { deps } = setup({ trust_state: "probation", successful_runs: 0, valid_events: 0 });
    const result = await processRawEvent(deps(), raw());
    expect(result).toMatchObject({ kind: "candidate", candidate: { status: "needs_review", validation_reasons: ["untrusted_source"] } });
  });

  it("rejects excluded event types and persists the reason", async () => {
    const { deps } = setup();
    const result = await processRawEvent(deps(), raw({ title: "Sunrise Yoga in the Park", vendorCount: null, evidence: [] }));
    expect(result).toMatchObject({ kind: "candidate", candidate: { status: "rejected", is_market: false } });
    if (result.kind === "candidate") expect(result.candidate.validation_reasons).toContain("excluded_event_type");
  });

  it("routes unresolved locations to review without inventing coordinates", async () => {
    const { deps } = setup();
    for (const geocode of [async () => null, async () => ({ ...GEO, verified: false })]) {
      const result = await processRawEvent(deps({ geocode }), raw({ title: `Example Winter Makers Market ${geocode.length}` }));
      expect(result.kind).toBe("candidate");
      if (result.kind !== "candidate") continue;
      expect(result.candidate.status).toBe("needs_review");
      expect(result.candidate.location_verified).toBe(false);
      expect(result.candidate.validation_reasons).toContain("missing_location");
    }
  });

  it("does not geocode events without an address", async () => {
    const { deps } = setup();
    const geocode = jest.fn(async () => GEO);
    const result = await processRawEvent(deps({ geocode }), raw({ address: null }));
    expect(geocode).not.toHaveBeenCalled();
    expect(result).toMatchObject({ kind: "candidate", candidate: { status: "needs_review", latitude: null } });
  });

  it("keeps undated and ambiguous events in review as recoverable, with a stable identity", async () => {
    const { deps, candidates } = setup();
    const first = await processRawEvent(deps(), raw({ startsAt: "2031-12-06", endsAt: null }));
    const second = await processRawEvent(deps(), raw({ startsAt: "2031-12-06", endsAt: null }));
    expect(first).toMatchObject({ kind: "candidate", created: true, candidate: { status: "needs_review", duplicate_state: "unchecked" }, issues: ["date_only"] });
    expect(second).toMatchObject({ kind: "candidate", created: false });
    expect(candidates()).toHaveLength(1);
  });

  it("holds events beyond the horizon as pending", async () => {
    const { deps } = setup();
    const result = await processRawEvent(deps(), raw({ startsAt: "2032-03-06T10:00:00", endsAt: "2032-03-06T16:00:00" }));
    expect(result).toMatchObject({ kind: "candidate", candidate: { status: "pending", validation_reasons: ["outside_horizon"] } });
  });

  it("is idempotent on replay and links additional observations to the same candidate", async () => {
    const { db, deps, candidates } = setup();
    const a = await processRawEvent(deps({ observationId: "obs-1" }), raw());
    const b = await processRawEvent(deps({ observationId: "obs-1" }), raw());
    const c = await processRawEvent(deps({ observationId: "obs-2" }), raw({ description: "Shop with more than forty local makers, artists and bakers." }));
    expect(candidates()).toHaveLength(1);
    expect([a, b, c].map((r) => r.kind === "candidate" && r.candidate.id)).toEqual(Array(3).fill(candidates()[0].id));
    expect(b).toMatchObject({ created: false });
    expect(db.rows("ingestion.candidate_sources")).toHaveLength(2);
  });

  it("never resets approved or published candidates and never overwrites manual overrides", async () => {
    for (const locked of [{ status: "approved", approved_by: "admin" }, { status: "published", published_event_id: "evt-1" }, { status: "needs_review", manual_override: true }, { status: "rejected", manual_override: true }]) {
      const { db, deps } = setup();
      const key = normalizeEvent(raw(), NOW).canonicalKey;
      const [seeded] = db.seed("ingestion.candidates", [{ primary_source_id: (db.rows("ingestion.sources")[0] as { id: string }).id, canonical_key: key, source_url: "https://a.example.test/old", title: "Admin Edited Title", starts_at: "2031-12-06T15:00:00.000Z", ...locked }]);
      const result = await processRawEvent(deps({ observationId: "obs-9" }), raw());
      expect(result).toMatchObject({ kind: "candidate", created: false, preserved: true, candidate: { id: seeded.id, status: locked.status, title: "Admin Edited Title" } });
      expect(db.rows("ingestion.candidate_sources")).toHaveLength(1);
    }
  });

  it("keeps an automatically rejected candidate rejected until the rejection reasons no longer apply", async () => {
    const { deps, candidates } = setup();
    const cancelled = await processRawEvent(deps(), raw({ cancelled: true }));
    expect(cancelled).toMatchObject({ candidate: { status: "rejected" }, reopened: false });
    const again = await processRawEvent(deps(), raw({ cancelled: true }));
    expect(again).toMatchObject({ candidate: { status: "rejected" }, reopened: false });
    const reinstated = await processRawEvent(deps(), raw({ cancelled: false }));
    expect(reinstated).toMatchObject({ kind: "candidate", reopened: true, candidate: { status: "ready" } });
    expect(candidates()).toHaveLength(1);
  });

  it("revalidates unlocked candidates, including ready to needs_review on conflicting evidence", async () => {
    const { deps } = setup();
    const ready = await processRawEvent(deps(), raw());
    expect(ready).toMatchObject({ candidate: { status: "ready" } });
    const conflicted = await processRawEvent(deps({ geocode: async () => null }), raw());
    expect(conflicted).toMatchObject({ candidate: { status: "needs_review" } });
  });

  it("treats a retitled event from the same source id as a confirmed duplicate of the senior candidate and links the evidence there", async () => {
    const { db, deps } = setup();
    const first = await processRawEvent(deps({ observationId: "obs-1" }), raw());
    const retitled = await processRawEvent(deps({ observationId: "obs-2" }), raw({ title: "Example Winter Makers Market Charlotte" }));
    expect(first).toMatchObject({ candidate: { status: "ready" } });
    expect(retitled).toMatchObject({ kind: "candidate", created: true, candidate: { status: "rejected", duplicate_state: "confirmed" } });
    if (first.kind !== "candidate" || retitled.kind !== "candidate") return;
    expect(retitled.candidate.validation_reasons).toContain("confirmed_duplicate");
    expect(retitled.duplicate).toMatchObject({ candidateId: first.candidate.id, reason: "source_event_id" });
    const links = db.rows("ingestion.candidate_sources");
    expect(links).toEqual(expect.arrayContaining([expect.objectContaining({ candidate_id: first.candidate.id, observation_id: "obs-2", match_reason: "duplicate_confirmed" })]));
    // Replaying the senior candidate does not turn it into a duplicate of the junior one.
    const replay = await processRawEvent(deps(), raw());
    expect(replay).toMatchObject({ candidate: { id: first.candidate.id, status: "ready", duplicate_state: "clear" } });
  });

  it("marks a similar event from another source as a possible duplicate that needs review", async () => {
    const { db, deps } = setup();
    const [other] = db.seed("ingestion.sources", [{ name: "B", base_url: "https://b.example.test", source_type: "venue", adapter: "html", trust_state: "trusted", successful_runs: 10, valid_events: 30 }]);
    await processRawEvent(deps(), raw());
    const second = await processRawEvent(deps({ source: other as unknown as SourceRow, geocode: async () => null }), raw({ sourceId: "b", externalEventId: null, address: null, sourceUrl: "https://b.example.test/x" }));
    expect(second).toMatchObject({ kind: "candidate", candidate: { duplicate_state: "possible", status: "needs_review" } });
  });

  it("blocks events that duplicate a manually created production event", async () => {
    const { db, deps } = setup();
    db.seed("public.events", [{ title: "Example Winter Makers Market", address: "100 Example Street, Charlotte", starts_at: "2031-12-06T15:00:00.000Z", latitude: 35.2271, longitude: -80.8431, status: "published" }]);
    const result = await processRawEvent(deps(), raw());
    expect(result).toMatchObject({ kind: "candidate", candidate: { status: "rejected", duplicate_state: "confirmed" } });
  });

  it("returns invalid for raw events that cannot be normalized and writes nothing", async () => {
    const { db, deps } = setup();
    for (const bad of [raw({ title: null }), raw({ sourceUrl: "javascript:alert(1)" })]) {
      await expect(processRawEvent(deps(), bad)).resolves.toMatchObject({ kind: "invalid" });
    }
    expect(db.rows("ingestion.candidates")).toHaveLength(0);
  });

  it("propagates storage failures", async () => {
    const { db, deps } = setup();
    db.failNext.push({ key: "ingestion.candidates", op: "insert", error: { code: "XX000", message: "boom" } });
    await expect(processRawEvent(deps(), raw())).rejects.toThrow(/Failed to create candidate/);
  });
});

describe("candidate state machine", () => {
  const all = Object.keys(CANDIDATE_TRANSITIONS) as CandidateStatus[];

  it("allows exactly the spec transitions", () => {
    expect(canTransition("pending", "validating")).toBe(true);
    expect(canTransition("validating", "ready")).toBe(true);
    expect(canTransition("validating", "needs_review")).toBe(true);
    expect(canTransition("validating", "rejected")).toBe(true);
    expect(canTransition("ready", "published")).toBe(true);
    expect(canTransition("ready", "needs_review")).toBe(true);
    expect(canTransition("needs_review", "approved")).toBe(true);
    expect(canTransition("needs_review", "rejected")).toBe(true);
    expect(canTransition("approved", "published")).toBe(true);
  });

  it("rejects invalid transitions, including leaving terminal states and skipping review", () => {
    expect(() => assertTransition("rejected", "ready")).toThrow(InvalidTransitionError);
    expect(() => assertTransition("published", "needs_review")).toThrow(InvalidTransitionError);
    expect(() => assertTransition("pending", "published")).toThrow(InvalidTransitionError);
    expect(() => assertTransition("needs_review", "published")).toThrow(InvalidTransitionError);
    expect(() => assertTransition("ready", "approved")).toThrow(InvalidTransitionError);
    expect(() => assertTransition("approved", "needs_review")).toThrow(InvalidTransitionError);
    expect(all.filter(isTerminalStatus).sort()).toEqual(["published", "rejected"]);
    for (const status of all) expect(canTransition(status, status)).toBe(false);
  });

  it("resolves rescrape outcomes without disturbing locked candidates", () => {
    expect(resolveRescrapeStatus(null, "ready")).toEqual({ status: "ready", locked: false, reopened: false });
    expect(resolveRescrapeStatus({ status: "approved", manual_override: false }, "rejected")).toEqual({ status: "approved", locked: true, reopened: false });
    expect(resolveRescrapeStatus({ status: "published", manual_override: false }, "needs_review")).toEqual({ status: "published", locked: true, reopened: false });
    expect(resolveRescrapeStatus({ status: "needs_review", manual_override: true }, "ready")).toEqual({ status: "needs_review", locked: true, reopened: false });
    expect(resolveRescrapeStatus({ status: "rejected", manual_override: false }, "rejected")).toEqual({ status: "rejected", locked: false, reopened: false });
    expect(resolveRescrapeStatus({ status: "rejected", manual_override: false }, "needs_review")).toEqual({ status: "needs_review", locked: false, reopened: true });
    expect(resolveRescrapeStatus({ status: "ready", manual_override: false }, "needs_review")).toEqual({ status: "needs_review", locked: false, reopened: false });
  });
});
