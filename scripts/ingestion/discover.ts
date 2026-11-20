import { loadIngestionConfig } from "@/lib/ingestion/config";
import { runDiscovery } from "@/lib/ingestion/discovery/discover-sources";
import { runCli } from "@/lib/ingestion/log";
import { RobotsChecker } from "@/lib/ingestion/security/robots";
import { createIngestionClient } from "@/lib/ingestion/storage/client";
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

  console.log(`[ingest:discover] starting (depth<=${config.maxDiscoveryDepth}, pages/source<=${config.maxDiscoveryPagesPerSource})`);
  const summary = await runDiscovery({ client, config, fetchPage: createFetchPage(config, { robots }), log: (message) => console.log(message) });
  console.log(`[ingest:discover] summary ${JSON.stringify({ ...summary, seeds: undefined })}`);
  if (summary.status === "skipped_overlap") console.log("[ingest:discover] skipped: another discovery run is in progress");
  if (summary.status === "failed") process.exitCode = 1;
}

if (require.main === module) {
  void runCli("ingest:discover", main);
}
