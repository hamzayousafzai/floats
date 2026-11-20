import type { AdapterDeps } from "@/lib/ingestion/adapters/common";
import type { CollectionContext, SourceDefinition } from "@/lib/ingestion/adapters/types";
import type { AdapterType } from "@/lib/ingestion/types";
import type { IngestionConfig } from "@/lib/ingestion/config";
import { sanitizeForLog } from "@/lib/ingestion/log";
import { normalizeSourceUrl } from "@/lib/ingestion/normalize/normalize-url";
import { saveSourceDiscovery, listSourceDiscoveries } from "@/lib/ingestion/storage/discoveries";
import type { IngestionClient } from "@/lib/ingestion/storage/client";
import type { RunRow, SourceRow } from "@/lib/ingestion/storage/rows";
import { RunInProgressError, abandonStaleRuns, createRun, finishRun, findActiveRun } from "@/lib/ingestion/storage/runs";
import { getEnabledSources, getSourceByBaseUrl, listSources, upsertSource } from "@/lib/ingestion/storage/sources";
import { toSourceDefinition } from "@/lib/ingestion/workers/source-runner";
import { canonicalDomain, isIgnoredDomain, isSafeCandidateUrl, restrictedReason } from "./canonicalize-domain";
import { detectAdapter } from "./detect-adapter";
import { eventLikeUrls, extractLinks, parseSitemap } from "./extract-links";

export type DiscoveryConfig = Pick<IngestionConfig, "maxDiscoveryDepth" | "maxDiscoveryPagesPerSource">;

export interface DiscoveryDeps {
  client: IngestionClient;
  config: DiscoveryConfig;
  fetchPage: AdapterDeps["fetchPage"];
  now?: () => Date;
  staleRunMinutes?: number;
  log?: (message: string) => void;
}

export type DiscoveryRunStatus = "succeeded" | "partial" | "failed" | "skipped_overlap";

export interface SeedReport {
  sourceId: string;
  name: string;
  status: "succeeded" | "failed";
  error: string | null;
  pagesFetched: number;
  candidatesSeen: number;
  compatible: number;
  unsupported: number;
  restricted: number;
  duplicates: number;
  registered: number;
  fetchErrors: number;
}

export interface DiscoverySummary {
  status: DiscoveryRunStatus;
  runId: string | null;
  seedsAttempted: number;
  seedsSucceeded: number;
  pagesFetched: number;
  compatible: number;
  unsupported: number;
  restricted: number;
  duplicates: number;
  registered: number;
  errorSummary: string | null;
  seeds: SeedReport[];
}

/** Pages reserved for evaluating discovered candidates so link traversal cannot starve evaluation. */
const EVALUATION_RESERVE_RATIO = 3;
const MAX_CANDIDATES_PER_SEED = 50;
const FEED_ACCEPT = "text/calendar,text/html,application/xhtml+xml";
const PAGE_ACCEPT = "text/html,application/xhtml+xml";
export const DEFAULT_DISCOVERY_STALE_MINUTES = 90;

interface Candidate {
  url: string;
  isFeed: boolean;
}

interface SharedState {
  /** Canonical domains that are already sources, already evaluated, or evaluated earlier in this run. */
  knownDomains: Set<string>;
}

function emptySeedReport(seed: SourceRow): SeedReport {
  return { sourceId: seed.id, name: seed.name, status: "succeeded", error: null, pagesFetched: 0, candidatesSeen: 0, compatible: 0, unsupported: 0, restricted: 0, duplicates: 0, registered: 0, fetchErrors: 0 };
}

const safeDomain = (url: string): string | null => {
  try {
    return canonicalDomain(url);
  } catch {
    return null;
  }
};

/**
 * Discovers candidate sources from one existing source. Traversal is breadth-first over same-site pages (depth and page
 * budgets are hard limits), organizer/venue links and calendar feeds become candidates, and each candidate domain is
 * evaluated once. Every fetch goes through the injected `fetchPage` (robots check plus `safeFetch`).
 */
async function discoverFromSeed(deps: DiscoveryDeps, seed: SourceRow, runId: string, shared: SharedState): Promise<SeedReport> {
  const report = emptySeedReport(seed);
  const definition: SourceDefinition = toSourceDefinition(seed);
  const maxPages = deps.config.maxDiscoveryPagesPerSource;
  const maxDepth = deps.config.maxDiscoveryDepth;
  const traversalLimit = Math.max(1, maxPages - Math.floor(maxPages / EVALUATION_RESERVE_RATIO));
  const context: CollectionContext = { runId, now: (deps.now ?? (() => new Date()))(), horizonDays: 0, signal: new AbortController().signal };

  type FetchOutcome = { ok: true; body: string; contentType: string; finalUrl: string } | { ok: false; reason: "budget" | "robots" | "error"; message: string };
  const fetchBounded = async (url: string, accept: string): Promise<FetchOutcome> => {
    if (report.pagesFetched >= maxPages) return { ok: false, reason: "budget", message: "Discovery page budget exhausted" };
    report.pagesFetched += 1;
    try {
      const page = await deps.fetchPage(url, definition, context, accept);
      return { ok: true, body: page.body, contentType: page.contentType, finalUrl: page.finalUrl };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: /robots\.txt/i.test(message) ? "robots" : "error", message: sanitizeForLog(message) };
    }
  };

  const seedDomain = safeDomain(seed.base_url);
  if (seedDomain) shared.knownDomains.add(seedDomain);

  const candidates = new Map<string, Candidate>();
  const addCandidate = (url: string, isFeed: boolean) => {
    const domain = safeDomain(url);
    if (!domain || domain === seedDomain || isIgnoredDomain(url)) return;
    const existing = candidates.get(domain);
    if (existing && (existing.isFeed || !isFeed)) return;
    if (!existing && candidates.size >= MAX_CANDIDATES_PER_SEED) return;
    candidates.set(domain, { url, isFeed });
  };

  // --- Traversal: seed page, sitemap, then same-site pages up to the depth and page limits.
  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: normalizeSourceUrl(seed.base_url), depth: 0 }];
  visited.add(queue[0].url);
  let seedReached = false;

  if (maxDepth >= 1 && traversalLimit > 1) {
    const sitemap = await fetchBounded(`${new URL(seed.base_url).origin}/sitemap.xml`, "application/xml,text/xml");
    if (sitemap.ok) {
      try {
        for (const url of eventLikeUrls(parseSitemap(sitemap.body).urls)) {
          const same = safeDomain(url) === seedDomain;
          if (same && !visited.has(url) && queue.length < maxPages) {
            visited.add(url);
            queue.push({ url, depth: 1 });
          }
        }
      } catch {
        // A malformed sitemap is not a seed failure.
      }
    }
  }

  while (queue.length > 0 && report.pagesFetched < traversalLimit) {
    const next = queue.shift();
    if (!next) break;
    const page = await fetchBounded(next.url, PAGE_ACCEPT);
    if (!page.ok) {
      if (next.depth === 0) {
        report.status = "failed";
        report.error = page.message;
        return report;
      }
      report.fetchErrors += 1;
      continue;
    }
    if (next.depth === 0) seedReached = true;
    const links = extractLinks(page.body, page.finalUrl);
    for (const feed of links.calendarFeeds) addCandidate(feed, true);
    for (const external of links.external) addCandidate(external, false);
    if (next.depth < maxDepth) {
      for (const internal of links.internal) {
        if (visited.has(internal) || visited.size > maxPages) continue;
        visited.add(internal);
        queue.push({ url: internal, depth: next.depth + 1 });
      }
    }
  }
  if (!seedReached) {
    report.status = "failed";
    report.error = "Seed page was not fetched";
    return report;
  }

  // --- Evaluation: one fetch per new candidate domain, within the remaining page budget.
  for (const candidate of [...candidates.values()].sort((a, b) => Number(b.isFeed) - Number(a.isFeed))) {
    report.candidatesSeen += 1;
    const domain = safeDomain(candidate.url);
    if (!domain) continue;
    if (shared.knownDomains.has(domain)) {
      report.duplicates += 1;
      continue;
    }
    shared.knownDomains.add(domain);

    const record = (evaluation: "compatible" | "unsupported" | "restricted", reason: string, adapter: AdapterType | null, registeredSourceId: string | null = null) =>
      saveSourceDiscovery(deps.client, { discoveredUrl: candidate.url, parentSourceId: seed.id, evaluation, reason, adapterDetected: adapter, registeredSourceId });

    if (!isSafeCandidateUrl(candidate.url)) {
      await record("restricted", "Unsafe URL (non-public host or credentials)", null);
      report.restricted += 1;
      continue;
    }
    const blocked = restrictedReason(candidate.url);
    if (blocked) {
      await record("restricted", blocked, null);
      report.restricted += 1;
      continue;
    }

    const page = await fetchBounded(candidate.url, FEED_ACCEPT);
    if (!page.ok) {
      if (page.reason === "budget") {
        shared.knownDomains.delete(domain);
        break;
      }
      if (page.reason === "robots") {
        await record("restricted", "Blocked by robots.txt", null);
        report.restricted += 1;
      } else {
        // Transient or unknown: leave unrecorded so the next weekly run tries again.
        shared.knownDomains.delete(domain);
        report.fetchErrors += 1;
      }
      continue;
    }

    const detection = detectAdapter({ url: page.finalUrl, contentType: page.contentType, body: page.body });
    if (!detection.adapter || detection.eventCount === 0) {
      await record("unsupported", detection.reason, null);
      report.unsupported += 1;
      continue;
    }

    const baseUrl = normalizeSourceUrl(page.finalUrl);
    if (await getSourceByBaseUrl(deps.client, baseUrl)) {
      report.duplicates += 1;
      continue;
    }
    // Registered disabled and in probation: an administrator must enable it, and it can never auto-publish until reviewed.
    const { source, created } = await upsertSource(deps.client, {
      name: domain,
      baseUrl,
      sourceType: "organizer",
      adapter: detection.adapter,
      discoveryOnly: false,
      enabled: false,
      configuration: { discovery: { parentSourceId: seed.id, discoveredAt: context.now.toISOString(), evidence: detection.reason, eventCount: detection.eventCount } },
    });
    await record("compatible", detection.reason, detection.adapter, source.id);
    report.compatible += 1;
    if (created) report.registered += 1;
  }

  return report;
}

function emptySummary(status: DiscoveryRunStatus, runId: string | null, errorSummary: string | null): DiscoverySummary {
  return { status, runId, seedsAttempted: 0, seedsSucceeded: 0, pagesFetched: 0, compatible: 0, unsupported: 0, restricted: 0, duplicates: 0, registered: 0, errorSummary, seeds: [] };
}

/**
 * Weekly bounded discovery. Seeds are existing enabled sources; results are stored as compatible/unsupported/restricted
 * and compatible candidates are registered as disabled `probation` sources. No events are created here, nothing is
 * trusted, and every request is bounded by depth, page budget, robots.txt and `safeFetch`.
 */
export async function runDiscovery(deps: DiscoveryDeps): Promise<DiscoverySummary> {
  const { client } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const staleMinutes = deps.staleRunMinutes ?? DEFAULT_DISCOVERY_STALE_MINUTES;
  const log = deps.log ?? (() => undefined);

  await abandonStaleRuns(client, "discovery", staleMinutes, now);
  if (await findActiveRun(client, "discovery", staleMinutes, now)) return emptySummary("skipped_overlap", null, "A discovery run is already in progress");
  let run: RunRow;
  try {
    run = await createRun(client, "discovery");
  } catch (error) {
    if (error instanceof RunInProgressError) return emptySummary("skipped_overlap", null, error.message);
    throw error;
  }

  const seeds: SeedReport[] = [];
  try {
    const seedRows = await getEnabledSources(client, { includeDiscoveryOnly: true });
    const known = new Set<string>();
    for (const source of await listSources(client)) {
      const domain = safeDomain(source.base_url);
      if (domain) known.add(domain);
    }
    for (const discovery of await listSourceDiscoveries(client)) {
      const domain = safeDomain(discovery.discovered_url);
      if (domain) known.add(domain);
    }
    const shared: SharedState = { knownDomains: known };

    for (const seed of seedRows) {
      log(`[ingest:discover] seed: ${seed.name}`);
      try {
        seeds.push(await discoverFromSeed(deps, seed, run.id, shared));
      } catch (error) {
        seeds.push({ ...emptySeedReport(seed), status: "failed", error: sanitizeForLog(error) });
      }
    }

    const succeeded = seeds.filter((s) => s.status === "succeeded").length;
    const status: Exclude<DiscoveryRunStatus, "skipped_overlap"> = seeds.length > 0 && succeeded === seeds.length ? "succeeded" : succeeded > 0 ? "partial" : "failed";
    const total = (pick: (s: SeedReport) => number) => seeds.reduce((sum, s) => sum + pick(s), 0);
    const notes = seeds.filter((s) => s.status === "failed").map((s) => `${s.name}: ${s.error ?? "failed"}`);
    if (seeds.length === 0) notes.push("No enabled seed sources");
    const summary: DiscoverySummary = {
      status,
      runId: run.id,
      seedsAttempted: seeds.length,
      seedsSucceeded: succeeded,
      pagesFetched: total((s) => s.pagesFetched),
      compatible: total((s) => s.compatible),
      unsupported: total((s) => s.unsupported),
      restricted: total((s) => s.restricted),
      duplicates: total((s) => s.duplicates),
      registered: total((s) => s.registered),
      errorSummary: notes.length > 0 ? notes.join("; ").slice(0, 1000) : null,
      seeds,
    };
    await finishRun(client, run.id, {
      status,
      sourcesAttempted: summary.seedsAttempted,
      sourcesSucceeded: summary.seedsSucceeded,
      errorSummary: summary.errorSummary,
      metadata: { pagesFetched: summary.pagesFetched, compatible: summary.compatible, unsupported: summary.unsupported, restricted: summary.restricted, duplicates: summary.duplicates, registered: summary.registered },
    });
    return summary;
  } catch (error) {
    try {
      await finishRun(client, run.id, { status: "failed", sourcesAttempted: seeds.length, sourcesSucceeded: seeds.filter((s) => s.status === "succeeded").length, errorSummary: `Fatal: ${sanitizeForLog(error)}` });
    } catch {
      // The stale-run sweep closes it on the next start.
    }
    throw error;
  }
}
