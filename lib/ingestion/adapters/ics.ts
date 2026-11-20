import { fromZonedTime } from "date-fns-tz";
import type { CollectionResult, RawEvent } from "@/lib/ingestion/types";
import { type AdapterDeps, ParserStructureError, cleanText, collectionFailure, collectionSuccess, emptyRawEvent, extractVendorEvidence, resolveUrl } from "./common";
import type { CollectionContext, EventAdapter, SourceDefinition } from "./types";

interface Property {
  name: string;
  params: Record<string, string>;
  value: string;
}

const NEW_YORK = "America/New_York";

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_m, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

function parseLine(line: string): Property | null {
  let inQuotes = false;
  let colon = -1;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ":" && !inQuotes) {
      colon = i;
      break;
    }
  }
  if (colon <= 0) return null;
  const [name, ...rawParams] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const raw of rawParams) {
    const eq = raw.indexOf("=");
    if (eq > 0) params[raw.slice(0, eq).toUpperCase()] = raw.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

export function parseIcsComponents(text: string): Property[][] {
  const lines = unfold(text);
  if (!lines.some((l) => l.trim().toUpperCase() === "BEGIN:VCALENDAR")) throw new ParserStructureError("Not an iCalendar document (no VCALENDAR)");
  const events: Property[][] = [];
  let current: Property[] | null = null;
  for (const line of lines) {
    const upper = line.trim().toUpperCase();
    if (upper === "BEGIN:VEVENT") current = [];
    else if (upper === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
    } else if (current) {
      const prop = parseLine(line);
      if (prop) current.push(prop);
    }
  }
  if (events.length === 0) throw new ParserStructureError("iCalendar document contains no VEVENT components");
  return events;
}

interface Moment {
  /** Local wall time (no offset) for floating or America/New_York values; UTC `Z` instant for everything else; date for all-day. */
  value: string;
  allDay: boolean;
  /** Epoch milliseconds usable only for duration arithmetic. */
  epoch: number | null;
}

const DATE_TIME = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/;

function parseMoment(prop: Property | undefined, rawValue?: string): Moment | null {
  if (!prop && rawValue === undefined) return null;
  const raw = (rawValue ?? prop?.value ?? "").trim();
  const match = DATE_TIME.exec(raw);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, z] = match;
  const dateOnly = `${y}-${mo}-${d}`;
  if (h === undefined) return { value: dateOnly, allDay: true, epoch: Date.UTC(Number(y), Number(mo) - 1, Number(d)) };
  const local = `${dateOnly}T${h}:${mi}:${s ?? "00"}`;
  if (z) return { value: `${local}Z`, allDay: false, epoch: Date.parse(`${local}Z`) };
  const tzid = prop?.params.TZID;
  if (!tzid || tzid === NEW_YORK) return { value: local, allDay: false, epoch: Date.parse(`${local}Z`) };
  try {
    const instant = fromZonedTime(local, tzid);
    if (Number.isNaN(instant.getTime())) return null;
    return { value: instant.toISOString(), allDay: false, epoch: instant.getTime() };
  } catch {
    return null;
  }
}

function formatLike(template: Moment, epoch: number): string {
  const iso = new Date(epoch).toISOString();
  if (template.allDay) return iso.slice(0, 10);
  return template.value.endsWith("Z") ? iso : iso.slice(0, 19);
}

function first(props: Property[], name: string): Property | undefined {
  return props.find((p) => p.name === name);
}

function build(props: Property[], source: SourceDefinition, pageUrl: string, instance: { start: Moment | null; end: Moment | null; suffix: string | null }): RawEvent {
  const uid = first(props, "UID")?.value.trim() ?? null;
  const description = cleanText(unescapeText(first(props, "DESCRIPTION")?.value ?? ""));
  const vendors = extractVendorEvidence(description);
  const rrule = first(props, "RRULE")?.value ?? null;
  const organizer = first(props, "ORGANIZER");
  const event = emptyRawEvent(source.id, resolveUrl(first(props, "URL")?.value, pageUrl) ?? pageUrl);
  event.externalEventId = uid ? (instance.suffix ? `${uid}#${instance.suffix}` : uid) : null;
  event.title = cleanText(unescapeText(first(props, "SUMMARY")?.value ?? ""));
  event.description = description;
  event.startsAt = instance.start?.value ?? null;
  event.endsAt = instance.end?.value ?? null;
  event.organizerName = cleanText(organizer?.params.CN ?? null);
  event.address = cleanText(unescapeText(first(props, "LOCATION")?.value ?? ""));
  event.vendorCount = vendors.count;
  event.evidence = vendors.evidence;
  event.categories = (first(props, "CATEGORIES")?.value.split(",") ?? []).map((c) => cleanText(unescapeText(c))).filter((c): c is string => c !== null);
  event.cancelled = (first(props, "STATUS")?.value ?? "").trim().toUpperCase() === "CANCELLED";
  event.rawPayload = {
    uid,
    status: first(props, "STATUS")?.value ?? null,
    dtstart: first(props, "DTSTART")?.value ?? null,
    dtstartTzid: first(props, "DTSTART")?.params.TZID ?? null,
    allDay: instance.start?.allDay ?? false,
    // Recurrence rules are recorded but never expanded; only explicit RDATE instances become events.
    rrule,
    recurrenceId: first(props, "RECURRENCE-ID")?.value ?? null,
  };
  return event;
}

export function parseIcsDocument(text: string, source: SourceDefinition, pageUrl: string): RawEvent[] {
  const components = parseIcsComponents(text);
  const events: RawEvent[] = [];
  for (const props of components) {
    const dtstart = first(props, "DTSTART");
    const dtend = first(props, "DTEND");
    const start = parseMoment(dtstart);
    const end = dtend ? parseMoment(dtend) : null;
    const recurrenceId = first(props, "RECURRENCE-ID")?.value ?? null;
    events.push(build(props, source, pageUrl, { start, end, suffix: recurrenceId }));

    const exdates = new Set<string>();
    for (const ex of props.filter((p) => p.name === "EXDATE")) for (const v of ex.value.split(",")) exdates.add(v.trim());
    const duration = start?.epoch != null && end?.epoch != null ? end.epoch - start.epoch : null;
    for (const rdate of props.filter((p) => p.name === "RDATE")) {
      for (const value of rdate.value.split(",")) {
        if (exdates.has(value.trim())) continue;
        const instanceStart = parseMoment({ ...rdate, name: "DTSTART" }, value);
        if (!instanceStart || instanceStart.epoch == null) continue;
        // The end is only carried over when the source states one for the base event; never invented.
        const instanceEnd: Moment | null = duration != null && !instanceStart.allDay ? { ...instanceStart, value: formatLike(instanceStart, instanceStart.epoch + duration), epoch: instanceStart.epoch + duration } : null;
        events.push(build(props, source, pageUrl, { start: instanceStart, end: instanceEnd, suffix: value.trim() }));
      }
    }
  }
  return events;
}

export function createIcsAdapter(deps: AdapterDeps): EventAdapter {
  return {
    type: "ics",
    async collect(source: SourceDefinition, context: CollectionContext): Promise<CollectionResult> {
      try {
        const feedUrl = typeof source.configuration.icsUrl === "string" ? source.configuration.icsUrl : source.baseUrl;
        const page = await deps.fetchPage(feedUrl, source, context, "text/calendar,text/plain");
        return collectionSuccess(source.id, parseIcsDocument(page.body, source, page.finalUrl));
      } catch (error) {
        return collectionFailure(source.id, error);
      }
    },
  };
}
