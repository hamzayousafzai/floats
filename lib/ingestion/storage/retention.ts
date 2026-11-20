import { type IngestionClient, ingestionDb, throwIfError } from "./client";

export const RAW_RETENTION_DAYS = 90;
export const RUN_RETENTION_DAYS = 365;
export const RETENTION_BATCH_SIZE = 200;
/** Hard bound on rows examined per table in one invocation. */
export const RETENTION_MAX_EXAMINED = 5000;

export interface RetentionOptions {
  now?: Date;
  rawDays?: number;
  runDays?: number;
  /** Nothing is deleted unless this is exactly `false`. */
  dryRun?: boolean;
  batchSize?: number;
  maxExamined?: number;
}

export interface RetentionReport {
  dryRun: boolean;
  rawCutoff: string;
  runCutoff: string;
  observationsExamined: number;
  observationsDeleted: number;
  observationsProtected: number;
  runsExamined: number;
  runsDeleted: number;
  runsProtected: number;
}

const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/**
 * Observations that must outlive the raw retention window: evidence for any candidate that is still live (anything
 * other than `rejected`, which includes every published candidate's provenance) or that a human reviewed.
 */
async function protectedObservationIds(client: IngestionClient, observationIds: string[]): Promise<Set<string>> {
  const protectedIds = new Set<string>();
  if (observationIds.length === 0) return protectedIds;
  const db = ingestionDb(client);

  const { data: links, error: linkError } = await db.from("candidate_sources").select("candidate_id, observation_id").in("observation_id", observationIds);
  throwIfError("Failed to load evidence links", linkError);
  const linkRows = (links ?? []) as { candidate_id: string; observation_id: string }[];
  const candidateIds = [...new Set(linkRows.map((l) => l.candidate_id))];
  if (candidateIds.length === 0) return protectedIds;

  const activeCandidates = new Set<string>();
  const reviewedCandidates = new Set<string>();
  for (const ids of chunk(candidateIds, 100)) {
    const { data: candidates, error: candidateError } = await db.from("candidates").select("id, status, published_event_id").in("id", ids);
    throwIfError("Failed to load candidates", candidateError);
    for (const c of (candidates ?? []) as { id: string; status: string; published_event_id: string | null }[]) {
      if (c.status !== "rejected" || c.published_event_id) activeCandidates.add(c.id);
    }
    const { data: reviews, error: reviewError } = await db.from("reviews").select("candidate_id").in("candidate_id", ids);
    throwIfError("Failed to load reviews", reviewError);
    for (const r of (reviews ?? []) as { candidate_id: string }[]) reviewedCandidates.add(r.candidate_id);
  }

  for (const link of linkRows) {
    if (activeCandidates.has(link.candidate_id) || reviewedCandidates.has(link.candidate_id)) protectedIds.add(link.observation_id);
  }
  return protectedIds;
}

async function pruneObservations(client: IngestionClient, cutoff: string, dryRun: boolean, batchSize: number, maxExamined: number, report: RetentionReport): Promise<void> {
  const db = ingestionDb(client);
  let cursor: string | null = null;
  while (report.observationsExamined < maxExamined) {
    let query = db.from("observations").select("id").lt("observed_at", cutoff).order("id", { ascending: true }).limit(batchSize);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    throwIfError("Failed to list expired observations", error);
    const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
    if (ids.length === 0) return;
    cursor = ids[ids.length - 1];
    report.observationsExamined += ids.length;

    const keep = await protectedObservationIds(client, ids);
    const deletable = ids.filter((id) => !keep.has(id));
    report.observationsProtected += ids.length - deletable.length;
    if (deletable.length > 0) {
      if (!dryRun) {
        const { error: deleteError } = await db.from("observations").delete().in("id", deletable).lt("observed_at", cutoff);
        throwIfError("Failed to delete expired observations", deleteError);
      }
      report.observationsDeleted += deletable.length;
    }
    if (ids.length < batchSize) return;
  }
}

async function pruneRuns(client: IngestionClient, cutoff: string, dryRun: boolean, batchSize: number, maxExamined: number, report: RetentionReport): Promise<void> {
  const db = ingestionDb(client);
  let cursor: string | null = null;
  while (report.runsExamined < maxExamined) {
    // Only finished runs are ever candidates; a `running` run holds the run lock.
    let query = db.from("runs").select("id").lt("started_at", cutoff).neq("status", "running").order("id", { ascending: true }).limit(batchSize);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    throwIfError("Failed to list expired runs", error);
    const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
    if (ids.length === 0) return;
    cursor = ids[ids.length - 1];
    report.runsExamined += ids.length;

    // Observations still reference their run (foreign key); a run whose evidence is retained is retained too.
    const { data: referenced, error: referencedError } = await db.from("observations").select("run_id").in("run_id", ids);
    throwIfError("Failed to check run references", referencedError);
    const inUse = new Set(((referenced ?? []) as { run_id: string }[]).map((r) => r.run_id));
    const deletable = ids.filter((id) => !inUse.has(id));
    report.runsProtected += ids.length - deletable.length;
    if (deletable.length > 0) {
      if (!dryRun) {
        const { error: deleteError } = await db.from("runs").delete().in("id", deletable).neq("status", "running");
        throwIfError("Failed to delete expired runs", deleteError);
      }
      report.runsDeleted += deletable.length;
    }
    if (ids.length < batchSize) return;
  }
}

/**
 * Data retention. Raw observations are removed after 90 days unless they are evidence for a live or reviewed candidate;
 * finished runs after 365 days once no retained observation references them. Candidates, reviews, publication audit
 * rows, source audit trails and public events are never touched, and a source disappearing is not a retention event.
 * Defaults to a dry run.
 */
export async function applyRetention(client: IngestionClient, options: RetentionOptions = {}): Promise<RetentionReport> {
  const now = options.now ?? new Date();
  const rawDays = options.rawDays ?? RAW_RETENTION_DAYS;
  const runDays = options.runDays ?? RUN_RETENTION_DAYS;
  const dryRun = options.dryRun !== false;
  const batchSize = Math.max(1, Math.min(options.batchSize ?? RETENTION_BATCH_SIZE, 500));
  const maxExamined = options.maxExamined ?? RETENTION_MAX_EXAMINED;
  if (rawDays < RAW_RETENTION_DAYS || runDays < RUN_RETENTION_DAYS) {
    throw new Error(`Retention windows cannot be shorter than ${RAW_RETENTION_DAYS} (raw) and ${RUN_RETENTION_DAYS} (runs) days`);
  }
  const rawCutoff = new Date(now.getTime() - rawDays * 86_400_000).toISOString();
  const runCutoff = new Date(now.getTime() - runDays * 86_400_000).toISOString();
  const report: RetentionReport = {
    dryRun, rawCutoff, runCutoff,
    observationsExamined: 0, observationsDeleted: 0, observationsProtected: 0,
    runsExamined: 0, runsDeleted: 0, runsProtected: 0,
  };
  await pruneObservations(client, rawCutoff, dryRun, batchSize, maxExamined, report);
  await pruneRuns(client, runCutoff, dryRun, batchSize, maxExamined, report);
  return report;
}
