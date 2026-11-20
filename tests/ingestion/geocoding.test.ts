/**
 * @jest-environment node
 */
import { MemoryGeocodeCache } from "@/lib/ingestion/storage/geocode-cache";
import { type GeocodeProvider, configureGeocodeProvider, geocodeAddress } from "@/lib/ingestion/validation/geocode";
import { distanceMeters, isValidCoordinate, isWithinRadius } from "@/lib/ingestion/validation/within-radius";

const CENTER = { centerLat: 35.2271, centerLng: -80.8431, radiusMiles: 35 };
const ADDRESS = "100 Example St, Charlotte, NC 28202";

function provider(impl: GeocodeProvider["geocode"]): GeocodeProvider & { calls: jest.Mock } {
  const calls = jest.fn();
  return {
    name: "mock",
    calls,
    geocode: async (address, signal) => {
      calls(address);
      return impl(address, signal);
    },
  };
}

describe("isWithinRadius", () => {
  it("accepts the center and nearby Charlotte points", () => {
    expect(isWithinRadius(35.2271, -80.8431, CENTER)).toBe(true);
    expect(isWithinRadius(35.2, -80.9, CENTER)).toBe(true);
  });

  it("rejects far locations", () => {
    expect(isWithinRadius(35.7796, -78.6382, CENTER)).toBe(false); // Raleigh, about 130 miles
    expect(isWithinRadius(40.7128, -74.006, CENTER)).toBe(false);
  });

  it("uses radiusMiles * 1609.344 meters with a bounded tolerance at the boundary", () => {
    const radiusMeters = 35 * 1609.344;
    const north = (meters: number) => CENTER.centerLat + (meters / 6_371_008.8) * (180 / Math.PI);
    expect(distanceMeters(CENTER.centerLat, CENTER.centerLng, north(radiusMeters), CENTER.centerLng)).toBeCloseTo(radiusMeters, 0);
    expect(isWithinRadius(north(radiusMeters * 0.99), CENTER.centerLng, CENTER)).toBe(true);
    expect(isWithinRadius(north(radiusMeters * 1.01), CENTER.centerLng, CENTER)).toBe(false);
  });

  it("never treats invalid coordinates as inside", () => {
    for (const [lat, lng] of [[NaN, -80.8], [35.2, Infinity], [91, -80.8], [35.2, -181], [0, 0]]) {
      expect(isWithinRadius(lat, lng, CENTER)).toBe(false);
    }
    expect(isWithinRadius("35.2" as unknown as number, -80.8, CENTER)).toBe(false);
    expect(isValidCoordinate(35.2, -80.8)).toBe(true);
    expect(isValidCoordinate(null, -80.8)).toBe(false);
  });
});

describe("geocodeAddress", () => {
  afterEach(() => configureGeocodeProvider(null));

  it("returns null when no provider is configured, so the candidate cannot be published", async () => {
    await expect(geocodeAddress(ADDRESS)).resolves.toBeNull();
    await expect(geocodeAddress(ADDRESS, { provider: null })).resolves.toBeNull();
  });

  it("does not call the provider for missing or too-short addresses", async () => {
    const p = provider(async () => ({ latitude: 35.2, longitude: -80.8 }));
    for (const value of [null, undefined, "", "   ", "Charlotte"]) {
      await expect(geocodeAddress(value, { provider: p, cache: new MemoryGeocodeCache() })).resolves.toBeNull();
    }
    expect(p.calls).not.toHaveBeenCalled();
  });

  it("returns the provider result with provenance, and verified only when the provider says so", async () => {
    const cache = new MemoryGeocodeCache();
    const ok = provider(async () => ({ latitude: 35.2, longitude: -80.8, formattedAddress: "100 Example St, Charlotte, NC 28202, USA", verified: true }));
    await expect(geocodeAddress(ADDRESS, { provider: ok, cache })).resolves.toEqual({
      latitude: 35.2,
      longitude: -80.8,
      formattedAddress: "100 Example St, Charlotte, NC 28202, USA",
      provider: "mock",
      verified: true,
    });
    const unverified = provider(async () => ({ latitude: 35.2, longitude: -80.8 }));
    expect((await geocodeAddress(ADDRESS, { provider: unverified, cache: new MemoryGeocodeCache() }))?.verified).toBe(false);
  });

  it("uses a configured provider and rejects invalid coordinates without caching them", async () => {
    const errors: unknown[] = [];
    const cache = new MemoryGeocodeCache();
    for (const bad of [{ latitude: NaN, longitude: -80.8 }, { latitude: 95, longitude: -80.8 }, { latitude: 0, longitude: 0 }]) {
      configureGeocodeProvider(provider(async () => bad));
      await expect(geocodeAddress(ADDRESS, { cache, onError: (e) => errors.push(e) })).resolves.toBeNull();
    }
    expect(errors).toHaveLength(3);
    expect(cache.size).toBe(0);
  });

  it("caches by normalized address so formatting variants hit the same entry", async () => {
    const cache = new MemoryGeocodeCache();
    const p = provider(async () => ({ latitude: 35.2, longitude: -80.8, verified: true }));
    await geocodeAddress("2315 North Davidson Street, Charlotte, NC 28205", { provider: p, cache });
    const again = await geocodeAddress("2315 N Davidson St Charlotte NC 28205-1234", { provider: p, cache });
    expect(again?.latitude).toBe(35.2);
    expect(p.calls).toHaveBeenCalledTimes(1);
  });

  it("caches definitive misses but not provider failures", async () => {
    const cache = new MemoryGeocodeCache();
    const miss = provider(async () => null);
    await geocodeAddress(ADDRESS, { provider: miss, cache });
    await geocodeAddress(ADDRESS, { provider: miss, cache });
    expect(miss.calls).toHaveBeenCalledTimes(1);

    const onError = jest.fn();
    const failing = provider(async () => {
      throw new Error("quota exceeded");
    });
    const failCache = new MemoryGeocodeCache();
    await expect(geocodeAddress(ADDRESS, { provider: failing, cache: failCache, onError })).resolves.toBeNull();
    await expect(geocodeAddress(ADDRESS, { provider: failing, cache: failCache, onError })).resolves.toBeNull();
    expect(failing.calls).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(failCache.size).toBe(0);
  });

  it("aborts a provider that does not respond within the timeout", async () => {
    const slow = provider((_address, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))));
    const onError = jest.fn();
    await expect(geocodeAddress(ADDRESS, { provider: slow, cache: new MemoryGeocodeCache(), timeoutMs: 20, onError })).resolves.toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe("MemoryGeocodeCache", () => {
  const value = { latitude: 35.2, longitude: -80.8, formattedAddress: "x", provider: "mock", verified: true };

  it("expires entries, with a shorter lifetime for misses", () => {
    let now = 1000;
    const cache = new MemoryGeocodeCache({ ttlMs: 100, negativeTtlMs: 10, now: () => now });
    cache.set("hit", value);
    cache.set("miss", null);
    now += 11;
    expect(cache.get("miss")).toBeUndefined();
    expect(cache.get("hit")).toEqual(value);
    now += 100;
    expect(cache.get("hit")).toBeUndefined();
  });

  it("evicts the oldest entries beyond its bound and returns copies", () => {
    const cache = new MemoryGeocodeCache({ maxEntries: 2 });
    cache.set("a", value);
    cache.set("b", value);
    cache.set("c", value);
    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBeUndefined();
    const copy = cache.get("b");
    copy!.latitude = 0;
    expect(cache.get("b")?.latitude).toBe(35.2);
  });
});
