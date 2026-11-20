import { parseIcsDocument } from "@/lib/ingestion/adapters/ics";
import { parseJsonLdDocument } from "@/lib/ingestion/adapters/jsonld";
import type { SourceDefinition } from "@/lib/ingestion/adapters/types";
import type { AdapterType } from "@/lib/ingestion/types";

export interface DetectionInput {
  url: string;
  contentType: string;
  body: string;
}

export interface DetectionResult {
  adapter: AdapterType | null;
  /** Number of events the generic adapter could extract. Zero when unsupported. */
  eventCount: number;
  reason: string;
}

const PROBE: SourceDefinition = { id: "discovery-probe", name: "probe", baseUrl: "https://probe.invalid", adapter: "jsonld", crawlDelayMs: 0, configuration: {} };

/**
 * Tests whether a generic adapter can read the page. Only machine-readable formats (iCalendar, schema.org JSON-LD
 * Event) qualify: selector-based HTML and browser-rendered pages need a hand-written configuration, so they are
 * reported as unsupported rather than guessed at. Parsing runs on text already fetched through `safeFetch`.
 */
export function detectAdapter(input: DetectionInput): DetectionResult {
  const type = input.contentType.toLowerCase();
  const looksLikeIcs = type.includes("text/calendar") || /^\s*BEGIN:VCALENDAR/i.test(input.body);
  if (looksLikeIcs) {
    try {
      const events = parseIcsDocument(input.body, { ...PROBE, adapter: "ics" }, input.url);
      return { adapter: "ics", eventCount: events.length, reason: `iCalendar feed with ${events.length} event(s)` };
    } catch {
      return { adapter: null, eventCount: 0, reason: "iCalendar document contained no usable events" };
    }
  }
  if (type.includes("html") || type.includes("xml")) {
    try {
      const { events } = parseJsonLdDocument(input.body, PROBE, input.url);
      return { adapter: "jsonld", eventCount: events.length, reason: `schema.org Event markup with ${events.length} event(s)` };
    } catch {
      return { adapter: null, eventCount: 0, reason: "No iCalendar feed or schema.org Event markup; needs a custom adapter" };
    }
  }
  return { adapter: null, eventCount: 0, reason: `Unsupported content type: ${type || "missing"}` };
}
