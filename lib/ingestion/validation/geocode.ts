import { normalizeAddress } from "@/lib/ingestion/normalize/normalize-address";
import { type GeocodeCache, type GeocodeResult, MemoryGeocodeCache } from "@/lib/ingestion/storage/geocode-cache";
import { isValidCoordinate } from "./within-radius";

export type { GeocodeResult } from "@/lib/ingestion/storage/geocode-cache";

/** Resolves an address. Returns null for "no match"; throws for transport/quota failures. */
export interface GeocodeProvider {
  readonly name: string;
  geocode(address: string, signal: AbortSignal): Promise<{ latitude: number; longitude: number; formattedAddress?: string; verified?: boolean } | null>;
}

export interface GeocodeOptions {
  provider?: GeocodeProvider | null;
  cache?: GeocodeCache;
  timeoutMs?: number;
  onError?: (error: unknown) => void;
}

const MIN_ADDRESS_LENGTH = 10;
const defaultCache = new MemoryGeocodeCache();
let configuredProvider: GeocodeProvider | null = null;

/** No provider is configured by default: the repository has no verified, compliant geocoder (see the repository audit). */
export function configureGeocodeProvider(provider: GeocodeProvider | null): void {
  configuredProvider = provider;
}

/**
 * Returns verified coordinates or null. Null means "unresolved": callers must route the candidate to review and never
 * publish it. Provider failures are not cached; definitive misses are.
 */
export async function geocodeAddress(address: string | null | undefined, options: GeocodeOptions = {}): Promise<GeocodeResult | null> {
  const normalized = normalizeAddress(address);
  if (!normalized || normalized.length < MIN_ADDRESS_LENGTH) return null;
  const provider = options.provider === undefined ? configuredProvider : options.provider;
  if (!provider) return null;

  const cache = options.cache ?? defaultCache;
  const key = `${provider.name}:${normalized}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const found = await provider.geocode(address as string, controller.signal);
    if (!found) {
      cache.set(key, null);
      return null;
    }
    if (!isValidCoordinate(found.latitude, found.longitude)) {
      options.onError?.(new Error("Geocoder returned invalid coordinates"));
      return null;
    }
    const result: GeocodeResult = {
      latitude: found.latitude,
      longitude: found.longitude,
      formattedAddress: (found.formattedAddress ?? address ?? "").trim(),
      provider: provider.name,
      verified: found.verified === true,
    };
    cache.set(key, result);
    return result;
  } catch (error) {
    options.onError?.(error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
