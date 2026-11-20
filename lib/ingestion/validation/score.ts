import type { TrustState } from "@/lib/ingestion/types";
import type { MarketClassification } from "./classify";

/** Maximum points per component; they sum to exactly 100. */
export const SCORE_WEIGHTS = { sourceReliability: 25, vendorEvidence: 30, dateTime: 20, geolocation: 15, classification: 10 } as const;

export interface ScoreSource {
  trustState: TrustState;
  successfulRuns: number;
  failedRuns: number;
  validEvents: number;
  rejectedEvents: number;
}

export type VendorBasis = "count" | "documented_format" | null;
export type StartState = "in_window" | "out_of_window" | "invalid";
export type LocationState = "verified_in_radius" | "unverified" | "outside_radius" | "none";

export interface ScoreFacts {
  source: ScoreSource;
  vendorCount: number | null;
  vendorBasis: VendorBasis;
  startState: StartState;
  endValid: boolean;
  location: LocationState;
  classification: Pick<MarketClassification, "kind" | "strength">;
}

export interface ScoreBreakdown {
  sourceReliability: number;
  vendorEvidence: number;
  dateTime: number;
  geolocation: number;
  classification: number;
  total: number;
}

const ratio = (good: number, bad: number): number => (good + bad > 0 ? good / (good + bad) : 0);

/** Source reliability: trust tier plus observed run success and candidate validity. 0-25. */
function sourcePoints(source: ScoreSource): number {
  if (source.trustState === "disabled") return 0;
  const runs = Math.round(5 * ratio(source.successfulRuns, source.failedRuns));
  const quality = Math.round(5 * ratio(source.validEvents, source.rejectedEvents));
  return (source.trustState === "trusted" ? 15 : 0) + runs + quality;
}

/** Vendor evidence: explicit count tiers, or a smaller fixed credit for a documented trusted format. 0-30. */
function vendorPoints(count: number | null, basis: VendorBasis): number {
  if (basis === "count" && count !== null) return count >= 25 ? 30 : count >= 10 ? 25 : 20;
  if (basis === "documented_format") return 15;
  if (count !== null && count > 0) return 5;
  return 0;
}

/** Date/time: a usable start (12, or 4 outside the horizon) plus a valid end after it (8). 0-20. */
function dateTimePoints(startState: StartState, endValid: boolean): number {
  const start = startState === "in_window" ? 12 : startState === "out_of_window" ? 4 : 0;
  return start + (startState !== "invalid" && endValid ? 8 : 0);
}

function geolocationPoints(location: LocationState): number {
  return location === "verified_in_radius" ? 15 : location === "unverified" ? 3 : 0;
}

function classificationPoints(classification: Pick<MarketClassification, "kind" | "strength">): number {
  if (classification.kind !== "market") return 0;
  return classification.strength === 2 ? 10 : 7;
}

/**
 * Deterministic, additive 0-100 score. It orders review work only; it is not a probability and never overrides a
 * hard gate (the validator applies gates independently).
 */
export function calculateCandidateScore(facts: ScoreFacts): ScoreBreakdown {
  const parts = {
    sourceReliability: sourcePoints(facts.source),
    vendorEvidence: vendorPoints(facts.vendorCount, facts.vendorBasis),
    dateTime: dateTimePoints(facts.startState, facts.endValid),
    geolocation: geolocationPoints(facts.location),
    classification: classificationPoints(facts.classification),
  };
  return { ...parts, total: Object.values(parts).reduce((sum, value) => sum + value, 0) };
}
