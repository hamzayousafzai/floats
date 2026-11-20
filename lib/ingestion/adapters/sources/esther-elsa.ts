import * as cheerio from "cheerio";
import type { CollectionResult, RawEvent } from "@/lib/ingestion/types";
import { type AdapterDeps, ParserStructureError, cleanText, collectionFailure, collectionSuccess, emptyRawEvent, parseHumanDateRange } from "../common";
import type { CollectionContext, EventAdapter, SourceDefinition } from "../types";

/**
 * Front Porch is described on one static page: a rule ("first Saturday of each month"), a date list without years,
 * a daily time range, and the market address. The year is taken only from the page's own "<year> monthly pop-up
 * market" wording, each listed date must agree with the stated "first Saturday" rule, and the address is read from the
 * current page every run (the market has moved before), so a changed page fails loudly instead of publishing stale data.
 */
const MONTH_PATTERN = "(January|February|March|April|May|June|July|August|September|October|November|December)";
const DATE_LINE = new RegExp(`${MONTH_PATTERN}\\s+(\\d{1,2})\\b`, "i");
const ADDRESS = /([A-Z][A-Za-z0-9 .'&-]{1,40}?)\s+(\d{2,6}\s+[A-Za-z0-9 .'-]{3,40}?)\s+(Charlotte),\s*(NC|North Carolina),?\s*(\d{5})/;

function plainText(html: string): string {
  const spaced = html.replace(/<(?:br|\/p|\/li|\/div|\/h[1-6]|\/section)[^>]*>/gi, "\n").replace(/<(?:li)[^>]*>/gi, "\n•");
  return cheerio.load(spaced).text();
}

function isFirstSaturday(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCDay() === 6 && day <= 7;
}

export function parseEstherElsa(html: string, source: SourceDefinition, pageUrl: string): RawEvent[] {
  const text = plainText(html);
  const yearMatch = /\b(20\d{2})\s+monthly\s+pop-?up\s+market\b/i.exec(text);
  if (!yearMatch) throw new ParserStructureError('Esther & Elsa: could not find the "<year> monthly pop-up market" statement (page structure may have changed)');
  const year = Number(yearMatch[1]);
  if (!/first\s+saturday\s+of\s+each\s+month/i.test(text)) throw new ParserStructureError('Esther & Elsa: the "first Saturday of each month" rule is no longer stated');
  const hours = /from\s+(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)\s+to\s+(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)/i.exec(text);
  if (!hours) throw new ParserStructureError("Esther & Elsa: market hours are no longer stated");
  const anchor = text.search(/mark your calendar/i);
  if (anchor < 0) throw new ParserStructureError('Esther & Elsa: the "Mark your calendar" date list was not found');
  const addressMatch = ADDRESS.exec(text.slice(anchor));
  if (!addressMatch) throw new ParserStructureError("Esther & Elsa: market address was not found on the page");
  const joinAt = text.search(/join us at/i);
  const section = text.slice(anchor, joinAt > anchor ? joinAt : anchor + 600);
  const lines = section.split(/[\n•]+/).map((line) => line.trim()).filter(Boolean);

  const monthly = text.search(/each month you/i);
  const vendorText = monthly >= 0 ? text.slice(monthly) : text;
  const stated = /(\d{2,4})\s*\+?\s*(?:local\s+|small\s+)?(?:businesses|vendors|makers)/i.exec(vendorText);
  const vendorCount = stated ? Number(stated[1]) : null;
  const evidence = stated ? [cleanText(vendorText.slice(Math.max(0, stated.index - 20), stated.index + stated[0].length + 30)) ?? stated[0]] : [];
  const venueName = addressMatch[1].trim();
  const address = `${addressMatch[2].trim()}, ${addressMatch[3]}, NC ${addressMatch[5]}`;

  const events: RawEvent[] = [];
  for (const line of lines) {
    const match = DATE_LINE.exec(line);
    if (!match) continue;
    const month = new Date(`${match[1]} 1, 2000`).getMonth() + 1;
    const day = Number(match[2]);
    if (!isFirstSaturday(year, month, day)) {
      throw new ParserStructureError(`Esther & Elsa: ${match[1]} ${day}, ${year} is not a first Saturday, so the page no longer matches its stated schedule`);
    }
    const range = parseHumanDateRange(`${match[1]} ${day}, ${year} ${hours[1]} - ${hours[2]}`);
    if (!range) throw new ParserStructureError(`Esther & Elsa: could not build a date for ${line}`);
    const event = emptyRawEvent(source.id, pageUrl);
    event.externalEventId = `front-porch-${range.start.slice(0, 10)}`;
    event.title = "Front Porch";
    event.description = "Monthly pop-up market of local small businesses and makers.";
    event.startsAt = range.start;
    event.endsAt = range.end;
    event.organizerName = "Esther & Elsa";
    event.venueName = venueName;
    event.address = address;
    event.vendorCount = vendorCount;
    event.evidence = evidence;
    event.cancelled = /\bcancell?ed\b|\bpostponed\b/i.test(line);
    event.rawPayload = { listing: "esther-elsa-front-porch", dateLine: line, yearSource: yearMatch[0], hours: [hours[1], hours[2]] };
    events.push(event);
  }
  if (events.length === 0) throw new ParserStructureError("Esther & Elsa: the date list contained no dates (page structure may have changed)");
  return events;
}

export function createEstherElsaAdapter(deps: AdapterDeps): EventAdapter {
  return {
    type: "html",
    async collect(source: SourceDefinition, context: CollectionContext): Promise<CollectionResult> {
      try {
        const page = await deps.fetchPage(source.baseUrl, source, context, "text/html,application/xhtml+xml");
        return collectionSuccess(source.id, parseEstherElsa(page.body, source, page.finalUrl));
      } catch (error) {
        return collectionFailure(source.id, error);
      }
    },
  };
}
