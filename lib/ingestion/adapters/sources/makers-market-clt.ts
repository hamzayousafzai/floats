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
  resolveUrl,
} from "../common";
import { parseJsonLdDocument } from "../jsonld";
import type { CollectionContext, EventAdapter, SourceDefinition } from "../types";

/**
 * Wix Events listing. The list gives each occurrence's detail URL (stable identity) and a title/date label without a
 * year. Facts (start, end, venue, address) come from the detail page's JSON-LD when present. When the detail page is
 * unavailable the event is emitted with only what the listing states; the year is taken from the detail URL slug and
 * only when the slug's month and day match the listing label, and no time is guessed.
 *
 * NOTE: list selectors are a representation of Wix Events markup (`data-hook` attributes) and have not been verified
 * against the live DOM; a mismatch fails the collection rather than returning an empty success.
 */
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const LIST_DATE = /\b(?:mon|tue|wed|thu|fri|sat|sun),?\s+([a-z]{3})\s+(\d{1,2})\b/i;
const SLUG_DATE = /(\d{4})-(\d{2})-(\d{2})(?:-\d{2}-\d{2})?$/;

interface ListEntry {
  url: string;
  slug: string;
  title: string | null;
  dateLabel: string | null;
  multipleDates: boolean;
  location: string | null;
}

export function parseMakersMarketList(html: string, pageUrl: string): ListEntry[] {
  const $ = cheerio.load(html);
  const anchors = $('a[href*="/event-details/"]').toArray();
  if (anchors.length === 0) throw new ParserStructureError('Maker\'s Market CLT: no "/event-details/" links found (page structure may have changed)');
  const seen = new Set<string>();
  const entries: ListEntry[] = [];
  for (const anchor of anchors) {
    const url = resolveUrl($(anchor).attr("href"), pageUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const scope = $(anchor).closest('[data-hook="ev-list-item"], li, article');
    const text = cleanText(scope.text()) ?? "";
    entries.push({
      url,
      slug: new URL(url).pathname.split("/").filter(Boolean).pop() ?? url,
      title: cleanText(scope.find('[data-hook="title"]').first().text()),
      dateLabel: cleanText(scope.find('[data-hook="date"]').first().text()) ?? LIST_DATE.exec(text)?.[0] ?? null,
      multipleDates: /multiple dates/i.test(text),
      location: cleanText(scope.find('[data-hook="location"]').first().text()),
    });
  }
  return entries;
}

function listOnlyEvent(entry: ListEntry, source: SourceDefinition): RawEvent | null {
  if (!entry.title) return null;
  const event = emptyRawEvent(source.id, entry.url);
  event.externalEventId = entry.slug;
  event.title = entry.title;
  event.venueName = entry.location;
  const label = entry.dateLabel ? LIST_DATE.exec(entry.dateLabel) : null;
  const slug = SLUG_DATE.exec(entry.slug);
  if (label && slug && MONTHS.indexOf(label[1].toLowerCase()) === Number(slug[2]) - 1 && Number(label[2]) === Number(slug[3])) {
    event.startsAt = `${slug[1]}-${slug[2]}-${slug[3]}`; // date only: no time is guessed
  }
  event.rawPayload = { listing: "wix-events", dateLabel: entry.dateLabel, multipleDates: entry.multipleDates, detailMissing: true };
  return event;
}

export function createMakersMarketCltAdapter(deps: AdapterDeps): EventAdapter {
  return {
    type: "html",
    async collect(source: SourceDefinition, context: CollectionContext): Promise<CollectionResult> {
      try {
        const page = await deps.fetchPage(source.baseUrl, source, context, "text/html,application/xhtml+xml");
        const entries = parseMakersMarketList(page.body, page.finalUrl);
        const limit = typeof source.configuration.maxDetailPages === "number" ? source.configuration.maxDetailPages : 15;
        const events: RawEvent[] = [];
        const warnings: string[] = [];
        let fetched = 0;
        for (const entry of entries) {
          if (fetched >= limit) {
            warnings.push(`detail page limit (${limit}) reached; ${entries.length - fetched} listings not fetched`);
            const rest = entries.slice(fetched).map((e) => listOnlyEvent(e, source)).filter((e): e is RawEvent => e !== null);
            events.push(...rest);
            break;
          }
          fetched += 1;
          try {
            const detail = await deps.fetchPage(entry.url, source, context, "text/html,application/xhtml+xml");
            const parsed = parseJsonLdDocument(detail.body, source, detail.finalUrl).events;
            parsed.forEach((event, index) => {
              event.externalEventId = parsed.length > 1 ? `${entry.slug}#${event.startsAt ?? index}` : entry.slug;
              event.sourceUrl = entry.url;
              event.title ??= entry.title;
              if (event.vendorCount === null) {
                const stated = extractVendorEvidence(event.description);
                event.vendorCount = stated.count;
                event.evidence = stated.evidence;
              }
              event.rawPayload = { ...event.rawPayload, listing: "wix-events", multipleDates: entry.multipleDates };
              events.push(event);
            });
          } catch (error) {
            warnings.push(`${entry.slug}: ${error instanceof Error ? error.message : "detail failed"}`);
            const fallback = listOnlyEvent(entry, source);
            if (fallback) events.push(fallback);
          }
        }
        if (!events.some((event) => event.startsAt !== null)) {
          throw new ParserStructureError("Maker's Market CLT: no listing yielded a start date (page structure may have changed)");
        }
        return collectionSuccess(source.id, events, [], warnings.length > 0 ? warnings.join("; ").slice(0, 500) : null);
      } catch (error) {
        return collectionFailure(source.id, error);
      }
    },
  };
}
