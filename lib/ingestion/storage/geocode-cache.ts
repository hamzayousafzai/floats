export interface GeocodeResult {
  latitude: number;
  longitude: number;
  formattedAddress: string;
  provider: string;
  verified: boolean;
}

/** A cached value of `null` records a definitive "no match" so unresolved addresses are not re-queried every run. */
export interface GeocodeCache {
  get(key: string): GeocodeResult | null | undefined;
  set(key: string, value: GeocodeResult | null): void;
}

export interface MemoryGeocodeCacheOptions {
  maxEntries?: number;
  ttlMs?: number;
  negativeTtlMs?: number;
  now?: () => number;
}

interface Entry {
  value: GeocodeResult | null;
  expiresAt: number;
}

/**
 * Process-local cache. The migration defines no geocode table, so results are not persisted between runs; persistence
 * would need a new table and is deliberately not added here.
 */
export class MemoryGeocodeCache implements GeocodeCache {
  private readonly entries = new Map<string, Entry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly negativeTtlMs: number;
  private readonly now: () => number;

  constructor(options: MemoryGeocodeCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 2000;
    this.ttlMs = options.ttlMs ?? 30 * 24 * 60 * 60 * 1000;
    this.negativeTtlMs = options.negativeTtlMs ?? 24 * 60 * 60 * 1000;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): GeocodeResult | null | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value === null ? null : { ...entry.value };
  }

  set(key: string, value: GeocodeResult | null): void {
    this.entries.delete(key);
    this.entries.set(key, { value: value === null ? null : { ...value }, expiresAt: this.now() + (value === null ? this.negativeTtlMs : this.ttlMs) });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
