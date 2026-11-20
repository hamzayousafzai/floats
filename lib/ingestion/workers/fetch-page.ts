import type { AdapterDeps } from "@/lib/ingestion/adapters/common";
import type { IngestionConfig } from "@/lib/ingestion/config";
import type { RobotsPolicy } from "@/lib/ingestion/security/robots";
import { type SafeFetchOptions, type SafeFetchResult, safeFetch } from "@/lib/ingestion/security/safe-fetch";

export type FetchPageConfig = Pick<IngestionConfig, "httpTimeoutMs" | "maxResponseBytes" | "maxRedirects" | "userAgent" | "maxPagesPerSourcePerRun">;

export interface FetchPageDeps {
  robots: { policyFor(origin: string): Promise<RobotsPolicy> };
  fetcher?: (url: string, options: SafeFetchOptions) => Promise<SafeFetchResult>;
}

/**
 * The production fetch capability handed to adapters: robots.txt is checked for every page, the crawl delay is the larger
 * of the source's own delay and the site's declared `Crawl-delay`, every request goes through `safeFetch` (public
 * addresses only, bounded size/redirects/time), and each source is limited to a fixed number of pages per run.
 */
export function createFetchPage(config: FetchPageConfig, deps: FetchPageDeps): AdapterDeps["fetchPage"] {
  const fetcher = deps.fetcher ?? ((url, options) => safeFetch(url, options));
  const pagesFetched = new Map<string, number>();
  return async (url, source, context, accept) => {
    const key = `${context.runId}:${source.id}`;
    const used = pagesFetched.get(key) ?? 0;
    if (used >= config.maxPagesPerSourcePerRun) throw new Error("Page limit per source reached for this run");

    const parsed = new URL(url);
    const policy = await deps.robots.policyFor(parsed.origin);
    if (!policy.isAllowed(`${parsed.pathname}${parsed.search}`)) throw new Error("Blocked by robots.txt");

    pagesFetched.set(key, used + 1);
    return fetcher(url, {
      timeoutMs: config.httpTimeoutMs,
      maxResponseBytes: config.maxResponseBytes,
      maxRedirects: config.maxRedirects,
      userAgent: config.userAgent,
      minDelayMs: Math.max(source.crawlDelayMs, policy.crawlDelayMs ?? 0),
      accept,
    });
  };
}
