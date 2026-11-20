import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import type { CollectionResult, RawEvent } from "@/lib/ingestion/types";
import {
  type AdapterDeps,
  ParserStructureError,
  cleanText,
  collectionFailure,
  collectionSuccess,
  emptyRawEvent,
  extractVendorEvidence,
  parseHumanDateRange,
  resolveUrl,
} from "./common";
import type { CollectionContext, EventAdapter, SourceDefinition } from "./types";

export type SelectorSpec = string | { selector: string; attr?: string };

export interface HtmlSelectors {
  card: string;
  title: SelectorSpec;
  link?: SelectorSpec;
  /** Machine readable start (for example `{ selector: "time", attr: "datetime" }`). */
  start?: SelectorSpec;
  end?: SelectorSpec;
  /** Human readable date text, parsed deterministically and only when it states a four digit year. */
  date?: SelectorSpec;
  description?: SelectorSpec;
  venue?: SelectorSpec;
  address?: SelectorSpec;
  organizer?: SelectorSpec;
  /** One element per vendor; the count of matches becomes the vendor evidence. */
  vendors?: SelectorSpec;
  externalId?: SelectorSpec;
}

export interface HtmlAdapterConfig {
  selectors: HtmlSelectors;
  detail?: { enabled: boolean; selectors: Partial<Omit<HtmlSelectors, "card">>; maxPages?: number };
  defaultOrganizer?: string;
  defaultVenue?: string;
  defaultAddress?: string;
}

export function readHtmlConfig(configuration: Record<string, unknown>): HtmlAdapterConfig {
  const config = configuration.html;
  if (typeof config !== "object" || config === null || typeof (config as { selectors?: unknown }).selectors !== "object") {
    throw new ParserStructureError("Source configuration is missing html.selectors");
  }
  const selectors = (config as HtmlAdapterConfig).selectors;
  if (!selectors || typeof selectors.card !== "string" || !selectors.title) {
    throw new ParserStructureError("html.selectors requires card and title");
  }
  return config as HtmlAdapterConfig;
}

function pick($: CheerioAPI, scope: Cheerio<AnyNode>, spec: SelectorSpec | undefined): string | null {
  if (!spec) return null;
  const { selector, attr } = typeof spec === "string" ? { selector: spec, attr: undefined } : spec;
  const target = selector === ":self" ? scope : scope.find(selector).first();
  if (target.length === 0) return null;
  return cleanText(attr ? target.attr(attr) : target.text());
}

type Fields = Partial<Omit<HtmlSelectors, "card">>;

function readFields($: CheerioAPI, scope: Cheerio<AnyNode>, fields: Fields, event: RawEvent, pageUrl: string): void {
  const title = pick($, scope, fields.title);
  if (title) event.title = title;
  const link = resolveUrl(pick($, scope, fields.link), pageUrl);
  if (link) event.sourceUrl = link;
  const description = pick($, scope, fields.description);
  if (description) event.description = description;
  const venue = pick($, scope, fields.venue);
  if (venue) event.venueName = venue;
  const address = pick($, scope, fields.address);
  if (address) event.address = address;
  const organizer = pick($, scope, fields.organizer);
  if (organizer) event.organizerName = organizer;
  const externalId = pick($, scope, fields.externalId);
  if (externalId) event.externalEventId = externalId;

  const start = pick($, scope, fields.start);
  const end = pick($, scope, fields.end);
  const dateText = pick($, scope, fields.date);
  if (start) event.startsAt = start;
  if (end) event.endsAt = end;
  if (dateText) {
    event.rawPayload.dateText = dateText;
    if (!start) {
      const parsed = parseHumanDateRange(dateText);
      if (parsed) {
        event.startsAt = parsed.start;
        if (!end && parsed.end) event.endsAt = parsed.end;
      }
    }
  }
  if (fields.vendors) {
    const spec = typeof fields.vendors === "string" ? { selector: fields.vendors } : fields.vendors;
    const names = scope
      .find(spec.selector)
      .toArray()
      .map((node) => cleanText($(node).text()))
      .filter((name): name is string => name !== null);
    if (names.length > 0) {
      event.vendorCount = names.length;
      event.evidence = [`Vendor list on source page: ${names.slice(0, 10).join(", ")}${names.length > 10 ? ", ..." : ""}`];
    }
  }
}

function finishEvent(event: RawEvent): void {
  if (event.vendorCount === null) {
    const stated = extractVendorEvidence(event.description);
    event.vendorCount = stated.count;
    if (event.evidence.length === 0) event.evidence = stated.evidence;
  }
  event.cancelled = /\bcancell?ed\b/i.test(`${event.title ?? ""} ${event.description ?? ""}`);
}

export interface HtmlParseResult {
  events: RawEvent[];
  skipped: number;
  cards: number;
  detailUrls: string[];
}

export function parseHtmlListing(html: string, source: SourceDefinition, pageUrl: string, config: HtmlAdapterConfig): HtmlParseResult {
  const $ = cheerio.load(html);
  const cards = $(config.selectors.card).toArray();
  if (cards.length === 0) throw new ParserStructureError(`Selector "${config.selectors.card}" matched no event cards (page structure may have changed)`);
  const events: RawEvent[] = [];
  const detailUrls: string[] = [];
  let skipped = 0;
  for (const card of cards) {
    const scope = $(card);
    const event = emptyRawEvent(source.id, pageUrl);
    event.organizerName = config.defaultOrganizer ?? null;
    event.venueName = config.defaultVenue ?? null;
    event.address = config.defaultAddress ?? null;
    readFields($, scope, config.selectors, event, pageUrl);
    if (!event.title) {
      skipped += 1;
      continue;
    }
    event.rawPayload.cardHtml = ($.html(card) ?? "").slice(0, 4000);
    finishEvent(event);
    if (event.sourceUrl !== pageUrl) detailUrls.push(event.sourceUrl);
    events.push(event);
  }
  if (events.length === 0) throw new ParserStructureError(`All ${cards.length} cards were missing a title (page structure may have changed)`);
  return { events, skipped, cards: cards.length, detailUrls };
}

export function mergeDetailPage(html: string, event: RawEvent, fields: Fields): void {
  const $ = cheerio.load(html);
  const scope = $("body");
  const before = { ...event };
  readFields($, scope, fields, event, event.sourceUrl);
  event.sourceUrl = before.sourceUrl; // the detail URL is already the source URL
  finishEvent(event);
  event.rawPayload.detailFetched = true;
}

export function createHtmlAdapter(deps: AdapterDeps, type: "html" | "playwright" = "html"): EventAdapter {
  return {
    type,
    async collect(source: SourceDefinition, context: CollectionContext): Promise<CollectionResult> {
      try {
        const config = readHtmlConfig(source.configuration);
        const page = await deps.fetchPage(source.baseUrl, source, context, "text/html,application/xhtml+xml");
        const parsed = parseHtmlListing(page.body, source, page.finalUrl, config);
        const warnings: string[] = [];
        if (parsed.skipped > 0) warnings.push(`${parsed.skipped} of ${parsed.cards} cards skipped (no title)`);

        if (config.detail?.enabled) {
          const limit = config.detail.maxPages ?? 10;
          let fetched = 0;
          for (const event of parsed.events) {
            if (event.sourceUrl === page.finalUrl) continue;
            if (fetched >= limit) {
              warnings.push(`detail page limit (${limit}) reached`);
              break;
            }
            fetched += 1;
            try {
              const detail = await deps.fetchPage(event.sourceUrl, source, context, "text/html,application/xhtml+xml");
              mergeDetailPage(detail.body, event, config.detail.selectors);
            } catch (error) {
              warnings.push(`detail page failed for ${event.sourceUrl}: ${error instanceof Error ? error.message : "error"}`);
            }
          }
        }
        return collectionSuccess(source.id, parsed.events, [], warnings.length > 0 ? warnings.join("; ").slice(0, 500) : null);
      } catch (error) {
        return collectionFailure(source.id, error);
      }
    },
  };
}
