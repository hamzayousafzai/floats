import { createAdapterRegistry } from "@/lib/ingestion/adapters/registry";
import { loadIngestionConfig } from "@/lib/ingestion/config";
import { runCli } from "@/lib/ingestion/log";
import { RobotsChecker } from "@/lib/ingestion/security/robots";
import { createIngestionClient } from "@/lib/ingestion/storage/client";
import { createFetchPage } from "@/lib/ingestion/workers/fetch-page";
import { runVerification } from "@/lib/ingestion/workers/verify-worker";

/** Exits nonzero when verification finds an error (for example a missed daily run), so a scheduler can alert on it. */
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
  const registry = createAdapterRegistry(
    { fetchPage: createFetchPage(config, { robots }) },
    {
      userAgent: config.userAgent,
      navigationTimeoutMs: config.httpTimeoutMs,
      maxHtmlBytes: config.maxResponseBytes,
      isAllowed: (url) => robots.isAllowed(url),
    },
  );

  console.log(`[ingest:verify] starting in ${config.publishMode} mode`);
  const summary = await runVerification({ client, config, registry, log: (message) => console.log(message) });
  console.log(`[ingest:verify] summary ${JSON.stringify(summary)}`);
  if (summary.status === "failed") process.exitCode = 1;
}

if (require.main === module) {
  void runCli("ingest:verify", main);
}
