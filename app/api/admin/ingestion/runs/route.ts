import { okResponse } from "@/lib/ingestion/security/api-errors";
import { withIngestionAdmin } from "@/lib/ingestion/security/require-admin";
import { queryObject } from "@/lib/ingestion/security/request";
import { RUNS_QUERY_SCHEMA, toRunItem } from "@/lib/ingestion/review/source-trust";
import { listRuns } from "@/lib/ingestion/storage/runs";

export const dynamic = "force-dynamic";

export const GET = withIngestionAdmin(async (request, _route: unknown, { client }) => {
  const { limit } = RUNS_QUERY_SCHEMA.parse(queryObject(request));
  const runs = await listRuns(client, limit);
  return okResponse({ data: runs.map(toRunItem) });
});
