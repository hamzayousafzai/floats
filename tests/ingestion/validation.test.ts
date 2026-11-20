/**
 * @jest-environment node
 */
import type { NormalizationIssue } from "@/lib/ingestion/normalize/normalize-event";
import type { NormalizedEvent } from "@/lib/ingestion/types";
import { type ValidateEventInput, type ValidationSourceInfo, sourceInfoFromRow, validateEvent } from "@/lib/ingestion/validation/validate-event";

const NOW = new Date("2031-11-20T12:00:00Z");
const CONFIG = { centerLat: 35.2271, centerLng: -80.8431, radiusMiles: 35, horizonDays: 60, minVendorCount: 3, autoPublishScore: 90, reviewScore: 70 };

const TRUSTED: ValidationSourceInfo = { trustState: "trusted", enabled: true, successfulRuns: 10, failedRuns: 0, validEvents: 30, rejectedEvents: 0, documentedMultiVendorFormat: false };
const PROBATION: ValidationSourceInfo = { ...TRUSTED, trustState: "probation" };

function event(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    canonicalKey: "k",
    title: "Example Winter Makers Market",
    description: "Shop with more than forty local makers and artists.",
    startsAt: "2031-12-06T15:00:00.000Z",
    endsAt: "2031-12-06T21:00:00.000Z",
    timezone: "America/New_York",
    organizerName: "Example Collective",
    venueName: "Example Pavilion",
    address: "100 Example St, Charlotte, NC 28202",
    latitude: 35.2271,
    longitude: -80.8431,
    vendorCount: 45,
    vendorEvidence: ["45 local vendors"],
    categorySlugs: [],
    cancelled: false,
    sourceUrl: "https://example.test/market",
    ...overrides,
  };
}

function run(overrides: Partial<Omit<ValidateEventInput, "event">> & { event?: Partial<NormalizedEvent> } = {}) {
  const { event: eventOverrides, ...rest } = overrides;
  return validateEvent({
    event: event(eventOverrides),
    source: TRUSTED,
    locationVerified: true,
    duplicateState: "clear",
    config: CONFIG,
    now: NOW,
    ...rest,
  });
}

describe("validateEvent", () => {
  it("marks a complete, trusted, verified market as ready with all hard gates passing", () => {
    const result = run();
    expect(result).toMatchObject({ status: "ready", reasons: [], hardGatesPassed: true, isMarket: true, vendorVerified: true, locationVerified: true, duplicateState: "clear", cancelled: false });
    expect(result.score).toBeGreaterThanOrEqual(90);
  });

  it("is deterministic", () => {
    expect(run()).toEqual(run());
  });

  it("sends an otherwise perfect event from a probation source to review, not ready", () => {
    const result = run({ source: PROBATION });
    expect(result.status).toBe("needs_review");
    expect(result.reasons).toEqual(["untrusted_source"]);
    expect(result.hardGatesPassed).toBe(true);
  });

  it("sends a trusted candidate below the automatic score to review", () => {
    const result = run({ source: { ...TRUSTED, successfulRuns: 0, failedRuns: 0, validEvents: 0, rejectedEvents: 0 }, event: { vendorCount: 5 } });
    expect(result.score).toBeLessThan(90);
    expect(result.hardGatesPassed).toBe(true);
    expect(result.status).toBe("needs_review");
  });

  it("never lets a high score override a failed hard gate", () => {
    for (const [override, reason] of [
      [{ description: "short" }, "missing_description"],
      [{ title: "Mkt" }, "incomplete_title"],
      [{ address: "Main St" }, "missing_location"],
      [{ endsAt: null }, "missing_end_time"],
      [{ vendorCount: 2 }, "insufficient_vendor_evidence"],
    ] as const) {
      const result = run({ event: override });
      expect(result.status).toBe("needs_review");
      expect(result.hardGateFailures).toContain(reason);
      expect(result.hardGatesPassed).toBe(false);
    }
    const unverified = run({ locationVerified: false });
    expect(unverified).toMatchObject({ status: "needs_review", locationVerified: false });
    expect(unverified.reasons).toContain("missing_location");
    expect(run({ event: { latitude: null, longitude: null } }).reasons).toContain("missing_location");
  });

  it("requires explicit vendor evidence; an unknown count does not imply three vendors", () => {
    expect(run({ event: { vendorCount: null, vendorEvidence: [] } })).toMatchObject({ vendorVerified: false, status: "needs_review", vendorBasis: null });
    expect(run({ event: { vendorCount: 3 } }).vendorVerified).toBe(true);
    expect(run({ event: { vendorCount: 2 } }).vendorVerified).toBe(false);
  });

  it("accepts a documented multi-vendor format only for trusted sources and market events", () => {
    const documented = { ...TRUSTED, documentedMultiVendorFormat: true };
    const noCount = { vendorCount: null, vendorEvidence: [] };
    expect(run({ source: documented, event: noCount })).toMatchObject({ vendorVerified: true, vendorBasis: "documented_format" });
    expect(run({ source: { ...documented, trustState: "probation" }, event: noCount }).vendorVerified).toBe(false);
    expect(run({ source: documented, event: { ...noCount, title: "Spring Fling", description: "Come out and enjoy the afternoon with us." } }).vendorVerified).toBe(false);
  });

  it("rejects clearly excluded event types and market-less unclear events with low scores", () => {
    expect(run({ event: { title: "Sunrise Yoga in the Park", vendorCount: null } })).toMatchObject({ status: "rejected", isMarket: false });
    expect(run({ event: { title: "Trivia Night" } }).reasons).toContain("excluded_event_type");
    const unclear = run({ source: PROBATION, event: { title: "Spring Fling", description: "Come out and enjoy the afternoon with us.", vendorCount: null, endsAt: null } });
    expect(unclear.status).toBe("rejected");
    expect(unclear.reasons).toContain("unclear_event_type");
  });

  it("sends an unclear event with strong other evidence to review rather than ready", () => {
    const result = run({ event: { title: "Spring Fling", description: "Come out and enjoy the afternoon with us." } });
    expect(result.status).toBe("needs_review");
    expect(result.isMarket).toBe(false);
    expect(result.reasons).toContain("unclear_event_type");
  });

  it("does not reject a market with live music", () => {
    const result = run({ event: { title: "Makers Market with Live Music" } });
    expect(result.status).toBe("ready");
    expect(result.isMarket).toBe(true);
  });

  it("rejects cancelled events, by flag or title", () => {
    expect(run({ event: { cancelled: true } })).toMatchObject({ status: "rejected", cancelled: true });
    expect(run({ event: { title: "Makers Market (Cancelled)" } }).reasons).toContain("cancelled");
  });

  it("rejects expired events and holds events beyond the horizon as pending", () => {
    expect(run({ event: { startsAt: "2031-11-19T15:00:00.000Z", endsAt: "2031-11-19T20:00:00.000Z" } })).toMatchObject({ status: "rejected", reasons: ["expired"] });
    const far = run({ event: { startsAt: "2032-03-01T15:00:00.000Z", endsAt: "2032-03-01T20:00:00.000Z" } });
    expect(far.status).toBe("pending");
    expect(far.reasons).toEqual(["outside_horizon"]);
    expect(run({ event: { startsAt: "2032-01-18T11:59:59.000Z", endsAt: "2032-01-18T20:00:00.000Z" } }).status).toBe("ready");
    expect(run({ event: { startsAt: "2032-01-19T12:00:00.000Z", endsAt: "2032-01-19T20:00:00.000Z" } }).status).toBe("pending");
  });

  it("rejects distant verified locations but does not reject unverified ones", () => {
    const raleigh = run({ event: { latitude: 35.7796, longitude: -78.6382, address: "1 Fayetteville St, Raleigh, NC 27601" } });
    expect(raleigh).toMatchObject({ status: "rejected", locationVerified: false });
    expect(raleigh.reasons).toContain("outside_radius");
    expect(run({ locationVerified: false, event: { latitude: 35.7796, longitude: -78.6382 } }).status).toBe("needs_review");
  });

  it("handles date problems reported by normalization as recoverable review items", () => {
    for (const issue of ["date_only", "ambiguous_local_time", "nonexistent_local_time", "unparseable_start", "missing_start"] as NormalizationIssue[]) {
      const result = run({ event: { startsAt: null, endsAt: null }, issues: [issue] });
      expect(result.status).toBe("needs_review");
      expect(result.reasons).toContain("invalid_date");
    }
    const badEnd = run({ event: { endsAt: null }, issues: ["end_not_after_start"] });
    expect(badEnd.reasons).toContain("invalid_date");
    expect(badEnd.reasons).not.toContain("missing_end_time");
    expect(run({ event: { endsAt: "2031-12-06T10:00:00.000Z" } }).reasons).toContain("invalid_date");
    expect(run({ event: { endsAt: null } }).reasons).toEqual(["missing_end_time"]);
    expect(run({ event: { startsAt: "garbage" } }).reasons).toContain("invalid_date");
  });

  it("rejects confirmed duplicates and reviews possible or unchecked ones", () => {
    expect(run({ duplicateState: "confirmed" })).toMatchObject({ status: "rejected", reasons: ["confirmed_duplicate"] });
    for (const state of ["possible", "unchecked"] as const) {
      const result = run({ duplicateState: state });
      expect(result.status).toBe("needs_review");
      expect(result.reasons).toEqual(["possible_duplicate"]);
    }
  });

  it("blocks disabled or disabled-by-flag sources", () => {
    for (const source of [{ ...TRUSTED, trustState: "disabled" as const }, { ...TRUSTED, enabled: false }]) {
      const result = run({ source });
      expect(result.status).toBe("needs_review");
      expect(result.hardGateFailures).toContain("source_unavailable");
    }
  });

  it("derives source info from a database row", () => {
    expect(
      sourceInfoFromRow({
        trust_state: "trusted", enabled: true, successful_runs: 4, failed_runs: 1, valid_events: 9, rejected_events: 2,
        configuration: { documentedMultiVendorFormat: true },
      } as never),
    ).toEqual({ trustState: "trusted", enabled: true, successfulRuns: 4, failedRuns: 1, validEvents: 9, rejectedEvents: 2, documentedMultiVendorFormat: true });
    expect(sourceInfoFromRow({ trust_state: "probation", configuration: { documentedMultiVendorFormat: "yes" } } as never).documentedMultiVendorFormat).toBe(false);
  });
});
