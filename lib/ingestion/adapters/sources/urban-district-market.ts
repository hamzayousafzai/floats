import * as cheerio from "cheerio";
import type { CollectionResult, RawEvent } from "@/lib/ingestion/types";
import {
  type AdapterDeps,
  ParserStructureError,
  cleanText,
  collectionFailure,
  collectionSuccess,
  emptyRawEvent,
  extractVendorEvidence,
  localDateTime,
  parseClockMinutes,
  resolveUrl,
} from "../common";
import type { CollectionContext, EventAdapter, SourceDefinition } from "../types";

/**
 * Squarespace "event list" structure (class names are Squarespace platform conventions). Each listing is a distinct
 * occurrence with its own URL, so recurring series stay separate events. Venue and address are always read from the
 * current listing (map link query), never carried over from earlier runs, so a moved event is picked up as moved.
 * Per-event `?format=ical` feeds are deliberately not fetched because the site's robots.txt disallows them.
 */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;
const HOST_PATTERNS = [/\bhosted by\s+([^.!\n]+?)(?:\.|!|$)/i, /\b([A-Z][\w&'’. -]{2,60}?)\s+will host\b/];

function addressFromMapLink(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const q = new URL(href, "https://maps.example.invalid/").searchParams.get("q");
    return cleanText(q);
  } catch {
    return null;
  }
}

function organizerFrom(description: string | null, fallback: string): string {
  if (description) {
    for (const pattern of HOST_PATTERNS) {
      const match = pattern.exec(description);
      const name = cleanText(match?.[1]);
      if (name && name.length <= 80) return name;
    }
  }
  return fallback;
}

export function parseUrbanDistrictMarket(html: string, source: SourceDefinition, pageUrl: string): { events: RawEvent[]; skipped: number; cards: number } {
  const $ = cheerio.load(html);
  const cards = $("article.eventlist-event").toArray();
  if (cards.length === 0) throw new ParserStructureError('Urban District Market: no "article.eventlist-event" listings found (page structure may have changed)');
  const events: RawEvent[] = [];
  let skipped = 0;
  for (const card of cards) {
    const scope = $(card);
    const link = scope.find("a.eventlist-title-link").first();
    const title = cleanText(link.text()) ?? cleanText(scope.find(".eventlist-title").first().text());
    const url = resolveUrl(link.attr("href"), pageUrl);
    const date = ISO_DATE.exec(scope.find("time.event-date").first().attr("datetime") ?? "");
    if (!title || !url || !date) {
      skipped += 1;
      continue;
    }
    const day = `${date[1]}-${date[2]}-${date[3]}`;
    const start = parseClockMinutes(scope.find("time.event-time-12hr-start").first().text());
    const end = parseClockMinutes(scope.find("time.event-time-12hr-end").first().text());
    const addressItem = scope.find(".eventlist-meta-address").first();
    const mapLink = addressItem.find("a.eventlist-meta-address-maplink").first();
    const venue = cleanText(addressItem.clone().children().remove().end().text());
    const description = cleanText(scope.find(".eventlist-description").first().text());
    const vendors = extractVendorEvidence(description);

    const event = emptyRawEvent(source.id, url);
    event.externalEventId = new URL(url).pathname.replace(/^\/+|\/+$/g, "");
    event.title = title;
    event.description = description;
    event.startsAt = start === null ? day : localDateTime(day, start);
    event.endsAt = start !== null && end !== null && end > start ? localDateTime(day, end) : null;
    event.venueName = venue;
    event.address = addressFromMapLink(mapLink.attr("href"));
    event.organizerName = organizerFrom(description, "Urban District Market");
    event.vendorCount = vendors.count;
    event.evidence = vendors.evidence;
    event.cancelled = /\bcancell?ed\b/i.test(`${title} ${description ?? ""}`);
    event.rawPayload = { listing: "squarespace-eventlist", date: day, startText: scope.find("time.event-time-12hr-start").first().text(), endText: scope.find("time.event-time-12hr-end").first().text() };
    events.push(event);
  }
  if (events.length === 0) throw new ParserStructureError(`Urban District Market: all ${cards.length} listings lacked a title, link or date (page structure may have changed)`);
  return { events, skipped, cards: cards.length };
}

export function createUrbanDistrictMarketAdapter(deps: AdapterDeps): EventAdapter {
  return {
    type: "html",
    async collect(source: SourceDefinition, context: CollectionContext): Promise<CollectionResult> {
      try {
        const page = await deps.fetchPage(source.baseUrl, source, context, "text/html,application/xhtml+xml");
        const { events, skipped, cards } = parseUrbanDistrictMarket(page.body, source, page.finalUrl);
        return collectionSuccess(source.id, events, [], skipped > 0 ? `${skipped} of ${cards} listings skipped (missing title, link or date)` : null);
      } catch (error) {
        return collectionFailure(source.id, error);
      }
    },
  };
}
