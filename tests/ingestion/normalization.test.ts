/**
 * @jest-environment node
 */
import { generateCanonicalKey, localDateInNewYork, normalizeTitleForKey } from "@/lib/ingestion/normalize/canonical-key";
import { normalizeAddress, streetKey } from "@/lib/ingestion/normalize/normalize-address";
import { cleanDisplayText, normalizeEvent, normalizeEventDetailed } from "@/lib/ingestion/normalize/normalize-event";
import { NormalizationError, normalizeSourceUrl } from "@/lib/ingestion/normalize/normalize-url";
import type { RawEvent } from "@/lib/ingestion/types";

const NOW = new Date("2031-01-01T00:00:00Z");

function raw(overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    sourceId: "src",
    externalEventId: "ext-1",
    sourceUrl: "https://www.example.test/events/market",
    title: "Example Winter Makers Market",
    description: "Shop 45 local vendors.",
    startsAt: "2031-12-06T10:00:00",
    endsAt: "2031-12-06T16:00:00",
    organizerName: "Example Collective",
    venueName: "Example Pavilion",
    address: "100 Example St, Charlotte, NC 28202",
    vendorCount: 45,
    evidence: ["45 local vendors"],
    categories: ["Makers Market"],
    cancelled: false,
    rawPayload: { a: 1 },
    ...overrides,
  };
}

describe("normalizeSourceUrl", () => {
  it("canonicalizes host, port, fragment, trackers, ordering and trailing slash", () => {
    expect(normalizeSourceUrl("HTTPS://WWW.Example.COM:443/Events/?utm_source=a&fbclid=b&z=1&a=2#frag")).toBe("https://www.example.com/Events?a=2&z=1");
    expect(normalizeSourceUrl("http://example.com")).toBe("http://example.com/");
    expect(normalizeSourceUrl("https://example.com/a/?ref_src=x")).toBe("https://example.com/a");
  });

  it.each(["ftp://example.com/", "javascript:alert(1)", "https://user:pw@example.com/", "not a url", ""])("rejects %j", (value) => {
    expect(() => normalizeSourceUrl(value)).toThrow(NormalizationError);
  });
});

describe("normalizeAddress / streetKey", () => {
  it("treats abbreviation, punctuation, country and zip+4 differences as equal", () => {
    const a = normalizeAddress("2315 North Davidson Street Charlotte, NC, 28205 United States");
    const b = normalizeAddress("2315 N Davidson St, Charlotte, North Carolina 28205-1234");
    expect(a).toBe(b);
    expect(a).toBe("2315 n davidson st charlotte nc 28205");
  });

  it("reduces to the building for identity and ignores city, zip and suite", () => {
    const keys = ["2315 N Davidson St", "2315 North Davidson Street Charlotte, NC 28205", "2315 N. Davidson St., Suite 300, Charlotte"].map(streetKey);
    expect(new Set(keys)).toEqual(new Set(["2315 n davidson st"]));
    expect(streetKey("633 Herrons Ferry Road")).toBe("633 herrons ferry rd");
  });

  it("returns null for empty input and keeps different buildings different", () => {
    expect(normalizeAddress("")).toBeNull();
    expect(normalizeAddress(null)).toBeNull();
    expect(streetKey("100 Example St")).not.toBe(streetKey("101 Example St"));
  });
});

describe("generateCanonicalKey", () => {
  const base = { title: "Makers Market", address: "100 Example St, Charlotte, NC", venueName: null, startsAt: "2031-12-06T15:00:00.000Z" };

  it("is a deterministic lowercase sha256 hex", () => {
    const key = generateCanonicalKey(base);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(generateCanonicalKey({ ...base })).toBe(key);
  });

  it("ignores case, punctuation, apostrophes, accents, ampersands and cancellation wording in the title", () => {
    const key = generateCanonicalKey(base);
    for (const title of ["MAKERS MARKET", "Maker's Market", "Makers  Market!", "Makérs Market", "Makers Market (CANCELLED)"]) {
      expect(generateCanonicalKey({ ...base, title })).toBe(key);
    }
    expect(normalizeTitleForKey("Arts & Crafts")).toBe(normalizeTitleForKey("Arts and Crafts"));
  });

  it("separates different dates, places and titles but not formatting of the same address", () => {
    const key = generateCanonicalKey(base);
    expect(generateCanonicalKey({ ...base, startsAt: "2031-12-13T15:00:00.000Z" })).not.toBe(key);
    expect(generateCanonicalKey({ ...base, address: "200 Other Rd, Charlotte, NC" })).not.toBe(key);
    expect(generateCanonicalKey({ ...base, title: "Holiday Market" })).not.toBe(key);
    expect(generateCanonicalKey({ ...base, address: "100 EXAMPLE STREET Charlotte NC 28202" })).toBe(key);
  });

  it("uses the America/New_York calendar date, so the late evening of one day is not the next day", () => {
    expect(localDateInNewYork("2031-12-07T03:30:00.000Z")).toBe("2031-12-06");
    expect(generateCanonicalKey({ ...base, startsAt: "2031-12-07T03:30:00.000Z" })).toBe(generateCanonicalKey({ ...base, startsAt: "2031-12-06T15:00:00.000Z" }));
  });

  it("falls back to the venue when no address exists and keeps undated events distinct", () => {
    const venueOnly = { ...base, address: null, venueName: "Example Pavilion" };
    expect(generateCanonicalKey(venueOnly)).not.toBe(generateCanonicalKey(base));
    const undated = { ...base, startsAt: null };
    expect(generateCanonicalKey(undated, null, "a")).not.toBe(generateCanonicalKey(undated, null, "b"));
    expect(generateCanonicalKey(undated, "2031-12-06")).toBe(generateCanonicalKey(base));
  });
});

describe("cleanDisplayText", () => {
  it("removes markup, scripts, entities and control characters but keeps facts", () => {
    expect(cleanDisplayText("<p>Shop <b>45</b> vendors &amp; makers</p><script>alert(1)</script>")).toBe("Shop 45 vendors & makers");
    expect(cleanDisplayText("a\u200Bb\u0007c")).toBe("abc");
    expect(cleanDisplayText("  \n ")).toBeNull();
    expect(cleanDisplayText(null)).toBeNull();
  });

  it("keeps paragraph breaks when multiline and normalizes unicode to NFC", () => {
    expect(cleanDisplayText("<p>One</p><p>Two</p><br><br><br>Three", true)).toBe("One\nTwo\n\nThree");
    expect(cleanDisplayText("Cafe\u0301")).toBe("Caf\u00e9");
    expect(cleanDisplayText("Brand™")).toBe("Brand™");
  });
});

describe("normalizeEvent", () => {
  it("converts New York wall time to UTC, preserving winter and summer offsets", () => {
    expect(normalizeEvent(raw(), NOW)).toMatchObject({ startsAt: "2031-12-06T15:00:00.000Z", endsAt: "2031-12-06T21:00:00.000Z", timezone: "America/New_York" });
    expect(normalizeEvent(raw({ startsAt: "2031-07-12T17:00:00", endsAt: "2031-07-12T22:00:00" }), NOW)).toMatchObject({ startsAt: "2031-07-12T21:00:00.000Z", endsAt: "2031-07-13T02:00:00.000Z" });
  });

  it("respects explicit offsets and Z instants", () => {
    expect(normalizeEvent(raw({ startsAt: "2031-12-06T10:00:00-05:00", endsAt: "2031-12-06T21:00:00Z" }), NOW)).toMatchObject({ startsAt: "2031-12-06T15:00:00.000Z", endsAt: "2031-12-06T21:00:00.000Z" });
    expect(normalizeEvent(raw({ startsAt: "2031-12-06T10:00:00+0100", endsAt: null }), NOW).startsAt).toBe("2031-12-06T09:00:00.000Z");
  });

  it("rejects ambiguous and nonexistent DST wall times without an offset, and keeps the date in the identity key", () => {
    const ambiguous = normalizeEventDetailed(raw({ startsAt: "2031-11-02T01:30:00", endsAt: null }), NOW);
    expect(ambiguous.event.startsAt).toBeNull();
    expect(ambiguous.issues).toContain("ambiguous_local_time");
    const gap = normalizeEventDetailed(raw({ startsAt: "2031-03-09T02:30:00", endsAt: null }), NOW);
    expect(gap.event.startsAt).toBeNull();
    expect(gap.issues).toContain("nonexistent_local_time");
    expect(ambiguous.event.canonicalKey).not.toBe(gap.event.canonicalKey);
    const sameDay = normalizeEvent(raw({ startsAt: "2031-11-02T10:00:00", endsAt: null }), NOW);
    expect(ambiguous.event.canonicalKey).toBe(sameDay.canonicalKey);
    // An explicit offset resolves the ambiguity.
    expect(normalizeEvent(raw({ startsAt: "2031-11-02T01:30:00-04:00", endsAt: null }), NOW).startsAt).toBe("2031-11-02T05:30:00.000Z");
  });

  it("leaves missing or unusable values null and reports why, never inventing an end time", () => {
    const noEnd = normalizeEventDetailed(raw({ endsAt: null }), NOW);
    expect(noEnd.event.endsAt).toBeNull();
    expect(noEnd.issues).toEqual([]);
    expect(normalizeEventDetailed(raw({ startsAt: null, endsAt: null }), NOW).issues).toContain("missing_start");
    expect(normalizeEventDetailed(raw({ startsAt: "2031-12-06" }), NOW)).toMatchObject({ issues: ["date_only"], event: { startsAt: null, endsAt: null } });
    for (const bad of ["tomorrow", "2031-13-40T10:00:00", "2031-02-30T10:00:00", "2031-12-06T25:00:00"]) {
      const result = normalizeEventDetailed(raw({ startsAt: bad, endsAt: null }), NOW);
      expect(result.event.startsAt).toBeNull();
      expect(result.issues).toContain("unparseable_start");
    }
    const backwards = normalizeEventDetailed(raw({ startsAt: "2031-12-06T16:00:00", endsAt: "2031-12-06T10:00:00" }), NOW);
    expect(backwards.event.endsAt).toBeNull();
    expect(backwards.issues).toContain("end_not_after_start");
    expect(normalizeEventDetailed(raw({ endsAt: "garbage" }), NOW).issues).toContain("unparseable_end");
  });

  it("cleans text fields, URL, evidence and categories and leaves coordinates for geocoding", () => {
    const event = normalizeEvent(
      raw({
        title: "  <b>Makers   Market</b> ",
        description: "<p>Hello &amp; welcome</p><p>Second</p>",
        sourceUrl: "https://WWW.Example.test/events/market/?utm_campaign=x#top",
        evidence: ["45 local vendors", "45 local vendors", "  "],
        categories: ["Makers Market", "makers  market", "Arts & Crafts"],
        vendorCount: -3,
      }),
      NOW,
    );
    expect(event).toMatchObject({
      title: "Makers Market",
      description: "Hello & welcome\nSecond",
      sourceUrl: "https://www.example.test/events/market",
      vendorEvidence: ["45 local vendors"],
      categorySlugs: ["makers-market", "arts-crafts"],
      vendorCount: null,
      latitude: null,
      longitude: null,
    });
  });

  it("does not mutate its input and is deterministic", () => {
    const input = raw({ evidence: ["a", "b"], categories: ["x"] });
    const snapshot = JSON.parse(JSON.stringify(input));
    const first = normalizeEvent(input, NOW);
    expect(input).toEqual(snapshot);
    expect(normalizeEvent(input, NOW)).toEqual(first);
    first.vendorEvidence.push("z");
    expect(input.evidence).toEqual(["a", "b"]);
  });

  it("gives the same identity to the same event from two sources and different identities to different dates", () => {
    const a = normalizeEvent(raw({ title: "Maker's Market", address: "100 Example Street, Charlotte NC", sourceUrl: "https://a.example.test/x" }), NOW);
    const b = normalizeEvent(raw({ title: "Makers Market!", address: "100 EXAMPLE ST", sourceUrl: "https://b.example.test/y", startsAt: "2031-12-06T09:00:00" }), NOW);
    const next = normalizeEvent(raw({ title: "Maker's Market", address: "100 Example Street, Charlotte NC", startsAt: "2031-12-13T10:00:00" }), NOW);
    expect(a.canonicalKey).toBe(b.canonicalKey);
    expect(a.canonicalKey).not.toBe(next.canonicalKey);
  });

  it("throws on events without a title or with an unsafe source URL", () => {
    expect(() => normalizeEvent(raw({ title: "  " }), NOW)).toThrow(NormalizationError);
    expect(() => normalizeEvent(raw({ title: null }), NOW)).toThrow(NormalizationError);
    expect(() => normalizeEvent(raw({ sourceUrl: "javascript:alert(1)" }), NOW)).toThrow(NormalizationError);
  });
});
