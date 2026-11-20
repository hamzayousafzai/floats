/**
 * @jest-environment node
 */
import { SCORE_WEIGHTS, type ScoreFacts, calculateCandidateScore } from "@/lib/ingestion/validation/score";

const perfect: ScoreFacts = {
  source: { trustState: "trusted", successfulRuns: 10, failedRuns: 0, validEvents: 40, rejectedEvents: 0 },
  vendorCount: 40,
  vendorBasis: "count",
  startState: "in_window",
  endValid: true,
  location: "verified_in_radius",
  classification: { kind: "market", strength: 2 },
};

describe("calculateCandidateScore", () => {
  it("weights sum to exactly 100 and a perfect candidate scores exactly 100", () => {
    expect(Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(calculateCandidateScore(perfect)).toEqual({ sourceReliability: 25, vendorEvidence: 30, dateTime: 20, geolocation: 15, classification: 10, total: 100 });
  });

  it("is deterministic and never exceeds a component maximum", () => {
    expect(calculateCandidateScore(perfect)).toEqual(calculateCandidateScore({ ...perfect }));
    const worst = calculateCandidateScore({
      source: { trustState: "disabled", successfulRuns: 0, failedRuns: 9, validEvents: 0, rejectedEvents: 9 },
      vendorCount: null,
      vendorBasis: null,
      startState: "invalid",
      endValid: true,
      location: "none",
      classification: { kind: "excluded", strength: 0 },
    });
    expect(worst.total).toBe(0);
  });

  it("scores source reliability by trust tier plus observed history", () => {
    const score = (trustState: ScoreFacts["source"]["trustState"], successfulRuns: number, failedRuns: number, validEvents: number, rejectedEvents: number) =>
      calculateCandidateScore({ ...perfect, source: { trustState, successfulRuns, failedRuns, validEvents, rejectedEvents } }).sourceReliability;
    expect(score("trusted", 0, 0, 0, 0)).toBe(15);
    expect(score("trusted", 3, 1, 5, 5)).toBe(15 + 4 + 3);
    expect(score("probation", 10, 0, 10, 0)).toBe(10);
    expect(score("probation", 0, 0, 0, 0)).toBe(0);
    expect(score("disabled", 10, 0, 10, 0)).toBe(0);
  });

  it("scores vendor evidence in tiers and gives less for documented format or unverified counts", () => {
    const vendors = (vendorCount: number | null, vendorBasis: ScoreFacts["vendorBasis"]) => calculateCandidateScore({ ...perfect, vendorCount, vendorBasis }).vendorEvidence;
    expect(vendors(3, "count")).toBe(20);
    expect(vendors(9, "count")).toBe(20);
    expect(vendors(10, "count")).toBe(25);
    expect(vendors(24, "count")).toBe(25);
    expect(vendors(25, "count")).toBe(30);
    expect(vendors(null, "documented_format")).toBe(15);
    expect(vendors(2, null)).toBe(5);
    expect(vendors(null, null)).toBe(0);
  });

  it("scores date, location and classification components", () => {
    const part = (override: Partial<ScoreFacts>) => calculateCandidateScore({ ...perfect, ...override });
    expect(part({ startState: "out_of_window" }).dateTime).toBe(12);
    expect(part({ startState: "in_window", endValid: false }).dateTime).toBe(12);
    expect(part({ startState: "invalid", endValid: true }).dateTime).toBe(0);
    expect(part({ location: "unverified" }).geolocation).toBe(3);
    expect(part({ location: "outside_radius" }).geolocation).toBe(0);
    expect(part({ classification: { kind: "market", strength: 1 } }).classification).toBe(7);
    expect(part({ classification: { kind: "unclear", strength: 0 } }).classification).toBe(0);
  });
});
