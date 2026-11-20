/**
 * @jest-environment node
 */
import { MemoryDb } from "./helpers/memory-db";
import type { AdapterRegistry } from "@/lib/ingestion/adapters/registry";
import { UnknownAdapterError } from "@/lib/ingestion/adapters/registry";
import type { EventAdapter, SourceDefinition } from "@/lib/ingestion/adapters/types";
import { INGESTION_DEFAULTS } from "@/lib/ingestion/config";
import type { SafeFetchOptions } from "@/lib/ingestion/security/safe-fetch";
import type { IngestionClient } from "@/lib/ingestion/storage/client";
import type { CandidateRow } from "@/lib/ingestion/storage/rows";
import type { CollectionResult, NormalizedEvent, RawEvent } from "@/lib/ingestion/types";
import { type DailyCollectionConfig, runDailyCollection } from "@/lib/ingestion/workers/daily-collection";
import { createFetchPage } from "@/lib/ingestion/workers/fetch-page";
import { cancellationEvidence, classifyFailureMessage, diffVerifiedChanges } from "@/lib/ingestion/workers/source-runner";

const NOW = new Date("2031-11-20T12:00:00Z");
const EVENT_ID = "11111111-2222-4333-8444-555555555555";
const GEO = { latitude: 35.2271, longitude: -80.8431, formattedAddress: "x", provider: "mock", verified: true };
const SHADOW: DailyCollectionConfig = { ...INGESTION_DEFAULTS, publishMode: "shadow", maxConcurrency: 3 };
const LIVE: DailyCollectionConfig = { ...SHADOW, publishMode: "live" };

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

const ok = (sourceId: string, events: RawEvent[], warning: string | null = null): CollectionResult => ({ sourceId, success: true, events, discoveredUrls: [], error: warning });
const fail = (sourceId: string, error: string): CollectionResult => ({ sourceId, success: false, events: [], discoveredUrls: [], error });

type Behaviour = (source: SourceDefinition, attempt: number) => Promise<CollectionResult> | CollectionResult;

function harness(config: DailyCollectionConfig = SHADOW) {
  const db = new MemoryDb();
  const behaviours = new Map<string, Behaviour>();
  const attempts = new Map<string, number>();
  const sleeps: number[] = [];
  const registry: Pick<AdapterRegistry, "resolve"> = {
    resolve(source): EventAdapter {
      const behaviour = behaviours.get(source.name);
      if (!behaviour) throw new UnknownAdapterError(`No adapter for ${source.name}`);
      return {
        type: "html",
        async collect(def) {
          const attempt = (attempts.get(def.name) ?? 0) + 1;
          attempts.set(def.name, attempt);
          return behaviour(def, attempt);
        },
      };
    },
  };
  const addSource = (name: string, behaviour: Behaviour, overrides: Record<string, unknown> = {}) => {
    behaviours.set(name, behaviour);
    const [row] = db.seed("ingestion.sources", [
      { name, base_url: `https://${name.toLowerCase().replace(/\W+/g, "-")}.example.test`, source_type: "organizer", adapter: "html", trust_state: "trusted", successful_runs: 10, valid_events: 30, ...overrides },
    ]);
    return row as { id: string; name: string };
  };
  const run = (overrides: Partial<Parameters<typeof runDailyCollection>[0]> = {}) =>
    runDailyCollection({
      client: db.client() as unknown as IngestionClient,
      config,
      registry,
      geocode: async () => GEO,
      now: () => NOW,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      ...overrides,
    });
  const candidates = () => db.rows("ingestion.candidates") as unknown as CandidateRow[];
  const runs = () => db.rows("ingestion.runs") as unknown as Record<string, unknown>[];
  const source = (id: string) => db.rows("ingestion.sources").find((r) => r.id === id) as Record<string, unknown>;
  return { db, addSource, run, candidates, runs, source, sleeps, attempts };
}

describe("daily collection: isolation and status", () => {
  it("keeps collecting when one source fails and reports a partial run", async () => {
    const h = harness();
    const bad = h.addSource("Broken Source", (d) => fail(d.id, "Parser structure changed: no event cards"));
    const good = h.addSource("Good Source", (d) => ok(d.id, [raw({ sourceId: d.id })]));
    const summary = await h.run();

    expect(summary).toMatchObject({ status: "partial", sourcesAttempted: 2, sourcesSucceeded: 1, sourcesFailed: 1, observationsFound: 1, candidatesCreated: 1 });
    expect(h.db.rows("ingestion.observations")).toHaveLength(1);
    expect(h.candidates()).toHaveLength(1);
    expect(h.source(bad.id)).toMatchObject({ failed_runs: 1, successful_runs: 10 });
    expect(h.source(good.id)).toMatchObject({ successful_runs: 11, valid_events: 31 });
    expect(h.runs()[0]).toMatchObject({ status: "partial", sources_attempted: 2, sources_succeeded: 1, observations_found: 1, candidates_created: 1 });
    expect(h.runs()[0].finished_at).not.toBeNull();
  });

  it("isolates a source whose adapter throws", async () => {
    const h = harness();
    h.addSource("Thrower", () => {
      throw new Error("kaboom");
    });
    h.addSource("Good Source", (d) => ok(d.id, [raw({ sourceId: d.id })]));
    const summary = await h.run();
    expect(summary.status).toBe("partial");
    expect(summary.sources.find((s) => s.name === "Thrower")).toMatchObject({ status: "failed", failureKind: "source_error" });
    expect(h.candidates()).toHaveLength(1);
  });

  it("marks the run failed when every source fails, and succeeded when none do", async () => {
    const failing = harness();
    failing.addSource("A", (d) => fail(d.id, "bad markup"));
    expect((await failing.run()).status).toBe("failed");
    expect(failing.runs()[0].status).toBe("failed");

    const healthy = harness();
    healthy.addSource("A", (d) => ok(d.id, [raw({ sourceId: d.id })]));
    expect((await healthy.run()).status).toBe("succeeded");
  });

  it("fails the run when there is nothing to collect so a silent misconfiguration is visible", async () => {
    const h = harness();
    const summary = await h.run();
    expect(summary).toMatchObject({ status: "failed", errorSummary: expect.stringContaining("No enabled collection sources") });
    expect(h.runs()[0].status).toBe("failed");
  });

  it("skips disabled, discovery-only and disabled-trust sources", async () => {
    const h = harness();
    h.addSource("Off", (d) => ok(d.id, [raw({ sourceId: d.id })]), { enabled: false });
    h.addSource("Discovery", (d) => ok(d.id, [raw({ sourceId: d.id })]), { discovery_only: true });
    h.addSource("Dead", (d) => ok(d.id, [raw({ sourceId: d.id })]), { trust_state: "disabled" });
    const live = h.addSource("On", (d) => ok(d.id, []));
    const summary = await h.run();
    expect(summary.sources.map((s) => s.sourceId)).toEqual([live.id]);
  });

  it("reports a source with an unknown adapter as failed without retrying", async () => {
    const h = harness();
    h.db.seed("ingestion.sources", [{ name: "Mystery", base_url: "https://mystery.example.test", source_type: "organizer", adapter: "html", trust_state: "trusted" }]);
    const summary = await h.run();
    expect(summary.sources[0]).toMatchObject({ status: "failed", failureKind: "adapter_unavailable", attempts: 1 });
  });
});

describe("daily collection: retries and failure kinds", () => {
  it("retries transient failures with backoff and then succeeds", async () => {
    const h = harness();
    h.addSource("Flaky", (d, attempt) => (attempt < 3 ? fail(d.id, "Request timed out") : ok(d.id, [raw({ sourceId: d.id })])));
    const summary = await h.run();
    expect(summary.sources[0]).toMatchObject({ status: "succeeded", attempts: 3 });
    expect(h.sleeps).toEqual([1000, 2000]);
    expect(h.candidates()).toHaveLength(1);
  });

  it("gives up after the retry budget and reports transient_exhausted", async () => {
    const h = harness();
    const src = h.addSource("Down", (d) => fail(d.id, "Unexpected HTTP status 503"));
    const summary = await h.run();
    expect(summary.sources[0]).toMatchObject({ status: "failed", failureKind: "transient_exhausted", attempts: 3 });
    expect(h.source(src.id)).toMatchObject({ failed_runs: 1 });
  });

  it.each([
    ["robots denial", "Blocked by robots.txt", "robots_denied"],
    ["parser failure", "Parser structure changed: expected .event-card", "source_error"],
    ["not found", "Unexpected HTTP status 404", "source_error"],
    ["unsafe url", "Unsafe URL: private address", "source_error"],
  ])("does not retry a %s", async (_label, message, kind) => {
    const h = harness();
    h.addSource("Stuck", (d) => fail(d.id, message));
    const summary = await h.run();
    expect(summary.sources[0]).toMatchObject({ status: "failed", failureKind: kind, attempts: 1 });
    expect(h.sleeps).toEqual([]);
  });

  it("treats a source that lists no events as a success, distinct from a parser failure", async () => {
    const h = harness();
    const quiet = h.addSource("Quiet", (d) => ok(d.id, []));
    const summary = await h.run();
    expect(summary.sources[0]).toMatchObject({ status: "succeeded", noEvents: true, eventsFound: 0 });
    expect(summary.status).toBe("succeeded");
    expect(h.source(quiet.id)).toMatchObject({ successful_runs: 11 });
    expect(h.runs()[0].metadata).toMatchObject({ noEventSources: ["Quiet"] });
  });

  it("times out a hung adapter even when it ignores the abort signal", async () => {
    const h = harness();
    h.addSource("Hung", () => new Promise<CollectionResult>(() => undefined));
    const summary = await h.run({ sourceTimeoutMs: 15, maxRetries: 1 });
    expect(summary.sources[0]).toMatchObject({ status: "failed", failureKind: "transient_exhausted", attempts: 2, error: expect.stringContaining("timed out") });
  });

  it("carries a partial-parse warning on a successful source", async () => {
    const h = harness();
    h.addSource("Warn", (d) => ok(d.id, [raw({ sourceId: d.id })], "1 of 3 cards skipped"));
    const summary = await h.run();
    expect(summary.sources[0]).toMatchObject({ status: "succeeded", warning: "1 of 3 cards skipped" });
  });

  it("classifies failure messages", () => {
    expect(classifyFailureMessage("Request timed out")).toBe("transient");
    expect(classifyFailureMessage("Network request failed")).toBe("transient");
    expect(classifyFailureMessage("Unexpected HTTP status 429")).toBe("transient");
    expect(classifyFailureMessage("Unexpected HTTP status 403")).toBe("permanent");
    expect(classifyFailureMessage("Blocked by robots.txt")).toBe("robots");
    expect(classifyFailureMessage("Run aborted")).toBe("aborted");
    expect(classifyFailureMessage("Rendered page exceeds the size limit")).toBe("permanent");
  });
});

describe("daily collection: overlap, stale runs and finalization", () => {
  it("does not start when a recent run is still in progress", async () => {
    const h = harness();
    const adapter = jest.fn();
    h.addSource("A", (d) => {
      adapter();
      return ok(d.id, []);
    });
    h.db.seed("ingestion.runs", [{ run_type: "collection", status: "running", started_at: new Date(NOW.getTime() - 10 * 60_000).toISOString() }]);
    const summary = await h.run();
    expect(summary).toMatchObject({ status: "skipped_overlap", runId: null });
    expect(adapter).not.toHaveBeenCalled();
    expect(h.runs()).toHaveLength(1);
  });

  it("closes an abandoned run as failed and proceeds", async () => {
    const h = harness();
    h.addSource("A", (d) => ok(d.id, []));
    h.db.seed("ingestion.runs", [{ run_type: "collection", status: "running", started_at: new Date(NOW.getTime() - 5 * 3600_000).toISOString() }]);
    const summary = await h.run();
    expect(summary.status).toBe("succeeded");
    const [stale, current] = h.runs();
    expect(stale).toMatchObject({ status: "failed", error_summary: expect.stringContaining("abandoned") });
    expect(current.status).toBe("succeeded");
  });

  it("does not abandon runs of other types", async () => {
    const h = harness();
    h.addSource("A", (d) => ok(d.id, []));
    h.db.seed("ingestion.runs", [{ run_type: "discovery", status: "running", started_at: new Date(NOW.getTime() - 5 * 3600_000).toISOString() }]);
    await h.run();
    expect(h.runs()[0].status).toBe("running");
  });

  it("treats a database-level lock conflict as an overlap", async () => {
    const h = harness();
    h.addSource("A", (d) => ok(d.id, []));
    h.db.failNext.push({ key: "ingestion.runs", op: "insert", error: { code: "23505", message: "duplicate key value violates unique constraint uq_runs_one_running_per_type" } });
    const summary = await h.run();
    expect(summary.status).toBe("skipped_overlap");
    expect(h.db.rows("ingestion.observations")).toHaveLength(0);
  });

  it("finalizes the run as failed on a fatal error and rethrows", async () => {
    const h = harness();
    h.addSource("A", (d) => ok(d.id, []));
    h.db.failNext.push({ key: "ingestion.sources", op: "select", error: { code: "XX000", message: "connection to db.example.test dropped" } });
    await expect(h.run()).rejects.toThrow(/Failed to load sources/);
    expect(h.runs()).toHaveLength(1);
    expect(h.runs()[0]).toMatchObject({ status: "failed", error_summary: expect.stringContaining("Fatal") });
    expect(h.runs()[0].finished_at).not.toBeNull();
  });

  it("stops starting sources at the run deadline, aborts the active one and still finalizes", async () => {
    const h = harness({ ...SHADOW, maxConcurrency: 1 });
    const second = jest.fn();
    h.addSource("A-Slow", () => new Promise<CollectionResult>(() => undefined));
    h.addSource("B-Later", (d) => {
      second();
      return ok(d.id, []);
    });
    const summary = await h.run({ runDeadlineMs: 20, sourceTimeoutMs: 60_000 });
    expect(second).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ status: "failed", sourcesAttempted: 1, sourcesNotStarted: 1 });
    expect(summary.sources[0]).toMatchObject({ failureKind: "aborted" });
    expect(h.runs()[0]).toMatchObject({ status: "failed", error_summary: expect.stringContaining("deadline") });
  });

  it("never persists credentials from adapter errors", async () => {
    const h = harness();
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3OA.abcdefghijk12345";
    h.addSource("Leaky", (d) => fail(d.id, `Upstream rejected Bearer ${jwt} for https://user:pass@a.example.test/`));
    const summary = await h.run();
    const serialized = JSON.stringify([summary, h.runs()]);
    expect(serialized).not.toContain(jwt);
    expect(serialized).not.toContain("user:pass");
  });
});

describe("daily collection: concurrency", () => {
  it("never runs more sources at once than maxConcurrency", async () => {
    const h = harness({ ...SHADOW, maxConcurrency: 2 });
    let active = 0;
    let peak = 0;
    for (let i = 0; i < 6; i += 1) {
      h.addSource(`S${i}`, async (d) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return ok(d.id, []);
      });
    }
    const summary = await h.run();
    expect(summary).toMatchObject({ status: "succeeded", sourcesAttempted: 6 });
    expect(peak).toBe(2);
  });
});

describe("daily collection: shadow mode and repeat runs", () => {
  it("persists observations and candidates, makes zero production writes, and is stable on repeat", async () => {
    const h = harness(SHADOW);
    h.addSource("Good Source", (d) => ok(d.id, [raw({ sourceId: d.id }), raw({ sourceId: d.id, externalEventId: "ext-2", sourceUrl: "https://a.example.test/events/two", title: "Second Street Craft Fair", address: "200 Second St, Charlotte, NC 28202" })]));

    const first = await h.run();
    expect(first).toMatchObject({ status: "succeeded", candidatesCreated: 2, candidatesPublished: 0, shadowDecisions: 2 });
    const observations = h.db.rows("ingestion.observations").length;
    const audits = h.db.rows("ingestion.publication_audit").length;
    expect(observations).toBe(2);
    expect(audits).toBe(2);
    expect(h.candidates().map((c) => c.status)).toEqual(["ready", "ready"]);

    const second = await h.run();
    expect(second).toMatchObject({ status: "succeeded", candidatesCreated: 0, candidatesPublished: 0 });
    expect(second.sources[0]).toMatchObject({ observationsNew: 0, observationsReused: 2 });
    expect(h.db.rows("ingestion.observations")).toHaveLength(observations);
    expect(h.candidates()).toHaveLength(2);
    expect(h.db.rows("ingestion.publication_audit")).toHaveLength(audits);

    expect(h.db.rows("public.events")).toHaveLength(0);
    expect(h.db.rows("public.event_ingestion_links")).toHaveLength(0);
    expect(h.db.rpcCalls).toHaveLength(0);
  });

  it("stores the full raw event as evidence with the parser version", async () => {
    const h = harness();
    h.addSource("Good Source", (d) => ok(d.id, [raw({ sourceId: d.id })]));
    await h.run();
    const [observation] = h.db.rows("ingestion.observations");
    expect(observation).toMatchObject({ parser_version: "1", source_url: "https://a.example.test/events/market", raw_payload: expect.objectContaining({ title: "Example Winter Makers Market" }) });
    expect(h.db.rows("ingestion.candidate_sources")).toHaveLength(1);
  });

  it("isolates a failing event from the rest of its source", async () => {
    const h = harness();
    const src = h.addSource("Good Source", (d) => ok(d.id, [raw({ sourceId: d.id }), raw({ sourceId: d.id, externalEventId: "ext-2", sourceUrl: "https://a.example.test/events/two", title: "Second Street Craft Fair", address: "200 Second St, Charlotte, NC 28202" })]));
    h.db.failNext.push({ key: "ingestion.candidates", op: "insert", error: { code: "XX000", message: "disk full" } });
    const summary = await h.run();
    expect(summary.sources[0]).toMatchObject({ status: "succeeded", processingErrors: 1, validEvents: 1 });
    expect(summary.sources[0].warning).toContain("Some events failed");
    expect(h.candidates()).toHaveLength(1);
    expect(h.source(src.id)).toMatchObject({ successful_runs: 11 });
  });

  it("fails a source when every one of its events fails to process", async () => {
    const h = harness();
    h.addSource("Good Source", (d) => ok(d.id, [raw({ sourceId: d.id })]));
    h.db.failNext.push({ key: "ingestion.candidates", op: "insert", error: { code: "XX000", message: "disk full" } });
    const summary = await h.run();
    expect(summary.sources[0]).toMatchObject({ status: "failed", failureKind: "processing_failed" });
    expect(summary.status).toBe("failed");
  });

  it("counts invalid and rejected events without creating candidates for unusable data", async () => {
    const h = harness();
    h.addSource("Mixed", (d) => ok(d.id, [raw({ sourceId: d.id }), raw({ sourceId: d.id, title: null, sourceUrl: "https://a.example.test/events/untitled", externalEventId: "x" })]));
    const summary = await h.run();
    expect(summary.sources[0]).toMatchObject({ eventsFound: 2, validEvents: 1, rejectedEvents: 1, invalidEvents: 1 });
    expect(h.candidates()).toHaveLength(1);
  });

  it("caps the number of events processed per source", async () => {
    const h = harness();
    h.addSource("Huge", (d) => ok(d.id, [1, 2, 3, 4].map((n) => raw({ sourceId: d.id, externalEventId: `e${n}`, sourceUrl: `https://a.example.test/e/${n}`, title: `Weekend Makers Market ${n}`, address: `${n}00 Example St, Charlotte, NC 28202` }))));
    const summary = await h.run({ maxEvents: 2 });
    expect(summary.sources[0]).toMatchObject({ eventsFound: 4, truncated: true });
    expect(h.db.rows("ingestion.observations")).toHaveLength(2);
  });
});

describe("daily collection: live mode", () => {
  function liveHarness() {
    const h = harness(LIVE);
    h.db.rpcHandlers.set("ingestion.publish_candidate", (args) => {
      const row = h.db.rows("ingestion.candidates").find((c) => c.id === args.p_candidate_id);
      if (row) Object.assign(row, { status: "published", published_event_id: EVENT_ID });
      return { data: EVENT_ID };
    });
    return h;
  }

  it("publishes ready candidates through the publisher", async () => {
    const h = liveHarness();
    h.addSource("Good Source", (d) => ok(d.id, [raw({ sourceId: d.id })]));
    const summary = await h.run();
    expect(summary).toMatchObject({ candidatesPublished: 1, shadowDecisions: 0 });
    expect(h.db.rpcCalls.filter((c) => c.name === "ingestion.publish_candidate")).toHaveLength(1);
  });

  it("updates an ingestion-owned event only with verified changes", async () => {
    const h = liveHarness();
    let description = "Shop with more than forty local makers and artists.";
    h.addSource("Good Source", (d) => ok(d.id, [raw({ sourceId: d.id, description })]));
    await h.run();
    h.db.rpcHandlers.set("ingestion.update_imported_event", () => ({ data: "updated" }));
    description = "Now with live music and a food truck rally on the lawn.";
    const summary = await h.run();
    const calls = h.db.rpcCalls.filter((c) => c.name === "ingestion.update_imported_event");
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toMatchObject({ p_event_id: EVENT_ID, p_changes: { description }, p_cancellation_evidence: null });
    expect(summary.sources[0]).toMatchObject({ updatesApplied: 1 });
  });

  it("archives only on explicit cancellation, quoting the source text", async () => {
    const h = liveHarness();
    let cancelled = false;
    h.addSource("Good Source", (d) => ok(d.id, [raw({ sourceId: d.id, cancelled, description: cancelled ? "This market has been cancelled due to storms." : "Shop with more than forty local makers and artists." })]));
    await h.run();
    h.db.rpcHandlers.set("ingestion.update_imported_event", () => ({ data: "archived" }));
    cancelled = true;
    const summary = await h.run();
    const calls = h.db.rpcCalls.filter((c) => c.name === "ingestion.update_imported_event");
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toMatchObject({ p_changes: {}, p_cancellation_evidence: expect.stringContaining("cancelled due to storms") });
    expect(summary.sources[0]).toMatchObject({ archivesApplied: 1 });
  });

  it("does not archive or update anything when the event is simply missing from the source", async () => {
    const h = liveHarness();
    let events = true;
    h.addSource("Good Source", (d) => ok(d.id, events ? [raw({ sourceId: d.id })] : []));
    await h.run();
    events = false;
    await h.run();
    expect(h.db.rpcCalls.filter((c) => c.name === "ingestion.update_imported_event")).toHaveLength(0);
  });

  it("in shadow mode counts would-be updates but makes no production call", async () => {
    const live = liveHarness();
    let description = "Shop with more than forty local makers and artists.";
    const src = live.addSource("Good Source", (d) => ok(d.id, [raw({ sourceId: d.id, description })]));
    await live.run();
    live.db.rpcCalls.length = 0;
    description = "Now with live music and a food truck rally on the lawn.";
    const summary = await runDailyCollection({
      client: live.db.client() as unknown as IngestionClient,
      config: SHADOW,
      registry: { resolve: () => ({ type: "html", collect: async (d) => ok(d.id, [raw({ sourceId: src.id, description })]) }) },
      geocode: async () => GEO,
      now: () => NOW,
    });
    expect(summary.updatesShadowed).toBe(1);
    expect(live.db.rpcCalls).toHaveLength(0);
  });
});

describe("source-runner helpers", () => {
  const stored = { title: "Market", description: "Old text", starts_at: "2031-12-06T15:00:00+00:00", ends_at: "2031-12-06T21:00:00+00:00", address: "1 A St" };
  const event = (over: Partial<NormalizedEvent>): NormalizedEvent => ({
    canonicalKey: "k", title: "Market", description: "Old text", startsAt: "2031-12-06T15:00:00.000Z", endsAt: "2031-12-06T21:00:00.000Z", timezone: "America/New_York",
    organizerName: null, venueName: null, address: "1 A St", latitude: 35.2, longitude: -80.8, vendorCount: null, vendorEvidence: [], categorySlugs: [], cancelled: false, sourceUrl: "https://a.example.test/e", ...over,
  } as NormalizedEvent);

  it("treats equal instants in different formats as unchanged", () => {
    expect(diffVerifiedChanges(stored, event({}))).toEqual({});
  });

  it("never fabricates or blanks fields", () => {
    expect(diffVerifiedChanges(stored, event({ endsAt: null, description: null, address: null }))).toEqual({});
  });

  it("changes an address only together with coordinates", () => {
    expect(diffVerifiedChanges(stored, event({ address: "2 B St", latitude: null, longitude: null }))).toEqual({});
    expect(diffVerifiedChanges(stored, event({ address: "2 B St" }))).toEqual({ address: "2 B St", latitude: 35.2, longitude: -80.8 });
  });

  it("quotes cancellation wording from the source", () => {
    expect(cancellationEvidence(raw({ description: "Join us! This market is cancelled due to weather. See you soon." }))).toContain("cancelled due to weather");
    expect(cancellationEvidence(raw({ title: "Spring Fair", description: null }))).toContain("Spring Fair");
  });
});

describe("createFetchPage", () => {
  const config = { ...INGESTION_DEFAULTS, maxPagesPerSourcePerRun: 2 };
  const source: SourceDefinition = { id: "s1", name: "S", baseUrl: "https://a.example.test", adapter: "html", crawlDelayMs: 2000, configuration: {} };
  const context = { runId: "r1", now: NOW, horizonDays: 60, signal: new AbortController().signal };
  const body = { finalUrl: "https://a.example.test/x", status: 200, contentType: "text/html", body: "<html></html>", etag: null, lastModified: null };

  it("refuses robots-disallowed paths without fetching", async () => {
    const fetcher = jest.fn();
    const fetchPage = createFetchPage(config, { fetcher, robots: { policyFor: async () => ({ available: true, isAllowed: (p: string) => !p.startsWith("/private"), crawlDelayMs: null }) } });
    await expect(fetchPage("https://a.example.test/private/x", source, context)).rejects.toThrow("Blocked by robots.txt");
    expect(fetcher).not.toHaveBeenCalled();
    expect(classifyFailureMessage("Blocked by robots.txt")).toBe("robots");
  });

  it("uses the larger of the source and robots crawl delay and passes safe limits", async () => {
    const fetcher = jest.fn(async (...args: [string, SafeFetchOptions]) => {
      void args;
      return body;
    });
    const fetchPage = createFetchPage(config, { fetcher, robots: { policyFor: async () => ({ available: true, isAllowed: () => true, crawlDelayMs: 5000 }) } });
    await fetchPage("https://a.example.test/x", source, context, "text/calendar");
    expect(fetcher.mock.calls[0][1]).toMatchObject({ minDelayMs: 5000, timeoutMs: config.httpTimeoutMs, maxResponseBytes: config.maxResponseBytes, maxRedirects: config.maxRedirects, accept: "text/calendar", userAgent: config.userAgent });
  });

  it("limits pages per source per run", async () => {
    const fetcher = jest.fn(async () => body);
    const fetchPage = createFetchPage(config, { fetcher, robots: { policyFor: async () => ({ available: true, isAllowed: () => true, crawlDelayMs: null }) } });
    await fetchPage("https://a.example.test/1", source, context);
    await fetchPage("https://a.example.test/2", source, context);
    await expect(fetchPage("https://a.example.test/3", source, context)).rejects.toThrow(/Page limit/);
    await expect(fetchPage("https://a.example.test/1", source, { ...context, runId: "r2" })).resolves.toBeDefined();
  });
});
