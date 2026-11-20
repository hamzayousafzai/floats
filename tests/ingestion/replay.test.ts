/**
 * @jest-environment node
 */
import { MemoryDb } from "./helpers/memory-db";
import type { AdapterRegistry } from "@/lib/ingestion/adapters/registry";
import { INGESTION_DEFAULTS } from "@/lib/ingestion/config";
import type { IngestionClient } from "@/lib/ingestion/storage/client";
import type { CandidateRow } from "@/lib/ingestion/storage/rows";
import type { CollectionResult, RawEvent } from "@/lib/ingestion/types";
import { type DailyCollectionConfig, runDailyCollection } from "@/lib/ingestion/workers/daily-collection";
import { rawEventFromObservation, runReplay } from "@/lib/ingestion/workers/replay-worker";
import { runVerification } from "@/lib/ingestion/workers/verify-worker";

const NOW = new Date("2031-11-20T12:00:00Z");
const EVENT_ID = "11111111-2222-4333-8444-555555555555";
const GEO = { latitude: 35.2271, longitude: -80.8431, formattedAddress: "x", provider: "mock", verified: true };
const SHADOW: DailyCollectionConfig = { ...INGESTION_DEFAULTS, publishMode: "shadow", maxConcurrency: 3 };

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

const ok = (sourceId: string, events: RawEvent[]): CollectionResult => ({ sourceId, success: true, events, discoveredUrls: [], error: null });

function harness() {
  const db = new MemoryDb();
  let events: (sourceId: string) => RawEvent[] = () => [];
  let failWith: string | null = null;
  const registry: Pick<AdapterRegistry, "resolve"> = {
    resolve: () => ({
      type: "html",
      collect: async (def) => (failWith ? { sourceId: def.id, success: false, events: [], discoveredUrls: [], error: failWith } : ok(def.id, events(def.id))),
    }),
  };
  const addSource = (name: string, overrides: Record<string, unknown> = {}) =>
    db.seed("ingestion.sources", [{ name, base_url: `https://${name.toLowerCase()}.example.test`, source_type: "organizer", adapter: "html", trust_state: "trusted", successful_runs: 10, valid_events: 30, ...overrides }])[0] as { id: string };
  const client = db.client() as unknown as IngestionClient;
  const collect = () => runDailyCollection({ client, config: SHADOW, registry, geocode: async () => GEO, now: () => NOW, sleep: async () => undefined });
  const replay = (options = {}, overrides = {}) => runReplay({ client, config: SHADOW, geocode: async () => GEO, now: () => NOW, ...overrides }, options);
  const verify = (overrides = {}) => runVerification({ client, config: SHADOW, registry, geocode: async () => GEO, now: () => NOW, sleep: async () => undefined, ...overrides });
  const candidates = () => db.rows("ingestion.candidates") as unknown as CandidateRow[];
  const runs = () => db.rows("ingestion.runs") as unknown as Record<string, unknown>[];
  return { db, addSource, collect, replay, verify, candidates, runs, setEvents: (fn: (id: string) => RawEvent[]) => (events = fn), setFailure: (m: string | null) => (failWith = m) };
}

describe("rawEventFromObservation", () => {
  const base = { source_id: "s1", source_url: "https://a.example.test/e", external_event_id: "x" };
  it("rebuilds the event and treats the row's source and URL as authoritative", () => {
    const rebuilt = rawEventFromObservation({ ...base, raw_payload: { ...raw({ sourceId: "other", sourceUrl: "https://evil.example.test/" }) } as unknown as Record<string, unknown> });
    expect(rebuilt).toMatchObject({ sourceId: "s1", sourceUrl: "https://a.example.test/e", title: "Example Winter Makers Market", vendorCount: 45, cancelled: false });
  });
  it("tolerates wrong-typed fields and rejects non-object payloads", () => {
    expect(rawEventFromObservation({ ...base, raw_payload: { title: 5, evidence: ["a", 3], vendorCount: "many", cancelled: "yes" } })).toMatchObject({ title: null, evidence: ["a"], vendorCount: null, cancelled: false });
    expect(rawEventFromObservation({ ...base, raw_payload: [] as unknown as Record<string, unknown> })).toBeNull();
    expect(rawEventFromObservation({ ...base, raw_payload: null as unknown as Record<string, unknown> })).toBeNull();
  });
});

describe("replay", () => {
  it("is idempotent: replaying stored observations creates no candidates, observations or production writes", async () => {
    const h = harness();
    const source = h.addSource("Good");
    h.setEvents((id) => [raw({ sourceId: id }), raw({ sourceId: id, externalEventId: "ext-2", sourceUrl: "https://a.example.test/events/two", title: "Second Weekend Artisan Fair", address: "200 Example St, Charlotte, NC 28202" })]);
    await h.collect();
    expect(h.candidates()).toHaveLength(2);
    const before = JSON.stringify(h.candidates().map((c) => ({ ...c, last_seen_at: null, updated_at: null })));
    const links = h.db.rows("ingestion.candidate_sources").length;

    for (let i = 0; i < 2; i += 1) {
      const summary = await h.replay({ sourceId: source.id });
      expect(summary).toMatchObject({ status: "succeeded", observationsReplayed: 2, candidatesCreated: 0, candidatesMatched: 2, processingErrors: 0 });
    }
    expect(h.candidates()).toHaveLength(2);
    expect(JSON.stringify(h.candidates().map((c) => ({ ...c, last_seen_at: null, updated_at: null })))).toBe(before);
    expect(h.db.rows("ingestion.observations")).toHaveLength(2);
    expect(h.db.rows("ingestion.candidate_sources")).toHaveLength(links);
    expect(h.db.rows("public.events")).toHaveLength(0);
    expect(h.db.rpcCalls).toHaveLength(0);
    expect(h.runs().filter((r) => r.run_type === "replay")).toHaveLength(2);
    expect(h.runs().filter((r) => r.run_type === "replay").every((r) => r.status === "succeeded" && r.finished_at)).toBe(true);
  });

  it("rebuilds a missing candidate from evidence exactly once", async () => {
    const h = harness();
    const source = h.addSource("Good");
    h.db.seed("ingestion.runs", [{ run_type: "collection", status: "succeeded" }]);
    h.db.seed("ingestion.observations", [{ source_id: source.id, run_id: "r", external_event_id: "ext-1", source_url: "https://a.example.test/events/market", raw_payload: raw({ sourceId: source.id }), content_hash: "a".repeat(64), parser_version: "1", observed_at: NOW.toISOString() }]);
    expect(await h.replay()).toMatchObject({ candidatesCreated: 1 });
    expect(await h.replay()).toMatchObject({ candidatesCreated: 0, candidatesMatched: 1 });
    expect(h.candidates()).toHaveLength(1);
    expect(h.db.rows("ingestion.candidate_sources")).toHaveLength(1);
  });

  it("never publishes, even when a candidate becomes ready", async () => {
    const h = harness();
    const source = h.addSource("Good");
    h.db.seed("ingestion.observations", [{ source_id: source.id, run_id: "r", external_event_id: null, source_url: "https://a.example.test/events/market", raw_payload: raw({ sourceId: source.id }), content_hash: "b".repeat(64), parser_version: "1", observed_at: NOW.toISOString() }]);
    await h.replay();
    expect(h.candidates()[0].status).toBe("ready");
    expect(h.db.rpcCalls).toHaveLength(0);
    expect(h.db.rows("ingestion.publication_audit")).toHaveLength(0);
  });

  it("preserves manual overrides, approvals and published candidates", async () => {
    const h = harness();
    h.addSource("Good");
    h.setEvents((id) => [raw({ sourceId: id }), raw({ sourceId: id, externalEventId: "ext-2", sourceUrl: "https://a.example.test/events/two", title: "Second Weekend Artisan Fair", address: "200 Example St, Charlotte, NC 28202" })]);
    await h.collect();
    const [first, second] = h.candidates();
    Object.assign(first, { status: "rejected", manual_override: true, title: "Admin Edited Title", description: "Admin text" });
    Object.assign(second, { status: "approved", approved_by: "admin-1" });

    const summary = await h.replay();
    expect(summary).toMatchObject({ candidatesPreserved: 2, candidatesCreated: 0 });
    expect(first).toMatchObject({ status: "rejected", manual_override: true, title: "Admin Edited Title", description: "Admin text" });
    expect(second).toMatchObject({ status: "approved", approved_by: "admin-1" });
    expect(h.candidates()).toHaveLength(2);
  });

  it("counts malformed payloads and missing sources without failing the run", async () => {
    const h = harness();
    const source = h.addSource("Good");
    h.db.seed("ingestion.observations", [
      { source_id: source.id, run_id: "r", source_url: "https://a.example.test/1", raw_payload: [], content_hash: "c".repeat(64), parser_version: "1", observed_at: NOW.toISOString() },
      { source_id: "missing-source", run_id: "r", source_url: "https://a.example.test/2", raw_payload: raw(), content_hash: "d".repeat(64), parser_version: "1", observed_at: NOW.toISOString() },
      { source_id: source.id, run_id: "r", source_url: "https://a.example.test/3", raw_payload: raw({ title: null }), content_hash: "e".repeat(64), parser_version: "1", observed_at: NOW.toISOString() },
    ]);
    const summary = await h.replay();
    expect(summary).toMatchObject({ status: "succeeded", malformed: 1, sourcesMissing: 1, invalid: 1, candidatesCreated: 0 });
  });

  it("filters by source, run and time, and honors the limit", async () => {
    const h = harness();
    const a = h.addSource("A");
    const b = h.addSource("B");
    const mk = (sourceId: string, n: number, runId: string, observedAt: string) => ({ source_id: sourceId, run_id: runId, external_event_id: `e${n}`, source_url: `https://a.example.test/e/${n}`, raw_payload: raw({ sourceId, externalEventId: `e${n}`, sourceUrl: `https://a.example.test/e/${n}`, title: `Weekend Makers Market ${n}` }), content_hash: String(n).repeat(64).slice(0, 64), parser_version: "1", observed_at: observedAt });
    h.db.seed("ingestion.observations", [mk(a.id, 1, "r1", "2031-11-01T00:00:00Z"), mk(a.id, 2, "r2", "2031-11-10T00:00:00Z"), mk(b.id, 3, "r2", "2031-11-10T00:00:00Z")]);
    expect((await h.replay({ sourceId: a.id })).observationsReplayed).toBe(2);
    expect((await h.replay({ runId: "r2" })).observationsReplayed).toBe(2);
    expect((await h.replay({ since: "2031-11-05T00:00:00Z" })).observationsReplayed).toBe(2);
    expect((await h.replay({ limit: 1 })).observationsReplayed).toBe(1);
  });

  it("skips while another replay runs, and finalizes the run on a fatal error", async () => {
    const h = harness();
    h.addSource("Good");
    h.db.seed("ingestion.runs", [{ run_type: "replay", status: "running", started_at: new Date(NOW.getTime() - 60_000).toISOString() }]);
    expect((await h.replay()).status).toBe("skipped_overlap");

    const h2 = harness();
    h2.db.failNext.push({ key: "ingestion.observations", op: "select", error: { code: "XX000", message: "db down" } });
    await expect(h2.replay()).rejects.toThrow(/Failed to load observations/);
    expect(h2.runs()[0]).toMatchObject({ run_type: "replay", status: "failed", error_summary: expect.stringContaining("Fatal") });
  });
});

describe("verification", () => {
  /** Collect once (shadow), then mark the candidate as published by ingestion so verification owns it. */
  async function withOwnedEvent(management = "ingestion") {
    const h = harness();
    const source = h.addSource("Good");
    h.setEvents((id) => [raw({ sourceId: id })]);
    await h.collect();
    const candidate = h.candidates()[0];
    Object.assign(candidate, { status: "published", published_event_id: EVENT_ID });
    h.db.seed("public.event_ingestion_links", [{ event_id: EVENT_ID, candidate_id: candidate.id, source_id: source.id, management_state: management }]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { h, source, candidate };
  }

  it("reports a missed daily run as an error and a recent one as healthy", async () => {
    const h = harness();
    h.addSource("Good");
    const none = await h.verify();
    expect(none.status).toBe("failed");
    expect(none.findings).toEqual([expect.objectContaining({ code: "missed_daily_run", severity: "error" })]);

    const h2 = harness();
    h2.addSource("Good", { last_attempt_at: NOW.toISOString(), last_success_at: NOW.toISOString() });
    h2.db.seed("ingestion.runs", [{ run_type: "collection", status: "succeeded", started_at: new Date(NOW.getTime() - 3_600_000).toISOString(), finished_at: new Date(NOW.getTime() - 3_000_000).toISOString() }]);
    expect(await h2.verify()).toMatchObject({ status: "succeeded", findings: [] });

    const h3 = harness();
    h3.db.seed("ingestion.runs", [{ run_type: "collection", status: "partial", started_at: new Date(NOW.getTime() - 50 * 3_600_000).toISOString(), finished_at: new Date(NOW.getTime() - 49 * 3_600_000).toISOString() }]);
    expect((await h3.verify()).findings[0].message).toMatch(/49h ago/);
  });

  it("flags failing and stale sources as warnings", async () => {
    const h = harness();
    h.db.seed("ingestion.runs", [{ run_type: "collection", status: "succeeded", started_at: NOW.toISOString(), finished_at: NOW.toISOString() }]);
    h.addSource("Failing", { last_success_at: "2031-11-10T00:00:00Z", last_attempt_at: "2031-11-19T00:00:00Z" });
    h.addSource("Stale", { last_success_at: "2031-11-10T00:00:00Z", last_attempt_at: "2031-11-10T00:00:00Z" });
    h.addSource("Fine", { last_success_at: NOW.toISOString(), last_attempt_at: NOW.toISOString() });
    h.addSource("Off", { enabled: false, last_attempt_at: "2031-11-19T00:00:00Z" });
    const summary = await h.verify();
    expect(summary.status).toBe("partial");
    expect(summary.findings.map((f) => `${f.code}:${f.message.split(":")[0]}`).sort()).toEqual(["source_failing:Failing", "source_stale:Stale"]);
  });

  it("rechecks owned upcoming events and counts a source cancellation without applying it in shadow mode", async () => {
    const { h, source } = await withOwnedEvent();
    h.setEvents((id) => [raw({ sourceId: id, cancelled: true, description: "This market has been cancelled due to storms." })]);
    h.db.rpcCalls.length = 0;
    const summary = await h.verify();
    expect(summary).toMatchObject({ ownedUpcomingEvents: 1, sourcesRechecked: 1, archivesApplied: 0, updatesShadowed: 1 });
    expect(summary.findings).toContainEqual(expect.objectContaining({ code: "cancellation_pending", sourceId: source.id }));
    expect(h.db.rpcCalls).toHaveLength(0);
    expect(h.runs().find((r) => r.run_type === "verification")).toMatchObject({ status: expect.stringMatching(/partial|failed/), finished_at: expect.any(String) });
  });

  it("does not treat a missing event as a cancellation", async () => {
    const { h, candidate } = await withOwnedEvent();
    h.setEvents(() => []);
    const summary = await h.verify();
    expect(summary.findings).toContainEqual(expect.objectContaining({ code: "owned_event_not_seen" }));
    expect(summary).toMatchObject({ archivesApplied: 0, updatesApplied: 0 });
    expect(h.db.rpcCalls).toHaveLength(0);
    expect(h.candidates().find((c) => c.id === candidate.id)).toMatchObject({ status: "published", published_event_id: EVENT_ID });
  });

  it("reports no unseen events when the source still lists them", async () => {
    const { h } = await withOwnedEvent();
    const summary = await h.verify();
    expect(summary.findings.filter((f) => f.code === "owned_event_not_seen")).toEqual([]);
    expect(summary).toMatchObject({ sourcesRechecked: 1, updatesShadowed: 0 });
  });

  it("leaves manually managed and organizer-claimed events alone", async () => {
    for (const state of ["manual", "claimed"]) {
      const { h } = await withOwnedEvent(state);
      const summary = await h.verify();
      expect(summary).toMatchObject({ ownedUpcomingEvents: 0, sourcesRechecked: 0 });
    }
  });

  it("ignores past events and reports an unavailable source as a warning", async () => {
    const { h, candidate } = await withOwnedEvent();
    Object.assign(candidate, { starts_at: "2031-11-01T00:00:00Z" });
    expect((await h.verify()).ownedUpcomingEvents).toBe(0);

    const second = await withOwnedEvent();
    second.h.setFailure("Parser structure changed");
    const summary = await second.h.verify();
    expect(summary.findings).toContainEqual(expect.objectContaining({ code: "recheck_failed", severity: "warning" }));
  });

  it("skips while another verification runs and finalizes on a fatal error", async () => {
    const h = harness();
    h.db.seed("ingestion.runs", [{ run_type: "verification", status: "running", started_at: new Date(NOW.getTime() - 60_000).toISOString() }]);
    expect((await h.verify()).status).toBe("skipped_overlap");

    const h2 = harness();
    h2.db.failNext.push({ key: "ingestion.runs", op: "select", error: { code: "XX000", message: "db down" } });
    h2.db.failNext.push({ key: "ingestion.runs", op: "select", error: { code: "XX000", message: "db down" } });
    await expect(h2.verify()).rejects.toThrow();
  });
});
