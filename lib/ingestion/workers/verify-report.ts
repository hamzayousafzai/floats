import type { VerificationStatus, VerificationSummary } from "./verify-worker";

/**
 * Exit codes for `ingest:verify`:
 * - succeeded: 0.
 * - partial: 0. Warnings only (a failing source, an event the source stopped listing, the 1000-candidate limit, rechecks
 *   skipped because another ingestion run held the lock). The job stays green but every finding is annotated.
 * - failed: 1. At least one error finding (a missed daily run, a recheck that threw, the run deadline passing before every
 *   source was rechecked). The job fails so the failure notification fires.
 * - skipped_overlap: 0. Another verification is already running and covers the same checks; annotated as a warning.
 */
export function verificationExitCode(status: VerificationStatus): 0 | 1 {
  return status === "failed" ? 1 : 0;
}

const escapeAnnotation = (text: string): string => text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

/** GitHub Actions workflow commands; harmless plain text anywhere else. Messages are already sanitised by the worker. */
export function verificationAnnotations(summary: Pick<VerificationSummary, "status" | "findings">): string[] {
  if (summary.status === "skipped_overlap") return ["::warning title=ingest:verify::Skipped: another verification run is in progress; no checks ran in this invocation"];
  return summary.findings.map((f) => `::${f.severity === "error" ? "error" : "warning"} title=ingest:verify ${f.code}::${escapeAnnotation(f.message)}`);
}
