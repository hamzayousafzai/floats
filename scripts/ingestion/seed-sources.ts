import { loadIngestionConfig } from "@/lib/ingestion/config";
import { runCli } from "@/lib/ingestion/log";
import { normalizeSourceUrl } from "@/lib/ingestion/normalize/normalize-url";
import { createIngestionClient, type IngestionClient } from "@/lib/ingestion/storage/client";
import { upsertSource } from "@/lib/ingestion/storage/sources";
import type { AdapterType, SourceType } from "@/lib/ingestion/types";

export interface SeedSource {
  name: string;
  baseUrl: string;
  sourceType: SourceType;
  adapter: AdapterType;
  discoveryOnly: boolean;
  /** When set, the source is registered disabled and the reason is recorded in its configuration. */
  restrictedReason?: string;
  configuration: Record<string, unknown>;
}

/**
 * Operator access review, performed against each site's published robots.txt on 2026-11-20.
 * Robots rules were permissive for generic crawlers on the listed paths; Squarespace sites disallow
 * `?format=json` / `?format=ical` variants and many AI-training user agents, so neither is used.
 * Site terms of service were not machine-verifiable and need human confirmation before live promotion.
 * Runtime robots checks remain mandatory (see lib/ingestion/security/robots.ts).
 */
const ACCESS_REVIEW = {
  robotsTxt: "allowed-for-generic-crawlers",
  checkedAt: "2026-11-20",
  termsOfServiceReviewed: false,
} as const;

export const SEED_SOURCES: readonly SeedSource[] = [
  {
    name: "Makers Market CLT",
    baseUrl: "https://www.makersmarketclt.com/markets",
    sourceType: "organizer",
    adapter: "html",
    discoveryOnly: false,
    configuration: { accessReview: { ...ACCESS_REVIEW, platform: "wix", notes: "robots.txt: User-agent * Allow /" }, adapterKey: "makers-market-clt" },
  },
  {
    name: "Urban District Market",
    baseUrl: "https://www.udmmilldistrict.com/calendar",
    sourceType: "venue",
    adapter: "html",
    discoveryOnly: false,
    configuration: {
      accessReview: { ...ACCESS_REVIEW, platform: "squarespace", notes: "/calendar allowed; ?format=ical and ?format=json variants are disallowed and never requested" },
      adapterKey: "urban-district-market",
    },
  },
  {
    name: "Esther and Elsa",
    baseUrl: "https://www.estherandelsaretail.com/frontporchclt",
    sourceType: "organizer",
    adapter: "html",
    discoveryOnly: false,
    configuration: {
      accessReview: { ...ACCESS_REVIEW, platform: "squarespace", notes: "/frontporchclt allowed; ?format= variants are disallowed and never requested" },
      adapterKey: "esther-elsa",
    },
  },
];

/** Canonical form of a seed URL; shares the ingestion-wide URL normalizer. */
export function canonicalSeedUrl(value: string): string {
  return normalizeSourceUrl(value);
}

export interface SeedResult {
  id: string;
  name: string;
  baseUrl: string;
  created: boolean;
  enabled: boolean;
  trustState: string;
}

export async function seedSources(client: IngestionClient, seeds: readonly SeedSource[] = SEED_SOURCES): Promise<SeedResult[]> {
  const results: SeedResult[] = [];
  for (const seed of seeds) {
    const restricted = Boolean(seed.restrictedReason);
    const { source, created } = await upsertSource(client, {
      name: seed.name,
      baseUrl: canonicalSeedUrl(seed.baseUrl),
      sourceType: seed.sourceType,
      adapter: seed.adapter,
      discoveryOnly: seed.discoveryOnly,
      enabled: !restricted,
      forceDisable: restricted,
      configuration: restricted ? { ...seed.configuration, disabledReason: seed.restrictedReason } : seed.configuration,
    });
    results.push({ id: source.id, name: source.name, baseUrl: source.base_url, created, enabled: source.enabled, trustState: source.trust_state });
  }
  return results;
}

function isLoopback(url: string): boolean {
  const host = new URL(url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const config = loadIngestionConfig();
  if (!isLoopback(config.supabaseUrl) && !argv.includes("--allow-remote")) {
    throw new Error("Refusing to seed a non-local Supabase project. Re-run with --allow-remote after explicit approval.");
  }
  const results = await seedSources(createIngestionClient());
  for (const r of results) {
    console.log(`${r.created ? "created" : "exists "} ${r.trustState} enabled=${r.enabled} ${r.baseUrl}`);
  }
}

if (require.main === module) {
  void runCli("ingest:seed", () => main());
}
