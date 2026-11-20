import { okResponse } from "@/lib/ingestion/security/api-errors";
import { withIngestionAdmin } from "@/lib/ingestion/security/require-admin";
import { toSourceItem } from "@/lib/ingestion/review/source-trust";
import { listSources } from "@/lib/ingestion/storage/sources";

export const dynamic = "force-dynamic";

export const GET = withIngestionAdmin(async (_request, _route: unknown, { client }) => {
  const sources = await listSources(client);
  return okResponse({ data: sources.map(toSourceItem) });
});
