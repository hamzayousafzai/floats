import { createAdapterRegistry } from "@/lib/ingestion/adapters/registry";
import { loadIngestionConfig } from "@/lib/ingestion/config";
import { runCli } from "@/lib/ingestion/log";
import { RobotsChecker } from "@/lib/ingestion/security/robots";
import { createIngestionClient } from "@/lib/ingestion/storage/client";
import { createFetchPage } from "@/lib/ingestion/workers/fetch-page";
import { runVerification } from "@/lib/ingestion/workers/verify-worker";
import { verificationAnnotations, verificationExitCode } from "@/lib/ingestion/workers/verify-report";

/** Exit 1 only for `failed`; `partial` and `skipped_overlap` exit 0 but are annotated (see verify-report.ts). */
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

  console.log(`[ingest:verify] starting in ${config.publishMode} mode`);
  const summary = await runVerification({ client, config, registry, log: (message) => console.log(message) });
  console.log(`[ingest:verify] summary ${JSON.stringify(summary)}`);
  for (const line of verificationAnnotations(summary)) console.log(line);
  process.exitCode = verificationExitCode(summary.status);
}

if (require.main === module) {
  void runCli("ingest:verify", main);
}
