import { loadIngestionConfig } from "@/lib/ingestion/config";
import { runCli } from "@/lib/ingestion/log";
import { createIngestionClient } from "@/lib/ingestion/storage/client";
import { applyRetention } from "@/lib/ingestion/storage/retention";

/** `npm run ingest:retain` is a dry run; pass `-- --apply` to delete. Public events, candidates, reviews and audit rows are never touched. */
export async function main(): Promise<void> {
  loadIngestionConfig(process.env);
  const client = createIngestionClient(process.env);
  const apply = process.argv.includes("--apply");
  const report = await applyRetention(client, { dryRun: !apply });
  console.log(`[ingest:retain] ${JSON.stringify(report)}`);
}

if (require.main === module) {
  void runCli("ingest:retain", main);
}
