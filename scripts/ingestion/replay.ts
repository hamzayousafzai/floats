import { loadIngestionConfig } from "@/lib/ingestion/config";
import { runCli } from "@/lib/ingestion/log";
import { createIngestionClient } from "@/lib/ingestion/storage/client";
import { runReplay } from "@/lib/ingestion/workers/replay-worker";

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

/** `npm run ingest:replay -- [--source=<id>] [--run=<id>] [--since=<ISO>] [--limit=<n>]`. Offline: no source is fetched. */
export async function main(): Promise<void> {
  const config = loadIngestionConfig(process.env);
  const client = createIngestionClient(process.env);
  const limit = option("limit");
  console.log("[ingest:replay] starting (offline; never publishes)");
  const summary = await runReplay(
    { client, config, log: (message) => console.log(message) },
    { sourceId: option("source"), runId: option("run"), since: option("since"), limit: limit ? Number(limit) : undefined },
  );
  console.log(`[ingest:replay] summary ${JSON.stringify(summary)}`);
  if (summary.status === "failed") process.exitCode = 1;
}

if (require.main === module) {
  void runCli("ingest:replay", main);
}
