import type { CandidateRow } from "@/lib/ingestion/storage/rows";
import type { CandidateStatus } from "@/lib/ingestion/types";

/**
 * Spec 6.5. `pending` and `validating` are pipeline states. `validating` is transient: processing passes through it
 * in memory and persists only its outcome. Re-validation edges (`ready`/`needs_review`/`pending` -> `validating`) model
 * a repeat observation; they never apply to approved, published or manually overridden candidates.
 * `pending` is also the outcome for events beyond the publication horizon, which are re-validated on later runs.
 */
export const CANDIDATE_TRANSITIONS: Readonly<Record<CandidateStatus, readonly CandidateStatus[]>> = {
  pending: ["validating"],
  validating: ["pending", "rejected", "needs_review", "ready"],
  ready: ["published", "needs_review", "validating"],
  needs_review: ["approved", "rejected", "validating"],
  approved: ["published"],
  rejected: [],
  published: [],
};

export class InvalidTransitionError extends Error {
  readonly from: CandidateStatus;
  readonly to: CandidateStatus;

  constructor(from: CandidateStatus, to: CandidateStatus) {
    super(`Invalid candidate transition ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function canTransition(from: CandidateStatus, to: CandidateStatus): boolean {
  return CANDIDATE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: CandidateStatus, to: CandidateStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export function isTerminalStatus(status: CandidateStatus): boolean {
  return CANDIDATE_TRANSITIONS[status].length === 0;
}

/** Approved, published and manually overridden candidates (administrator rejections set `manual_override`). */
export function isLockedAgainstRescrape(candidate: Pick<CandidateRow, "status" | "manual_override">): boolean {
  return candidate.manual_override || candidate.status === "approved" || candidate.status === "published";
}

export interface RescrapeResolution {
  /** Status to persist; equals the current status when the candidate is locked. */
  status: CandidateStatus;
  /** True when the stored fields must not be overwritten (only evidence and `last_seen_at` may move). */
  locked: boolean;
  /** True when a rejected candidate is re-opened because the rejection reasons no longer apply. */
  reopened: boolean;
}

/**
 * Decides the persisted status after re-validation. A new candidate takes the outcome directly. Existing locked
 * candidates never change. An automatically rejected candidate re-opens only when validation no longer rejects it
 * (material new evidence); administrators' rejections set `manual_override`, so they are locked.
 */
export function resolveRescrapeStatus(existing: Pick<CandidateRow, "status" | "manual_override"> | null, outcome: CandidateStatus): RescrapeResolution {
  if (!existing) return { status: outcome, locked: false, reopened: false };
  if (isLockedAgainstRescrape(existing)) return { status: existing.status, locked: true, reopened: false };
  if (existing.status === "rejected") {
    return outcome === "rejected" ? { status: "rejected", locked: false, reopened: false } : { status: outcome, locked: false, reopened: true };
  }
  return { status: outcome, locked: false, reopened: false };
}
