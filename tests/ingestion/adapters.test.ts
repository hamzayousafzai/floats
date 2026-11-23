/**
 * @jest-environment node
 */
import fs from "node:fs";
import path from "node:path";
import { type AdapterDeps, parseHumanDateRange } from "@/lib/ingestion/adapters/common";
import { createHtmlAdapter } from "@/lib/ingestion/adapters/html";
import { createIcsAdapter, parseIcsDocument } from "@/lib/ingestion/adapters/ics";
import { createJsonLdAdapter } from "@/lib/ingestion/adapters/jsonld";
import { type BrowserContext, type BrowserHandle, type BrowserPage, type BrowserRoute, createPlaywrightAdapter } from "@/lib/ingestion/adapters/playwright";
import { UnknownAdapterError, createAdapterRegistry } from "@/lib/ingestion/adapters/registry";
import type { CollectionContext, SourceDefinition } from "@/lib/ingestion/adapters/types";
import { SafeFetchError, type SafeFetchResult } from "@/lib/ingestion/security/safe-fetch";

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");

const CONTEXT: CollectionContext = { runId: "run-1", now: new Date("2031-01-01T00:00:00Z"), horizonDays: 90, signal: new AbortController().signal };

function source(adapter: SourceDefinition["adapter"], configuration: Record<string, unknown> = {}): SourceDefinition {
  return { id: "src-1", name: "Synthetic", baseUrl: "https://www.example.test/events", adapter, crawlDelayMs: 0, configuration };
}

function deps(body: string, contentType = "text/html"): AdapterDeps & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    async fetchPage(url): Promise<SafeFetchResult> {
      urls.push(url);
      return { finalUrl: url, status: 200, contentType, body, etag: null, lastModified: null };
    },
  };
}

const HTML_CONFIG = {
  html: {
    selectors: {
      card: "li.event-card",
      title: "h3.title",
      link: { selector: "h3.title a", attr: "href" },
      start: { selector: "time", attr: "datetime" },
      date: ".when",
      description: ".blurb",
      venue: ".where",
      address: ".addr",
      vendors: ".vendor-list li",
    },
    defaultOrganizer: "Example Organizer",
  },
};

describe("parseHumanDateRange", () => {
  it.each([
    ["Saturday, July 12, 2031 5:00 PM - 10:00 PM", "2031-07-12T17:00:00", "2031-07-12T22:00:00"],
    ["Dec. 5th, 2031 10am to 4pm", "2031-12-05T10:00:00", "2031-12-05T16:00:00"],
    ["December 5, 2031 10-4pm", "2031-12-05T10:00:00", "2031-12-05T16:00:00"],
    ["12/05/2031 9:30 am", "2031-12-05T09:30:00", null],
    ["September 3, 2031", "2031-09-03", null],
    ["Sept 3, 2031 12pm - 3pm", "2031-09-03T12:00:00", "2031-09-03T15:00:00"],
    ["March 1, 2032 8pm - 2am", "2032-03-01T20:00:00", null],
  ])("parses %s", (input, start, end) => {
    expect(parseHumanDateRange(input)).toEqual({ start, end });
  });

  it.each(["Saturday, November 8", "TBD", "", "February 30, 2031", "13/45/2031"])("returns null for %j", (input) => {
    expect(parseHumanDateRange(input)).toBeNull();
  });
});

describe("jsonld adapter", () => {
  it("extracts Event nodes from plain, @graph and multi-type blocks and tolerates one invalid block", async () => {
    const d = deps(fixture("jsonld-event.html"));
    const result = await createJsonLdAdapter(d).collect(source("jsonld"), CONTEXT);
    expect(result.success).toBe(true);
    expect(result.error).toMatch(/1 JSON-LD block/);
    expect(result.events).toHaveLength(2);
    const [market, cancelled] = result.events;
    expect(market).toMatchObject({
      externalEventId: "evt-1001",
      title: "Example Winter Makers Market",
      startsAt: "2031-12-06T10:00:00-05:00",
      endsAt: "2031-12-06T16:00:00-05:00",
      organizerName: "Example Makers Collective",
      venueName: "Example Pavilion",
      address: "100 Example St, Charlotte, NC, 28202",
      sourceUrl: "https://www.example.test/events/winter-makers-market",
      vendorCount: 45,
      cancelled: false,
    });
    expect(market.evidence[0]).toContain("45 local vendors");
    expect(market.rawPayload).toMatchObject({ "@id": "evt-1001" });
    expect(cancelled).toMatchObject({ title: "Example Spring Market", cancelled: true, endsAt: null, vendorCount: null, address: "Example Pavilion, 100 Example St, Charlotte, NC" });
  });

  it("does not fabricate an end time", async () => {
    const html = `<script type="application/ld+json">{"@type":"Event","name":"X","startDate":"2031-01-01T10:00:00-05:00"}</script>`;
    const result = await createJsonLdAdapter(deps(html)).collect(source("jsonld"), CONTEXT);
    expect(result.events[0].endsAt).toBeNull();
  });

  it.each([
    ["no JSON-LD at all", "<html><body>nothing</body></html>"],
    ["JSON-LD with no events", `<script type="application/ld+json">{"@type":"Organization","name":"x"}</script>`],
    ["only invalid JSON-LD", `<script type="application/ld+json">{oops</script>`],
  ])("reports a parser error, not a zero-event success, for %s", async (_name, html) => {
    const result = await createJsonLdAdapter(deps(html)).collect(source("jsonld"), CONTEXT);
    expect(result.success).toBe(false);
    expect(result.events).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it("reports fetch failures as failed collections without throwing", async () => {
    const failing: AdapterDeps = {
      fetchPage: async () => {
        throw new SafeFetchError("HTTP_ERROR", "Request failed with HTTP 503", 503);
      },
    };
    const result = await createJsonLdAdapter(failing).collect(source("jsonld"), CONTEXT);
    expect(result).toMatchObject({ success: false, events: [], error: "Request failed with HTTP 503" });
  });
});

describe("ics adapter", () => {
  const events = () => parseIcsDocument(fixture("calendar.ics"), source("ics"), "https://www.example.test/cal.ics");

  it("parses UID, unescaped text, organizer, URL, and America/New_York local times", () => {
    const first = events()[0];
    expect(first).toMatchObject({
      externalEventId: "synthetic-1@example.test",
      title: "Example Holiday Market, Charlotte",
      startsAt: "2031-12-13T10:00:00",
      endsAt: "2031-12-13T16:00:00",
      organizerName: "Example Collective",
      address: "Example Pavilion, 100 Example St, Charlotte, NC 28202",
      sourceUrl: "https://www.example.test/holiday-market",
      vendorCount: 60,
      cancelled: false,
    });
  });

  it("keeps UTC instants, converts other time zones to UTC, and handles folded lines and all-day values", () => {
    const all = events();
    expect(all[1]).toMatchObject({ startsAt: "2032-01-10T15:00:00Z", endsAt: "2032-01-10T20:00:00Z" });
    expect(all[2].title).toBe("Folded line example with a very long title that continues on the next physical line");
    expect(all[2].startsAt).toBe("2032-02-14T15:00:00.000Z");
    expect(all[2].endsAt).toBeNull();
    expect(all[3]).toMatchObject({ startsAt: "2032-03-20", endsAt: null });
    expect(all[3].rawPayload.allDay).toBe(true);
  });

  it("marks cancelled events", () => {
    expect(events()[4].cancelled).toBe(true);
  });

  it("expands only explicit RDATE instances, honours EXDATE, and records but does not expand RRULE", () => {
    const series = events().filter((e) => e.externalEventId?.startsWith("synthetic-6"));
    expect(series.map((e) => [e.externalEventId, e.startsAt, e.endsAt])).toEqual([
      ["synthetic-6@example.test", "2032-05-01T09:00:00", "2032-05-01T13:00:00"],
      ["synthetic-6@example.test#20320508T090000", "2032-05-08T09:00:00", "2032-05-08T13:00:00"],
    ]);
    expect(series[0].rawPayload.rrule).toBe("FREQ=WEEKLY;COUNT=10");
  });

  it("fails on documents that are not calendars or have no events", async () => {
    for (const body of ["<html>Not a calendar</html>", "BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR"]) {
      const result = await createIcsAdapter(deps(body, "text/calendar")).collect(source("ics"), CONTEXT);
      expect(result.success).toBe(false);
      expect(result.events).toEqual([]);
    }
  });

  it("uses configuration.icsUrl when present", async () => {
    const d = deps(fixture("calendar.ics"), "text/calendar");
    await createIcsAdapter(d).collect(source("ics", { icsUrl: "https://www.example.test/feed.ics" }), CONTEXT);
    expect(d.urls).toEqual(["https://www.example.test/feed.ics"]);
  });
});

describe("html adapter", () => {
  it("extracts cards, parses explicit dates, vendor lists and cancellations, and skips untitled cards visibly", async () => {
    const result = await createHtmlAdapter(deps(fixture("market-listing.html"))).collect(source("html", HTML_CONFIG), CONTEXT);
    expect(result.success).toBe(true);
    expect(result.error).toBe("1 of 4 cards skipped (no title)");
    expect(result.events).toHaveLength(3);
    const [summer, fall, undated] = result.events;
    expect(summer).toMatchObject({
      title: "Example Summer Night Market",
      startsAt: "2031-07-12T17:00:00",
      endsAt: "2031-07-12T22:00:00",
      venueName: "Example Plaza",
      address: "12 Example Plaza, Charlotte, NC 28203",
      organizerName: "Example Organizer",
      sourceUrl: "https://www.example.test/events/summer-market",
      vendorCount: 80,
      cancelled: false,
    });
    expect(fall).toMatchObject({ startsAt: "2031-10-18T10:00:00", endsAt: null, vendorCount: 3, cancelled: true });
    expect(fall.evidence[0]).toContain("Ceramics Co");
    expect(undated.startsAt).toBeNull();
    expect(undated.rawPayload.dateText).toBe("Saturday, November 8");
    expect(summer.rawPayload.cardHtml).toContain("Example Summer Night Market");
  });

  it("reports a structure mismatch when selectors match nothing or every card lacks a title", async () => {
    const none = await createHtmlAdapter(deps("<html><body><p>redesigned</p></body></html>")).collect(source("html", HTML_CONFIG), CONTEXT);
    expect(none).toMatchObject({ success: false, events: [] });
    expect(none.error).toMatch(/matched no event cards/);
    const untitled = await createHtmlAdapter(deps(`<li class="event-card"><p>x</p></li>`)).collect(source("html", HTML_CONFIG), CONTEXT);
    expect(untitled.success).toBe(false);
  });

  it("fails clearly without selector configuration", async () => {
    const result = await createHtmlAdapter(deps("<html></html>")).collect(source("html"), CONTEXT);
    expect(result).toMatchObject({ success: false });
    expect(result.error).toMatch(/html\.selectors/);
  });

  it("follows a bounded number of detail pages and tolerates detail failures", async () => {
    const calls: string[] = [];
    const d: AdapterDeps = {
      async fetchPage(url) {
        calls.push(url);
        if (url.endsWith("/events")) return { finalUrl: url, status: 200, contentType: "text/html", body: fixture("market-listing.html"), etag: null, lastModified: null };
        if (url.endsWith("fall-market")) throw new SafeFetchError("HTTP_ERROR", "Request failed with HTTP 500", 500);
        return { finalUrl: url, status: 200, contentType: "text/html", body: `<body><div class="full">Full details: 90 local vendors.</div><address>9 Detail Rd, Charlotte, NC</address></body>`, etag: null, lastModified: null };
      },
    };
    const config = { html: { ...HTML_CONFIG.html, detail: { enabled: true, maxPages: 2, selectors: { description: ".full", address: "address" } } } };
    const result = await createHtmlAdapter(d).collect(source("html", config), CONTEXT);
    expect(calls).toHaveLength(3);
    const summer = result.events[0];
    expect(summer.description).toBe("Full details: 90 local vendors.");
    expect(summer.address).toBe("9 Detail Rd, Charlotte, NC");
    expect(summer.sourceUrl).toBe("https://www.example.test/events/summer-market");
    expect(result.error).toMatch(/detail page failed/);
    expect(result.error).toMatch(/detail page limit \(2\) reached/);
  });
});

describe("playwright adapter", () => {
  interface Log { events: string[]; routed: boolean[] }

  function fakeBrowser(html: string, log: Log, behavior: { gotoHangs?: boolean; launchFails?: boolean } = {}) {
    const page: BrowserPage = {
      goto: () => (behavior.gotoHangs ? new Promise(() => undefined) : Promise.resolve()),
      waitForSelector: async () => undefined,
      content: async () => html,
      url: () => "https://www.example.test/events",
      close: async () => void log.events.push("page.close"),
    };
    let handler: ((route: BrowserRoute) => Promise<void>) | null = null;
    const context: BrowserContext = {
      route: async (_pattern, h) => void (handler = h),
      newPage: async () => page,
      close: async () => void log.events.push("context.close"),
    };
    const browser: BrowserHandle = {
      newContext: async () => context,
      close: async () => void log.events.push("browser.close"),
    };
    return {
      launch: async () => {
        if (behavior.launchFails) throw new Error("launch failed");
        return browser;
      },
      async request(url: string, resourceType = "document"): Promise<"aborted" | "continued"> {
        let outcome: "aborted" | "continued" = "continued";
        await handler?.({
          request: () => ({ url: () => url, resourceType: () => resourceType }),
          abort: async () => void (outcome = "aborted"),
          continue: async () => void (outcome = "continued"),
        });
        return outcome;
      },
    };
  }

  const options = { userAgent: "UA", navigationTimeoutMs: 100, maxHtmlBytes: 1_000_000 };

  it("renders, parses, and tears the browser down in order", async () => {
    const log: Log = { events: [], routed: [] };
    const fake = fakeBrowser(fixture("market-listing.html"), log);
    const adapter = createPlaywrightAdapter({ ...options, launch: fake.launch, resolve: async () => ["93.184.216.34"] });
    const result = await adapter.collect(source("playwright", HTML_CONFIG), CONTEXT);
    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(3);
    expect(log.events).toEqual(["page.close", "context.close", "browser.close"]);
  });

  it("blocks browser requests to private addresses and heavy resources", async () => {
    const log: Log = { events: [], routed: [] };
    const fake = fakeBrowser(fixture("market-listing.html"), log);
    const adapter = createPlaywrightAdapter({
      ...options,
      launch: fake.launch,
      resolve: async (host) => (host === "rebind.example.test" ? ["10.0.0.9"] : ["93.184.216.34"]),
    });
    await adapter.collect(source("playwright", HTML_CONFIG), CONTEXT);
    expect(await fake.request("https://www.example.test/app.js", "script")).toBe("continued");
    expect(await fake.request("http://127.0.0.1:3000/", "xhr")).toBe("aborted");
    expect(await fake.request("http://169.254.169.254/latest", "fetch")).toBe("aborted");
    expect(await fake.request("https://rebind.example.test/x", "script")).toBe("aborted");
    expect(await fake.request("https://www.example.test/photo.png", "image")).toBe("aborted");
    expect(await fake.request("http://[::ffff:10.0.0.5]/", "fetch")).toBe("aborted");
    expect(await fake.request("http://2130706433/", "fetch")).toBe("aborted");
    expect(await fake.request("http://metadata.google.internal/computeMetadata/v1/", "xhr")).toBe("aborted");
    expect(await fake.request("https://user:pw@www.example.test/", "document")).toBe("aborted");
    expect(await fake.request("file:///etc/passwd", "document")).toBe("aborted");
  });

  it("times out a hanging navigation and still closes everything", async () => {
    const log: Log = { events: [], routed: [] };
    const fake = fakeBrowser("", log, { gotoHangs: true });
    const adapter = createPlaywrightAdapter({ ...options, navigationTimeoutMs: 30, launch: fake.launch, resolve: async () => ["93.184.216.34"] });
    const result = await adapter.collect(source("playwright", HTML_CONFIG), CONTEXT);
    expect(result).toMatchObject({ success: false, events: [] });
    expect(result.error).toMatch(/timed out/);
    expect(log.events).toEqual(["page.close", "context.close", "browser.close"]);
  });

  it("handles launch failures, robots denial, unsafe sources, aborted runs and oversize pages", async () => {
    const failed = createPlaywrightAdapter({ ...options, launch: fakeBrowser("", { events: [], routed: [] }, { launchFails: true }).launch });
    expect((await failed.collect(source("playwright", HTML_CONFIG), CONTEXT)).error).toBe("launch failed");

    const launch = jest.fn();
    const denied = createPlaywrightAdapter({ ...options, launch, isAllowed: async () => false });
    expect((await denied.collect(source("playwright", HTML_CONFIG), CONTEXT)).error).toBe("Blocked by robots.txt");
    const unsafe = await denied.collect({ ...source("playwright", HTML_CONFIG), baseUrl: "http://127.0.0.1/" }, CONTEXT);
    expect(unsafe.success).toBe(false);
    const controller = new AbortController();
    controller.abort();
    const abortedRun = createPlaywrightAdapter({ ...options, launch });
    expect((await abortedRun.collect(source("playwright", HTML_CONFIG), { ...CONTEXT, signal: controller.signal })).error).toBe("Run aborted");
    expect(launch).not.toHaveBeenCalled();

    const log: Log = { events: [], routed: [] };
    const big = createPlaywrightAdapter({ ...options, maxHtmlBytes: 10, launch: fakeBrowser(fixture("market-listing.html"), log).launch, resolve: async () => ["93.184.216.34"] });
    expect((await big.collect(source("playwright", HTML_CONFIG), CONTEXT)).error).toMatch(/size limit/);
    expect(log.events).toContain("browser.close");
  });
});

describe("adapter registry", () => {
  const registry = createAdapterRegistry(deps(""));

  it("resolves generic adapters by type and fails closed for playwright when not enabled", () => {
    expect(registry.resolve(source("jsonld")).type).toBe("jsonld");
    expect(registry.resolve(source("ics")).type).toBe("ics");
    expect(registry.resolve(source("html")).type).toBe("html");
    expect(() => registry.resolve(source("playwright"))).toThrow(UnknownAdapterError);
  });

  it("prefers a registered source-specific adapter and rejects unknown keys", () => {
    const custom = { type: "html" as const, collect: jest.fn() };
    registry.register("custom", custom);
    expect(registry.resolve(source("html", { adapterKey: "custom" }))).toBe(custom);
    expect(() => registry.resolve(source("html", { adapterKey: "missing" }))).toThrow(UnknownAdapterError);
  });
});
