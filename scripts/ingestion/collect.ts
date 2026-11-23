import { createAdapterRegistry } from "@/lib/ingestion/adapters/registry";
import { loadIngestionConfig } from "@/lib/ingestion/config";
import { runCli } from "@/lib/ingestion/log";
import { RobotsChecker } from "@/lib/ingestion/security/robots";
import { createIngestionClient } from "@/lib/ingestion/storage/client";
import { runDailyCollection } from "@/lib/ingestion/workers/daily-collection";
import { createFetchPage } from "@/lib/ingestion/workers/fetch-page";

export async function main(): Promise<void> {
  const config = loadIngestionConfig(process.env);
  const client = createIngestionClient(process.env);
  const robots = new RobotsChecker({
    timeoutMs: config.httpTimeoutMs,
    maxResponseBytes: config.maxResponseBytes,
    maxRedirects: config.maxRedirects,
    userAgent: config.userAgent,
    minDelayMs: 1000,
  });
  // Browser rendering is intentionally not registered: see the containment note in adapters/playwright.ts.
  const registry = createAdapterRegistry({ fetchPage: createFetchPage(config, { robots }) });

  console.log(`[ingest:daily] starting in ${config.publishMode} mode`);
  const summary = await runDailyCollection({ client, config, registry, log: (message) => console.log(message) });
  console.log(`[ingest:daily] summary ${JSON.stringify({ ...summary, sources: undefined })}`);
  if (summary.status === "skipped_overlap") console.log(`::warning title=ingest:daily::Skipped: ${summary.errorSummary ?? "another ingestion run is in progress"}; no source was collected`);
  if (summary.status === "failed") process.exitCode = 1;
}

if (require.main === module) {
  void runCli("ingest:daily", main);
}
