/**
 * @jest-environment node
 */
import { MemoryDb } from "./helpers/memory-db";
import { eventFromJsonLd } from "@/lib/ingestion/adapters/jsonld";
import { processRawEvent, verifiedSourceCoordinates, type ProcessDependencies } from "@/lib/ingestion/process-candidate";
import { rawEventFromObservation } from "@/lib/ingestion/workers/replay-worker";
import { configureGeocodeProvider } from "@/lib/ingestion/validation/geocode";
import type { IngestionClient } from "@/lib/ingestion/storage/client";
import type { CandidateRow, SourceRow } from "@/lib/ingestion/storage/rows";
import type { RawEvent } from "@/lib/ingestion/types";

const NOW = new Date("2031-11-20T12:00:00Z");
const CONFIG = { centerLat: 35.2271, centerLng: -80.8431, radiusMiles: 35, horizonDays: 60, minVendorCount: 3, autoPublishScore: 90, reviewScore: 70 };
const ADDRESS = "100 Example St, Charlotte, NC 28202";

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
    address: ADDRESS,
    vendorCount: 45,
    evidence: ["45 local vendors"],
    categories: [],
    cancelled: false,
    rawPayload: {},
    coordinates: { latitude: 35.22712, longitude: -80.84314, origin: "jsonld-place-geo" },
    ...overrides,
  };
}

function setup(configuration: Record<string, unknown> = {}) {
  const db = new MemoryDb();
  const [source] = db.seed("ingestion.sources", [
    { name: "A", base_url: "https://a.example.test", source_type: "organizer", adapter: "jsonld", trust_state: "trusted", successful_runs: 10, valid_events: 30, configuration },
  ]);
  // No `geocode` override unless a test passes one: the default is the real entrypoint path with no provider configured.
  const deps = (overrides: Partial<ProcessDependencies> = {}): ProcessDependencies => ({ client: db.client() as unknown as IngestionClient, config: CONFIG, source: source as unknown as SourceRow, now: () => NOW, ...overrides });
  return { db, source: source as unknown as SourceRow, deps, candidates: () => db.rows("ingestion.candidates") as unknown as CandidateRow[] };
}

beforeEach(() => configureGeocodeProvider(null));

describe("real entrypoint without a geocoder", () => {
  it("fails closed: an address alone never becomes verified coordinates", async () => {
    const { deps, candidates } = setup();
    const result = await processRawEvent(deps(), raw({ coordinates: null }));
    expect(result.kind).toBe("candidate");
    const [candidate] = candidates();
    expect(candidate.location_verified).toBe(false);
    expect(candidate.latitude).toBeNull();
    expect(candidate.status).not.toBe("ready");
  });

  it("ignores unverified source coordinates: they are kept as evidence only, not as a pin", async () => {
    const { deps, candidates } = setup({});
    await processRawEvent(deps(), raw());
    const [candidate] = candidates();
    expect(candidate.location_verified).toBe(false);
    expect(candidate.latitude).toBeNull();
    expect(candidate.status).not.toBe("ready");
  });
});

describe("precedence between the geocoder and source coordinates", () => {
  const unverified = async () => ({ latitude: 35.3, longitude: -80.7, formattedAddress: "approx", provider: "mock", verified: false });
  const verified = async () => ({ latitude: 35.2271, longitude: -80.8431, formattedAddress: "exact", provider: "mock", verified: true });

  it("an unverified geocode does not suppress operator-verified source coordinates", async () => {
    const { deps, candidates } = setup({ coordinateTrust: "verified" });
    await processRawEvent(deps({ geocode: unverified }), raw());
    expect(candidates()[0]).toMatchObject({ location_verified: true, latitude: 35.22712, longitude: -80.84314, status: "ready" });
  });

  it("an unverified geocode stays unverified when the source is not coordinate-trusted", async () => {
    for (const configuration of [{}, { coordinateTrust: true }, { coordinateTrust: "unverified" }]) {
      const { deps, candidates } = setup(configuration);
      await processRawEvent(deps({ geocode: unverified }), raw());
      expect(candidates()[0]).toMatchObject({ location_verified: false, latitude: 35.3, longitude: -80.7 });
      expect(candidates()[0].status).not.toBe("ready");
    }
  });

  it("an unverified geocode stays unverified when trusted source coordinates fail precision, origin or address checks", async () => {
    const bad: Partial<RawEvent>[] = [
      { coordinates: { latitude: 35.22, longitude: -80.84, origin: "jsonld-place-geo" } },
      { coordinates: { latitude: 35.22712, longitude: -80.84314, origin: "html" } as unknown as RawEvent["coordinates"] },
      { coordinates: null },
    ];
    for (const override of bad) {
      const { deps, candidates } = setup({ coordinateTrust: "verified" });
      await processRawEvent(deps({ geocode: unverified }), raw(override));
      expect(candidates()[0]).toMatchObject({ location_verified: false, latitude: 35.3, longitude: -80.7 });
    }
  });

  it("a verified geocode wins over source coordinates", async () => {
    const { deps, candidates } = setup({ coordinateTrust: "verified" });
    await processRawEvent(deps({ geocode: verified }), raw({ coordinates: { latitude: 35.30001, longitude: -80.70001, origin: "jsonld-place-geo" } }));
    expect(candidates()[0]).toMatchObject({ location_verified: true, latitude: 35.2271, longitude: -80.8431 });
  });

  it("the radius gate still applies to trusted source coordinates after an unverified geocode", async () => {
    const { deps, candidates } = setup({ coordinateTrust: "verified" });
    await processRawEvent(deps({ geocode: unverified }), raw({ coordinates: { latitude: 33.749, longitude: -84.388, origin: "jsonld-place-geo" } }));
    expect(candidates()[0].status).not.toBe("ready");
  });

  it("a geocoder that finds nothing still lets trusted source coordinates verify the location", async () => {
    const { deps, candidates } = setup({ coordinateTrust: "verified" });
    await processRawEvent(deps({ geocode: async () => null }), raw());
    expect(candidates()[0]).toMatchObject({ location_verified: true, status: "ready" });
  });
});

describe("source coordinates are trusted only with proof", () => {
  it("accepts precise structured coordinates from a source an operator marked as verified", async () => {
    const { deps, candidates } = setup({ coordinateTrust: "verified" });
    await processRawEvent(deps(), raw());
    const [candidate] = candidates();
    expect(candidate).toMatchObject({ location_verified: true, latitude: 35.22712, longitude: -80.84314, status: "ready" });
  });

  it.each([
    ["no address to tie them to", { address: null }],
    ["a city-centroid precision pair", { coordinates: { latitude: 35.22, longitude: -80.84, origin: "jsonld-place-geo" as const } }],
    ["the null island pair", { coordinates: { latitude: 0, longitude: 0, origin: "jsonld-place-geo" as const } }],
    ["out of range values", { coordinates: { latitude: 135.2271, longitude: -80.8431, origin: "jsonld-place-geo" as const } }],
    ["an unknown origin", { coordinates: { latitude: 35.22712, longitude: -80.84314, origin: "html" } as unknown as RawEvent["coordinates"] }],
  ])("rejects %s", (_label, override) => {
    const { source } = setup({ coordinateTrust: "verified" });
    expect(verifiedSourceCoordinates(raw(override as Partial<RawEvent>), source)).toBeNull();
  });

  it("never trusts coordinates when the operator flag is absent or not exactly 'verified'", () => {
    for (const configuration of [{}, { coordinateTrust: true }, { coordinateTrust: "unverified" }]) {
      expect(verifiedSourceCoordinates(raw(), setup(configuration).source)).toBeNull();
    }
  });

  it("verified coordinates still go through the radius gate", async () => {
    const { deps, candidates } = setup({ coordinateTrust: "verified" });
    await processRawEvent(deps(), raw({ coordinates: { latitude: 33.7490, longitude: -84.3880, origin: "jsonld-place-geo" } }));
    const [candidate] = candidates();
    expect(candidate.status).not.toBe("ready");
  });
});

describe("JSON-LD coordinate extraction and replay", () => {
  const source = { id: "src", name: "A", baseUrl: "https://a.example.test", sourceType: "organizer", adapter: "jsonld", configuration: {} } as never;
  const node = (location: unknown) => ({ "@type": "Event", name: "Market", startDate: "2031-12-06T10:00:00", location });

  it("reads geo only from a Place that also has a street address", () => {
    const place = { "@type": "Place", name: "Pavilion", address: { streetAddress: "100 Example St", addressLocality: "Charlotte", addressRegion: "NC", postalCode: "28202" }, geo: { "@type": "GeoCoordinates", latitude: "35.22712", longitude: -80.84314 } };
    expect(eventFromJsonLd(node(place), source, "https://a.example.test/e").coordinates).toEqual({ latitude: 35.22712, longitude: -80.84314, origin: "jsonld-place-geo" });
    expect(eventFromJsonLd(node({ ...place, address: undefined }), source, "https://a.example.test/e").coordinates).toBeNull();
    expect(eventFromJsonLd(node({ ...place, address: "Charlotte" }), source, "https://a.example.test/e").coordinates).toBeNull();
    expect(eventFromJsonLd(node({ ...place, geo: { latitude: "abc", longitude: "1" } }), source, "https://a.example.test/e").coordinates).toBeNull();
  });

  it("keeps coordinates when a stored observation is replayed", () => {
    const stored = JSON.parse(JSON.stringify(raw())) as Record<string, unknown>;
    const replayed = rawEventFromObservation({ source_id: "src", source_url: "https://a.example.test/e", external_event_id: null, raw_payload: stored } as never);
    expect(replayed?.coordinates).toEqual({ latitude: 35.22712, longitude: -80.84314, origin: "jsonld-place-geo" });
    stored.coordinates = { latitude: 1, longitude: 2, origin: "anything" };
    expect(rawEventFromObservation({ source_id: "src", source_url: "https://a.example.test/e", external_event_id: null, raw_payload: stored } as never)?.coordinates).toBeNull();
  });
});
