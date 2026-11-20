import * as cheerio from "cheerio";
import type { CollectionResult, RawEvent } from "@/lib/ingestion/types";
import { type AdapterDeps, ParserStructureError, cleanText, collectionFailure, collectionSuccess, emptyRawEvent, extractVendorEvidence, resolveUrl } from "./common";
import type { CollectionContext, EventAdapter, SourceDefinition } from "./types";

type Json = Record<string, unknown>;

const EVENT_TYPES = new Set([
  "event", "saleevent", "festival", "exhibitionevent", "socialevent", "businessevent", "foodevent", "visualartsevent",
  "educationevent", "literaryevent", "musicevent", "theaterevent", "sportsevent", "childrensevent", "comedyevent", "danceevent",
]);

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typesOf(node: Json): string[] {
  const raw = node["@type"];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter((t): t is string => typeof t === "string").map((t) => t.replace(/^.*[/#]/, "").toLowerCase());
}

export function isEventNode(node: Json): boolean {
  return typesOf(node).some((t) => EVENT_TYPES.has(t));
}

/** Depth-first walk of arrays, @graph, and nested objects collecting Event nodes (sub-events are not descended into twice). */
export function findEventNodes(value: unknown, found: Json[] = [], depth = 0): Json[] {
  if (depth > 8) return found;
  if (Array.isArray(value)) {
    for (const item of value) findEventNodes(item, found, depth + 1);
  } else if (isObject(value)) {
    if (isEventNode(value)) {
      found.push(value);
      return found;
    }
    for (const key of ["@graph", "mainEntity", "itemListElement", "item"]) {
      if (key in value) findEventNodes(value[key], found, depth + 1);
    }
  }
  return found;
}

function text(value: unknown): string | null {
  if (typeof value === "string") return cleanText(value);
  if (isObject(value) && typeof value.name === "string") return cleanText(value.name);
  if (Array.isArray(value)) return text(value[0]);
  return null;
}

function addressText(value: unknown): string | null {
  if (typeof value === "string") return cleanText(value);
  if (Array.isArray(value)) return addressText(value[0]);
  if (!isObject(value)) return null;
  const parts = [value.streetAddress, value.addressLocality, value.addressRegion, value.postalCode]
    .map((part) => cleanText(part))
    .filter((part): part is string => part !== null);
  // A street address is required to be a usable location; city-only strings are not enough.
  if (typeof value.streetAddress !== "string" || cleanText(value.streetAddress) === null) return null;
  return parts.join(", ");
}

function dateString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function eventFromJsonLd(node: Json, source: SourceDefinition, pageUrl: string): RawEvent {
  const event = emptyRawEvent(source.id, resolveUrl(node.url, pageUrl) ?? pageUrl);
  const location = Array.isArray(node.location) ? node.location[0] : node.location;
  const description = cleanText(node.description);
  const vendors = extractVendorEvidence(description);
  const status = typeof node.eventStatus === "string" ? node.eventStatus.toLowerCase() : "";
  const identifier = node["@id"] ?? node.identifier;

  event.externalEventId = typeof identifier === "string" || typeof identifier === "number" ? String(identifier) : null;
  event.title = cleanText(node.name);
  event.description = description;
  event.startsAt = dateString(node.startDate);
  event.endsAt = dateString(node.endDate);
  event.organizerName = text(node.organizer);
  event.venueName = isObject(location) ? cleanText(location.name) : null;
  event.address = isObject(location) ? addressText(location.address) : typeof location === "string" ? cleanText(location) : null;
  event.vendorCount = vendors.count;
  event.evidence = vendors.evidence;
  event.cancelled = status.includes("cancelled") || status.includes("canceled");
  event.rawPayload = node;
  return event;
}

export function parseJsonLdDocument(html: string, source: SourceDefinition, pageUrl: string): { events: RawEvent[]; invalidBlocks: number; blocks: number } {
  const $ = cheerio.load(html);
  const blocks = $('script[type="application/ld+json"]').toArray();
  if (blocks.length === 0) throw new ParserStructureError("No JSON-LD blocks found on the page");
  let invalidBlocks = 0;
  const nodes: Json[] = [];
  for (const block of blocks) {
    const raw = $(block).contents().text().trim();
    try {
      findEventNodes(JSON.parse(raw), nodes);
    } catch {
      invalidBlocks += 1;
    }
  }
  if (nodes.length === 0) {
    throw new ParserStructureError(invalidBlocks > 0 ? "JSON-LD blocks were present but none could be parsed as events" : "JSON-LD present but contains no Event objects");
  }
  return { events: nodes.map((node) => eventFromJsonLd(node, source, pageUrl)), invalidBlocks, blocks: blocks.length };
}

export function createJsonLdAdapter(deps: AdapterDeps): EventAdapter {
  return {
    type: "jsonld",
    async collect(source: SourceDefinition, context: CollectionContext): Promise<CollectionResult> {
      try {
        const page = await deps.fetchPage(source.baseUrl, source, context, "text/html,application/xhtml+xml");
        const { events, invalidBlocks } = parseJsonLdDocument(page.body, source, page.finalUrl);
        return collectionSuccess(source.id, events, [], invalidBlocks > 0 ? `${invalidBlocks} JSON-LD block(s) could not be parsed` : null);
      } catch (error) {
        return collectionFailure(source.id, error);
      }
    },
  };
}
