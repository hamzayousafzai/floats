/**
 * @jest-environment node
 */
import { MemoryDb } from "./helpers/memory-db";
import type { AdapterDeps } from "@/lib/ingestion/adapters/common";
import { INGESTION_DEFAULTS } from "@/lib/ingestion/config";
import { canonicalDomain, isIgnoredDomain, isSafeCandidateUrl, restrictedReason } from "@/lib/ingestion/discovery/canonicalize-domain";
import { detectAdapter } from "@/lib/ingestion/discovery/detect-adapter";
import { type DiscoveryDeps, runDiscovery } from "@/lib/ingestion/discovery/discover-sources";
import { eventLikeUrls, extractLinks, parseSitemap } from "@/lib/ingestion/discovery/extract-links";
import type { IngestionClient } from "@/lib/ingestion/storage/client";

const NOW = new Date("2031-11-20T12:00:00Z");
const JSONLD = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","name":"Pop-up Market","startDate":"2031-12-06T10:00:00","location":{"@type":"Place","name":"Hall"}}</script></head><body>Market</body></html>`;
const ICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:1@example.test\r\nSUMMARY:Craft Fair\r\nDTSTART:20311206T100000\r\nDTEND:20311206T160000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
const PLAIN = "<html><body><h1>Our shop</h1><p>No structured data here.</p></body></html>";

const html = (links: string[]) => `<html><body>${links.map((l) => `<a href="${l}">link</a>`).join("")}</body></html>`;

type Page = { body: string; contentType?: string } | { error: string };

function harness(pages: Record<string, Page>, config = { ...INGESTION_DEFAULTS }) {
  const db = new MemoryDb();
  const calls: string[] = [];
  const fetchPage: AdapterDeps["fetchPage"] = async (url) => {
    calls.push(url);
    const page = pages[url];
    if (!page) throw new Error("Unexpected HTTP status 404");
    if ("error" in page) throw new Error(page.error);
    return { finalUrl: url, status: 200, contentType: page.contentType ?? "text/html", body: page.body, etag: null, lastModified: null };
  };
  const addSource = (name: string, baseUrl: string, overrides: Record<string, unknown> = {}) =>
    db.seed("ingestion.sources", [{ name, base_url: baseUrl, source_type: "organizer", adapter: "html", trust_state: "trusted", enabled: true, successful_runs: 10, ...overrides }])[0] as { id: string };
  const run = (overrides: Partial<DiscoveryDeps> = {}) => runDiscovery({ client: db.client() as unknown as IngestionClient, config, fetchPage, now: () => NOW, ...overrides });
  const discoveries = () => db.rows("ingestion.source_discoveries") as unknown as { discovered_url: string; evaluation: string; reason: string; adapter_detected: string | null; registered_source_id: string | null; parent_source_id: string | null }[];
  const sources = () => db.rows("ingestion.sources") as unknown as { id: string; base_url: string; trust_state: string; enabled: boolean; adapter: string; configuration: Record<string, unknown> }[];
  const runs = () => db.rows("ingestion.runs") as unknown as Record<string, unknown>[];
  return { db, calls, addSource, run, discoveries, sources, runs };
}

describe("runDiscovery: evaluation and registration", () => {
  const SEED = "https://seed.example.test/markets";
  const pages: Record<string, Page> = {
    [SEED]: {
      body: html([
        "https://organizer.example.org/",
        "https://www.organizer.example.org/events?utm_source=seed",
        "https://feeds.example.com/calendar.ics",
        "https://plain.example.net/",
        "https://www.facebook.com/somemarket",
        "https://10.0.0.5/admin",
        "https://blocked.example.io/",
        "https://flaky.example.dev/",
        "https://known.example.test/",
        "mailto:someone@example.org",
      ]),
    },
    "https://organizer.example.org/": { body: JSONLD },
    "https://feeds.example.com/calendar.ics": { body: ICS, contentType: "text/calendar" },
    "https://plain.example.net/": { body: PLAIN },
    "https://blocked.example.io/": { error: "Blocked by robots.txt" },
    "https://flaky.example.dev/": { error: "Request timed out" },
  };

  it("stores compatible, unsupported and restricted results and registers compatible sources as disabled probation only", async () => {
    const h = harness(pages);
    const seed = h.addSource("Seed", SEED);
    h.addSource("Known", "https://known.example.test/", { enabled: false });
    const summary = await h.run();

    expect(summary).toMatchObject({ status: "succeeded", compatible: 2, unsupported: 1, restricted: 3, registered: 2 });
    const byUrl = Object.fromEntries(h.discoveries().map((d) => [d.discovered_url, d]));
    expect(byUrl["https://organizer.example.org/"]).toMatchObject({ evaluation: "compatible", adapter_detected: "jsonld", parent_source_id: seed.id });
    expect(byUrl["https://feeds.example.com/calendar.ics"]).toMatchObject({ evaluation: "compatible", adapter_detected: "ics" });
    expect(byUrl["https://plain.example.net/"]).toMatchObject({ evaluation: "unsupported", adapter_detected: null });
    expect(byUrl["https://www.facebook.com/somemarket"]).toMatchObject({ evaluation: "restricted" });
    expect(byUrl["https://10.0.0.5/admin"]).toMatchObject({ evaluation: "restricted", reason: expect.stringContaining("Unsafe") });
    expect(byUrl["https://blocked.example.io/"]).toMatchObject({ evaluation: "restricted", reason: "Blocked by robots.txt" });

    const registered = h.sources().filter((s) => s.id !== seed.id && !s.base_url.includes("known."));
    expect(registered.map((s) => s.base_url).sort()).toEqual(["https://feeds.example.com/calendar.ics", "https://organizer.example.org/"]);
    for (const source of registered) {
      expect(source).toMatchObject({ trust_state: "probation", enabled: false });
      expect(source.configuration).toMatchObject({ discovery: { parentSourceId: seed.id } });
    }
    expect(h.discoveries().filter((d) => d.registered_source_id).map((d) => d.evaluation)).toEqual(["compatible", "compatible"]);
  });

  it("never fetches unsafe or restricted candidates", async () => {
    const h = harness(pages);
    h.addSource("Seed", SEED);
    await h.run();
    expect(h.calls).not.toContain("https://10.0.0.5/admin");
    expect(h.calls).not.toContain("https://www.facebook.com/somemarket");
  });

  it("evaluates a domain once even when it is linked in several forms", async () => {
    const h = harness(pages);
    h.addSource("Seed", SEED);
    await h.run();
    expect(h.calls.filter((u) => u.includes("organizer.example.org"))).toHaveLength(1);
  });

  it("ignores already-known domains and does not re-evaluate anything on a repeat run", async () => {
    const h = harness(pages);
    h.addSource("Seed", SEED);
    h.addSource("Known", "https://known.example.test/", { enabled: false });
    await h.run();
    expect(h.calls).not.toContain("https://known.example.test/");
    const sourceCount = h.sources().length;
    const discoveryCount = h.discoveries().length;
    h.calls.length = 0;

    const second = await h.run();
    expect(second).toMatchObject({ status: "succeeded", compatible: 0, registered: 0 });
    expect(h.sources()).toHaveLength(sourceCount);
    expect(h.discoveries()).toHaveLength(discoveryCount);
    // Only the seed pages and the transiently failed (unrecorded) candidate are fetched again.
    expect(h.calls.filter((u) => !u.startsWith("https://seed.example.test"))).toEqual(["https://flaky.example.dev/"]);
  });

  it("leaves transient fetch failures unrecorded so the next run retries them", async () => {
    const h = harness(pages);
    h.addSource("Seed", SEED);
    const summary = await h.run();
    expect(h.discoveries().some((d) => d.discovered_url.includes("flaky"))).toBe(false);
    expect(summary.seeds[0].fetchErrors).toBeGreaterThan(0);
  });

  it("never changes or promotes an existing source, including trusted ones", async () => {
    const h = harness(pages);
    h.addSource("Seed", SEED);
    const trusted = h.addSource("Organizer already", "https://organizer.example.org", { trust_state: "trusted", enabled: true, adapter: "html" });
    await h.run();
    expect(h.sources().find((s) => s.id === trusted.id)).toMatchObject({ trust_state: "trusted", enabled: true, adapter: "html" });
    expect(h.sources().filter((s) => s.base_url.includes("organizer.example.org"))).toHaveLength(1);
    expect(h.sources().filter((s) => s.trust_state === "trusted")).toHaveLength(2);
  });

  it("creates no candidates, observations or production events", async () => {
    const h = harness(pages);
    h.addSource("Seed", SEED);
    await h.run();
    expect(h.db.rows("ingestion.candidates")).toHaveLength(0);
    expect(h.db.rows("ingestion.observations")).toHaveLength(0);
    expect(h.db.rows("public.events")).toHaveLength(0);
    expect(h.db.rpcCalls).toHaveLength(0);
  });
});

describe("runDiscovery: bounds", () => {
  it("never goes deeper than the depth limit", async () => {
    const pages: Record<string, Page> = {
      "https://seed.example.test/": { body: html(["/events/1"]) },
      "https://seed.example.test/events/1": { body: html(["/events/2"]) },
      "https://seed.example.test/events/2": { body: html(["/events/3"]) },
      "https://seed.example.test/events/3": { body: html(["/events/4"]) },
      "https://seed.example.test/events/4": { body: html([]) },
    };
    const h = harness(pages);
    h.addSource("Seed", "https://seed.example.test/");
    await h.run();
    const fetched = h.calls.filter((u) => u.includes("/events/"));
    expect(fetched).toEqual(["https://seed.example.test/events/1", "https://seed.example.test/events/2"]);
  });

  it("never fetches more pages per source than the page budget", async () => {
    const internal = Array.from({ length: 60 }, (_, i) => `/events/${i}`);
    const external = Array.from({ length: 40 }, (_, i) => `https://org${i}.example.com/`);
    const pages: Record<string, Page> = { "https://seed.example.test/": { body: html([...internal, ...external]) } };
    for (const path of internal) pages[`https://seed.example.test${path}`] = { body: html([]) };
    for (let i = 0; i < 40; i += 1) pages[`https://org${i}.example.com/`] = { body: PLAIN };
    const h = harness(pages, { ...INGESTION_DEFAULTS, maxDiscoveryPagesPerSource: 25 });
    h.addSource("Seed", "https://seed.example.test/");
    const summary = await h.run();
    expect(h.calls.length).toBeLessThanOrEqual(25);
    expect(summary.seeds[0].pagesFetched).toBeLessThanOrEqual(25);
    // Traversal cannot starve evaluation: some candidates are still evaluated.
    expect(summary.unsupported).toBeGreaterThan(0);
  });

  it("uses the sitemap to find event pages on the same site only", async () => {
    const sitemap = `<?xml version="1.0"?><urlset><url><loc>https://seed.example.test/events/spring</loc></url><url><loc>https://evil.example.net/events/x</loc></url><url><loc>https://seed.example.test/about</loc></url></urlset>`;
    const pages: Record<string, Page> = {
      "https://seed.example.test/": { body: html([]) },
      "https://seed.example.test/sitemap.xml": { body: sitemap, contentType: "application/xml" },
      "https://seed.example.test/events/spring": { body: html(["https://partner.example.org/"]) },
      "https://partner.example.org/": { body: JSONLD },
    };
    const h = harness(pages);
    h.addSource("Seed", "https://seed.example.test/");
    const summary = await h.run();
    expect(h.calls).toContain("https://seed.example.test/events/spring");
    expect(h.calls).not.toContain("https://evil.example.net/events/x");
    expect(h.calls).not.toContain("https://seed.example.test/about");
    expect(summary.compatible).toBe(1);
  });

  it("uses a calendar feed advertised in the page head", async () => {
    const pages: Record<string, Page> = {
      "https://seed.example.test/": { body: `<html><head><link rel="alternate" type="text/calendar" href="https://cal.example.org/feed.ics"></head><body></body></html>` },
      "https://cal.example.org/feed.ics": { body: ICS, contentType: "text/calendar" },
    };
    const h = harness(pages);
    h.addSource("Seed", "https://seed.example.test/");
    expect((await h.run()).compatible).toBe(1);
  });

  it("seeds only from enabled sources and includes discovery-only ones", async () => {
    const pages: Record<string, Page> = { "https://discovery.example.test/": { body: html([]) }, "https://seed.example.test/": { body: html([]) } };
    const h = harness(pages);
    h.addSource("Off", "https://off.example.test/", { enabled: false });
    h.addSource("Disabled", "https://dead.example.test/", { trust_state: "disabled" });
    h.addSource("Discovery", "https://discovery.example.test/", { discovery_only: true });
    h.addSource("Seed", "https://seed.example.test/");
    const summary = await h.run();
    expect(summary.seeds.map((s) => s.name).sort()).toEqual(["Discovery", "Seed"]);
  });
});

describe("runDiscovery: run lifecycle", () => {
  it("fails a seed whose page cannot be fetched without stopping the others", async () => {
    const pages: Record<string, Page> = {
      "https://down.example.test/": { error: "Unexpected HTTP status 503" },
      "https://seed.example.test/": { body: html(["https://partner.example.org/"]) },
      "https://partner.example.org/": { body: JSONLD },
    };
    const h = harness(pages);
    h.addSource("A-Down", "https://down.example.test/");
    h.addSource("B-Seed", "https://seed.example.test/");
    const summary = await h.run();
    expect(summary).toMatchObject({ status: "partial", seedsAttempted: 2, seedsSucceeded: 1, compatible: 1 });
    expect(h.runs()[0]).toMatchObject({ run_type: "discovery", status: "partial", sources_attempted: 2, sources_succeeded: 1 });
  });

  it("does not run twice at once and closes abandoned runs", async () => {
    const pages: Record<string, Page> = { "https://seed.example.test/": { body: html([]) } };
    const h = harness(pages);
    h.addSource("Seed", "https://seed.example.test/");
    h.db.seed("ingestion.runs", [{ run_type: "discovery", status: "running", started_at: new Date(NOW.getTime() - 60_000).toISOString() }]);
    expect((await h.run()).status).toBe("skipped_overlap");
    expect(h.calls).toHaveLength(0);

    h.runs()[0].started_at = new Date(NOW.getTime() - 5 * 3600_000).toISOString();
    expect((await h.run()).status).toBe("succeeded");
    expect(h.runs()[0]).toMatchObject({ status: "failed" });
  });

  it("finalizes the run when a fatal error occurs", async () => {
    const h = harness({});
    h.addSource("Seed", "https://seed.example.test/");
    h.db.failNext.push({ key: "ingestion.source_discoveries", op: "select", error: { code: "XX000", message: "db down" } });
    await expect(h.run()).rejects.toThrow(/Failed to list discoveries/);
    expect(h.runs()[0]).toMatchObject({ status: "failed", error_summary: expect.stringContaining("Fatal") });
  });

  it("does not run discovery against a daily collection lock", async () => {
    const h = harness({ "https://seed.example.test/": { body: html([]) } });
    h.addSource("Seed", "https://seed.example.test/");
    h.db.seed("ingestion.runs", [{ run_type: "collection", status: "running", started_at: NOW.toISOString() }]);
    expect((await h.run()).status).toBe("succeeded");
  });
});

describe("discovery helpers", () => {
  it("canonicalizes domains and flags restricted platforms", () => {
    expect(canonicalDomain("https://WWW.Example.org./path")).toBe("example.org");
    expect(restrictedReason("https://m.facebook.com/x")).toMatch(/login/);
    expect(restrictedReason("https://notfacebook.com/x")).toBeNull();
    expect(restrictedReason("https://www.eventbrite.com/e/1")).toMatch(/scraping/);
    expect(isIgnoredDomain("https://www.youtube.com/watch")).toBe(true);
    expect(isIgnoredDomain("https://market.example.org")).toBe(false);
  });

  it("flags unsafe candidate URLs", () => {
    for (const url of ["http://localhost/x", "http://127.0.0.1/", "http://169.254.169.254/latest", "https://user:pw@example.org/", "ftp://example.org/", "https://intranet/", "https://printer.local/"]) {
      expect(isSafeCandidateUrl(url)).toBe(false);
    }
    expect(isSafeCandidateUrl("https://example.org/events")).toBe(true);
  });

  it("extracts, normalizes and splits links", () => {
    const links = extractLinks(
      `<html><head><link rel="alternate" type="text/calendar" href="/feed.ics"></head><body>
        <a href="/calendar?utm_source=x#top">Calendar</a><a href="/about">About</a><a href="/contact">Upcoming markets</a>
        <a href="https://other.example.org/page/">Partner</a><a href="webcal://cal.example.org/a.ics">Sub</a>
        <a href="javascript:void(0)">x</a><a href="mailto:a@b.co">m</a><a href="/photo.jpg">img</a></body></html>`,
      "https://seed.example.test/home",
    );
    expect(links.internal.sort()).toEqual(["https://seed.example.test/calendar", "https://seed.example.test/contact"]);
    expect(links.external).toEqual(["https://other.example.org/page"]);
    expect(links.calendarFeeds.sort()).toEqual(["https://cal.example.org/a.ics", "https://seed.example.test/feed.ics"]);
  });

  it("parses sitemaps and filters to event-like paths", () => {
    const parsed = parseSitemap(`<sitemapindex><sitemap><loc>https://a.example.org/s1.xml</loc></sitemap></sitemapindex>`);
    expect(parsed).toEqual({ urls: ["https://a.example.org/s1.xml"], isIndex: true });
    expect(eventLikeUrls(["https://a.example.org/markets/spring", "https://a.example.org/about"])).toEqual(["https://a.example.org/markets/spring"]);
  });

  it("detects only machine-readable formats", () => {
    expect(detectAdapter({ url: "https://a.example.org/", contentType: "text/html", body: JSONLD })).toMatchObject({ adapter: "jsonld", eventCount: 1 });
    expect(detectAdapter({ url: "https://a.example.org/c.ics", contentType: "text/calendar", body: ICS })).toMatchObject({ adapter: "ics", eventCount: 1 });
    expect(detectAdapter({ url: "https://a.example.org/", contentType: "text/html", body: PLAIN })).toMatchObject({ adapter: null, eventCount: 0 });
    expect(detectAdapter({ url: "https://a.example.org/", contentType: "text/calendar", body: "BEGIN:VCALENDAR\r\nEND:VCALENDAR" })).toMatchObject({ adapter: null });
    expect(detectAdapter({ url: "https://a.example.org/", contentType: "application/pdf", body: "" })).toMatchObject({ adapter: null });
  });
});
