/**
 * @jest-environment node
 */
import { MemoryDb } from "./helpers/memory-db";
import fixtures from "./fixtures/end-to-end-events.json";
import type { AdapterRegistry } from "@/lib/ingestion/adapters/registry";
import { INGESTION_DEFAULTS } from "@/lib/ingestion/config";
import type { IngestionClient } from "@/lib/ingestion/storage/client";
import type { CandidateRow } from "@/lib/ingestion/storage/rows";
import type { RawEvent } from "@/lib/ingestion/types";
import { type DailyCollectionConfig, runDailyCollection } from "@/lib/ingestion/workers/daily-collection";
import { runReplay } from "@/lib/ingestion/workers/replay-worker";

const NOW = new Date("2031-11-20T12:00:00Z");
const EVENT_ID = "11111111-2222-4333-8444-555555555555";
const SHADOW: DailyCollectionConfig = { ...INGESTION_DEFAULTS, publishMode: "shadow", maxConcurrency: 3 };
const LIVE: DailyCollectionConfig = { ...SHADOW, publishMode: "live" };
const GEOS = {
  charlotte: { latitude: 35.2271, longitude: -80.8431, formattedAddress: "x", provider: "mock", verified: true },
  far: { latitude: 34.0522, longitude: -118.2437, formattedAddress: "x", provider: "mock", verified: true },
  none: null,
} as const;

interface Fixture {
  name: string;
  externalEventId: string;
  overrides: Partial<RawEvent>;
  geo: keyof typeof GEOS;
  expect: { status: string; isMarket?: boolean };
}
const FIXTURES = fixtures as unknown as Fixture[];

function rawFrom(sourceId: string, fixture: Fixture): RawEvent {
  return {
    sourceId,
    externalEventId: fixture.externalEventId,
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
    ...fixture.overrides,
  };
}

function pipeline(config: DailyCollectionConfig) {
  const db = new MemoryDb();
  const [source] = db.seed("ingestion.sources", [{ name: "Fixture Source", base_url: "https://a.example.test", source_type: "organizer", adapter: "html", trust_state: "trusted", successful_runs: 10, valid_events: 30 }]);
  const geoByAddress = new Map<string, (typeof GEOS)[keyof typeof GEOS]>();
  const events = FIXTURES.map((f) => {
    const raw = rawFrom(source.id as string, f);
    if (raw.address) geoByAddress.set(raw.address, GEOS[f.geo]);
    return raw;
  });
  const registry: Pick<AdapterRegistry, "resolve"> = { resolve: () => ({ type: "html", collect: async (def) => ({ sourceId: def.id, success: true, events, discoveredUrls: [], error: null }) }) };
  db.rpcHandlers.set("ingestion.publish_candidate", (args) => {
    const row = db.rows("ingestion.candidates").find((c) => c.id === args.p_candidate_id);
    if (row) Object.assign(row, { status: "published", published_event_id: EVENT_ID });
    return { data: EVENT_ID };
  });
  const client = db.client() as unknown as IngestionClient;
  const collect = () => runDailyCollection({ client, config, registry, geocode: async (address) => geoByAddress.get(address) ?? null, now: () => NOW, sleep: async () => undefined });
  const candidates = () => db.rows("ingestion.candidates") as unknown as CandidateRow[];
  return { db, client, source, collect, candidates, geo: (a: string) => geoByAddress.get(a) ?? null };
}

describe("end-to-end: shadow pipeline over the fixture set", () => {
  it.each(FIXTURES)("$name -> $expect.status", async (fixture) => {
    const p = pipeline(SHADOW);
    await p.collect();
    const candidate = p.candidates().find((c) => c.external_event_id === fixture.externalEventId);
    if (fixture.expect.status === "invalid") {
      expect(candidate).toBeUndefined();
      return;
    }
    expect(candidate).toBeDefined();
    expect(candidate?.status).toBe(fixture.expect.status);
    if (fixture.expect.isMarket !== undefined) expect(candidate?.is_market).toBe(fixture.expect.isMarket);
  });

  it("keeps raw evidence for every event, including rejected and invalid ones", async () => {
    const p = pipeline(SHADOW);
    const summary = await p.collect();
    expect(summary).toMatchObject({ status: "succeeded", observationsFound: FIXTURES.length });
    expect(p.db.rows("ingestion.observations")).toHaveLength(FIXTURES.length);
    expect(p.candidates()).toHaveLength(FIXTURES.length - FIXTURES.filter((f) => f.expect.status === "invalid").length);
  });

  it("makes zero production writes in shadow mode and records the shadow decision", async () => {
    const p = pipeline(SHADOW);
    const summary = await p.collect();
    expect(summary).toMatchObject({ candidatesPublished: 0, shadowDecisions: 1 });
    expect(p.db.rows("public.events")).toHaveLength(0);
    expect(p.db.rows("public.event_ingestion_links")).toHaveLength(0);
    expect(p.db.rpcCalls.filter((c) => c.name === "ingestion.publish_candidate")).toHaveLength(0);
    expect(p.candidates().filter((c) => c.status === "published")).toHaveLength(0);
  });

  it("is idempotent across repeated collections and replay", async () => {
    const p = pipeline(SHADOW);
    await p.collect();
    // The score is excluded on purpose: it includes the source's track record, which each collection updates.
    const snapshot = () => Object.fromEntries(p.candidates().map((c) => [c.external_event_id, { status: c.status, duplicate: c.duplicate_state, reasons: c.validation_reasons, title: c.title, key: c.canonical_key, event: c.published_event_id }]));
    const before = snapshot();
    const observations = p.db.rows("ingestion.observations").length;

    const second = await p.collect();
    expect(second.candidatesCreated).toBe(0);
    const replay = await runReplay({ client: p.client, config: SHADOW, geocode: async (a) => p.geo(a), now: () => NOW });
    expect(replay).toMatchObject({ candidatesCreated: 0, processingErrors: 0 });
    expect(snapshot()).toEqual(before);
    expect(p.db.rows("ingestion.observations")).toHaveLength(observations);
  });
});

describe("end-to-end: live mode (test environment only)", () => {
  it("publishes only ready candidates, once, through the publisher", async () => {
    const p = pipeline(LIVE);
    const first = await p.collect();
    expect(first.candidatesPublished).toBe(1);
    const calls = p.db.rpcCalls.filter((c) => c.name === "ingestion.publish_candidate");
    expect(calls).toHaveLength(1);
    const published = p.candidates().filter((c) => c.status === "published");
    expect(published.map((c) => c.external_event_id)).toEqual(["e2e-valid"]);
    expect(p.candidates().filter((c) => c.status === "needs_review" || c.status === "rejected").every((c) => !c.published_event_id)).toBe(true);

    const second = await p.collect();
    expect(second.candidatesPublished).toBe(0);
    expect(p.db.rpcCalls.filter((c) => c.name === "ingestion.publish_candidate")).toHaveLength(1);
  });
});
