/**
 * @jest-environment node
 */
import fs from "node:fs";
import path from "node:path";
import type { AdapterDeps } from "@/lib/ingestion/adapters/common";
import { createAdapterRegistry } from "@/lib/ingestion/adapters/registry";
import { parseEstherElsa } from "@/lib/ingestion/adapters/sources/esther-elsa";
import type { CollectionContext, SourceDefinition } from "@/lib/ingestion/adapters/types";
import { SafeFetchError, type SafeFetchResult } from "@/lib/ingestion/security/safe-fetch";

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const CONTEXT: CollectionContext = { runId: "run-1", now: new Date("2026-01-01T00:00:00Z"), horizonDays: 90, signal: new AbortController().signal };

function source(adapterKey: string, baseUrl: string): SourceDefinition {
  return { id: "src", name: adapterKey, baseUrl, adapter: "html", crawlDelayMs: 0, configuration: { adapterKey } };
}

function page(url: string, body: string): SafeFetchResult {
  return { finalUrl: url, status: 200, contentType: "text/html", body, etag: null, lastModified: null };
}

function routing(routes: Record<string, string | Error>): AdapterDeps & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    async fetchPage(url) {
      urls.push(url);
      const route = routes[url];
      if (route === undefined) throw new SafeFetchError("HTTP_ERROR", "Request failed with HTTP 404", 404);
      if (route instanceof Error) throw route;
      return page(url, route);
    },
  };
}

describe("Urban District Market adapter", () => {
  const url = "https://www.example.test/calendar";
  const collect = (body: string) => createAdapterRegistry(routing({ [url]: body })).resolve(source("urban-district-market", url)).collect(source("urban-district-market", url), CONTEXT);

  it("parses Squarespace event list items with exact local times, venue and map-link address", async () => {
    const result = await collect(fixture("urban-district.html"));
    expect(result.success).toBe(true);
    expect(result.error).toBe("1 of 4 listings skipped (missing title, link or date)");
    expect(result.events).toHaveLength(3);
    const [grinch, game, cancelled] = result.events;
    expect(grinch).toMatchObject({
      externalEventId: "calendar/grinch-fest-2031",
      title: "Grinch Fest",
      sourceUrl: "https://www.example.test/calendar/grinch-fest-2031",
      startsAt: "2031-12-13T12:00:00",
      endsAt: "2031-12-13T17:00:00",
      venueName: "Example District Market",
      address: "100 Example Street Charlotte, NC, 28205 United States",
      organizerName: "Example Makers Collective",
      vendorCount: 40,
      cancelled: false,
    });
    expect(game.organizerName).toBe("Example Together");
    expect(game.address).toBe("200 Example Avenue Charlotte, NC, 28205 United States");
    expect(cancelled).toMatchObject({ cancelled: true, startsAt: "2032-04-10", endsAt: null, organizerName: "Urban District Market" });
  });

  it("treats each dated listing as a distinct occurrence and uses the current venue, not an earlier one", async () => {
    const moved = fixture("urban-district.html").replace("100%20Example%20Street", "999%20Moved%20Street");
    const result = await collect(moved);
    expect(result.events[0].address).toContain("999 Moved Street");
    const ids = new Set(result.events.map((e) => e.externalEventId));
    expect(ids.size).toBe(result.events.length);
  });

  it("fails on structural mismatch instead of returning zero events", async () => {
    for (const body of ["<html><body><div class='new-design'>Calendar</div></body></html>", `<article class="eventlist-event"><p>no title</p></article>`]) {
      const result = await collect(body);
      expect(result).toMatchObject({ success: false, events: [] });
      expect(result.error).toMatch(/Urban District Market/);
    }
  });
});

describe("Maker's Market CLT adapter", () => {
  const listUrl = "https://www.example.test/markets";
  const first = "https://www.example.test/event-details/example-market-example-brewery-2031-11-21-12-00";
  const second = "https://www.example.test/event-details/first-sip-saturdays-example-brewery-2031-12-05-14-00";
  const third = "https://www.example.test/event-details/example-market-river-district";
  const run = (deps: AdapterDeps, configuration: Record<string, unknown> = {}) => {
    const src = { ...source("makers-market-clt", listUrl), configuration: { adapterKey: "makers-market-clt", ...configuration } };
    return createAdapterRegistry(deps).resolve(src).collect(src, CONTEXT);
  };

  it("uses detail-page JSON-LD for facts and falls back to list-only data without guessing times", async () => {
    const deps = routing({ [listUrl]: fixture("makers-market.html"), [first]: fixture("makers-market-detail.html"), [second]: new SafeFetchError("HTTP_ERROR", "Request failed with HTTP 500", 500), [third]: "<html><body>no structured data</body></html>" });
    const result = await run(deps);
    expect(result.success).toBe(true);
    expect(deps.urls).toEqual([listUrl, first, second, third]);
    const [jsonLd, listOnlyMatching, listOnlyNoSlugDate] = result.events;
    expect(jsonLd).toMatchObject({
      externalEventId: "example-market-example-brewery-2031-11-21-12-00",
      sourceUrl: first,
      startsAt: "2031-11-21T12:00:00-05:00",
      endsAt: "2031-11-21T17:00:00-05:00",
      venueName: "Example Brewery",
      vendorCount: 35,
    });
    expect(jsonLd.rawPayload).toMatchObject({ multipleDates: true });
    expect(listOnlyMatching).toMatchObject({ title: "First Sip Saturdays", startsAt: "2031-12-05", endsAt: null, address: null });
    expect(listOnlyMatching.rawPayload).toMatchObject({ detailMissing: true });
    expect(listOnlyNoSlugDate).toMatchObject({ title: "Example Market at The River District", startsAt: null });
    expect(result.error).toMatch(/Request failed with HTTP 500/);
  });

  it("does not take a year from a slug whose date disagrees with the listing label", async () => {
    const mismatched = fixture("makers-market.html").replace("2031-12-05-14-00", "2031-12-06-14-00");
    const result = await run(routing({ [listUrl]: mismatched, [first]: fixture("makers-market-detail.html") }));
    expect(result.events.find((e) => e.title === "First Sip Saturdays")?.startsAt).toBeNull();
  });

  it("limits detail fetches and still reports the remaining listings", async () => {
    const deps = routing({ [listUrl]: fixture("makers-market.html"), [first]: fixture("makers-market-detail.html") });
    const result = await run(deps, { maxDetailPages: 1 });
    expect(deps.urls).toEqual([listUrl, first]);
    expect(result.events).toHaveLength(3);
    expect(result.error).toMatch(/detail page limit \(1\) reached/);
  });

  it("fails when the list structure disappears or no listing yields a date", async () => {
    const none = await run(routing({ [listUrl]: "<html><body>Redesigned</body></html>" }));
    expect(none).toMatchObject({ success: false, events: [] });
    const undated = await run(routing({ [listUrl]: fixture("makers-market.html").replace(/2031-1\d-\d\d-\d\d-\d\d/g, "x") }));
    expect(undated.success).toBe(false);
    expect(undated.error).toMatch(/no listing yielded a start date/);
  });
});

describe("Esther & Elsa adapter", () => {
  const url = "https://www.example.test/frontporch";
  const src = source("esther-elsa", url);
  const collect = (body: string) => createAdapterRegistry(routing({ [url]: body })).resolve(src).collect(src, CONTEXT);

  it("emits one occurrence per listed first Saturday with explicit hours, address and vendor evidence", async () => {
    const result = await collect(fixture("esther-elsa.html"));
    expect(result.success).toBe(true);
    expect(result.events.map((e) => [e.externalEventId, e.startsAt, e.endsAt, e.cancelled])).toEqual([
      ["front-porch-2026-04-04", "2026-04-04T11:00:00", "2026-04-04T16:00:00", false],
      ["front-porch-2026-05-02", "2026-05-02T11:00:00", "2026-05-02T16:00:00", false],
      ["front-porch-2026-11-07", "2026-11-07T11:00:00", "2026-11-07T16:00:00", true],
      ["front-porch-2026-12-05", "2026-12-05T11:00:00", "2026-12-05T16:00:00", false],
    ]);
    expect(result.events[0]).toMatchObject({ venueName: "Front Porch", address: "2135 Example Road, Charlotte, NC 28208", organizerName: "Esther & Elsa", vendorCount: 120 });
    expect(result.events[0].evidence[0]).toContain("120+ small businesses");
  });

  it("uses the venue currently on the page after a move", async () => {
    const moved = fixture("esther-elsa.html").replace("Front Porch 2135 Example Road Charlotte, NC, 28208", "Front Porch 77 New Venue Street Charlotte, NC, 28209");
    expect((await collect(moved)).events[0].address).toBe("77 New Venue Street, Charlotte, NC 28209");
  });

  it.each([
    ["missing year statement", (h: string) => h.replace("2026 monthly pop-up market", "monthly pop-up market")],
    ["missing schedule rule", (h: string) => h.replace("first Saturday of each month", "some Saturdays")],
    ["missing hours", (h: string) => h.replace(/from 11:00 am to 4:00 pm/g, "all day")],
    ["missing date list", (h: string) => h.replace("Mark your calendar.", "Dates soon.")],
    ["no dates in the list", (h: string) => h.replace(/•[A-Za-z]+ \d+[^<]*/g, "")],
    ["dates that contradict the rule", (h: string) => h.replace("•April 4", "•April 11")],
    ["missing address", (h: string) => h.replace("Front Porch 2135 Example Road Charlotte, NC, 28208, United States", "Address coming soon")],
  ])("fails on %s", async (_name, mutate) => {
    const result = await collect(mutate(fixture("esther-elsa.html")));
    expect(result).toMatchObject({ success: false, events: [] });
    expect(result.error).toMatch(/Esther & Elsa/);
  });

  it("is deterministic and does not mutate inputs", () => {
    const html = fixture("esther-elsa.html");
    expect(parseEstherElsa(html, src, url)).toEqual(parseEstherElsa(html, src, url));
  });
});

describe("registry wiring", () => {
  it("resolves the three seeded adapter keys", () => {
    const registry = createAdapterRegistry(routing({}));
    for (const key of ["makers-market-clt", "urban-district-market", "esther-elsa"]) {
      expect(registry.resolve(source(key, "https://www.example.test/")).type).toBe("html");
    }
  });
});
