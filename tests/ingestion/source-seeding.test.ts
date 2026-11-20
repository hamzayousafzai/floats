/**
 * @jest-environment node
 */
import { MemoryDb } from "./helpers/memory-db";
import type { IngestionClient } from "@/lib/ingestion/storage/client";
import { SEED_SOURCES, canonicalSeedUrl, main, seedSources } from "@/scripts/ingestion/seed-sources";

function setup() {
  const db = new MemoryDb();
  return { db, client: db.client() as unknown as IngestionClient };
}

describe("seed definitions", () => {
  it("contain the three spec sources with their specified URLs", () => {
    expect(SEED_SOURCES.map((s) => s.baseUrl)).toEqual([
      "https://www.makersmarketclt.com/markets",
      "https://www.udmmilldistrict.com/calendar",
      "https://www.estherandelsaretail.com/frontporchclt",
    ]);
    expect(SEED_SOURCES.map((s) => s.sourceType)).toEqual(["organizer", "venue", "organizer"]);
    expect(SEED_SOURCES.every((s) => s.adapter === "html" && !s.discoveryOnly)).toBe(true);
  });

  it("record the access review and never request disallowed format variants", () => {
    for (const s of SEED_SOURCES) {
      const review = s.configuration.accessReview as Record<string, unknown>;
      expect(review.checkedAt).toBe("2026-11-20");
      expect(review.termsOfServiceReviewed).toBe(false);
      expect(s.baseUrl).not.toMatch(/format=/);
    }
  });
});

describe("canonicalSeedUrl", () => {
  it("normalises host case, fragments, trackers and trailing slashes", () => {
    expect(canonicalSeedUrl("https://WWW.Example.COM/markets/?utm_source=x&b=2&a=1#top")).toBe("https://www.example.com/markets?a=1&b=2");
    expect(canonicalSeedUrl("https://example.com/")).toBe("https://example.com/");
    expect(canonicalSeedUrl("https://example.com:443/x")).toBe("https://example.com/x");
  });
});

describe("seedSources", () => {
  it("creates three probation sources and is stable when run twice", async () => {
    const { db, client } = setup();
    const first = await seedSources(client);
    const second = await seedSources(client);
    expect(db.rows("ingestion.sources")).toHaveLength(3);
    expect(first.every((r) => r.created && r.trustState === "probation" && r.enabled)).toBe(true);
    expect(second.every((r) => !r.created)).toBe(true);
    expect(second.map((r) => r.id)).toEqual(first.map((r) => r.id));
  });

  it("never promotes: reseeding keeps an admin-trusted source trusted and an admin-disabled one disabled", async () => {
    const { db, client } = setup();
    await seedSources(client);
    Object.assign(db.rows("ingestion.sources")[0], { trust_state: "trusted" });
    Object.assign(db.rows("ingestion.sources")[1], { enabled: false });
    await seedSources(client);
    expect(db.rows("ingestion.sources")[0].trust_state).toBe("trusted");
    expect(db.rows("ingestion.sources")[1].enabled).toBe(false);
  });

  it("registers restricted sources disabled with a recorded reason, without removing earlier configuration", async () => {
    const { db, client } = setup();
    const restricted = [{ ...SEED_SOURCES[0], restrictedReason: "robots.txt disallows automated access" }];
    const [result] = await seedSources(client, restricted);
    expect(result.enabled).toBe(false);
    expect(result.trustState).toBe("probation");
    const config = db.rows("ingestion.sources")[0].configuration as Record<string, unknown>;
    expect(config.disabledReason).toBe("robots.txt disallows automated access");
    expect(config.adapterKey).toBe("makers-market-clt");
  });
});

describe("seed CLI", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it("refuses a non-local Supabase project without --allow-remote and does not leak the key", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-test-only";
    await expect(main([])).rejects.toThrow(/Refusing to seed a non-local/);
    await main([]).catch((e: Error) => expect(e.message).not.toContain("service-role-key"));
  });

  it("fails clearly without configuration", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await expect(main([])).rejects.toThrow(/Invalid ingestion configuration/);
  });
});
