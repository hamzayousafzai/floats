import { withIngestionAdmin } from "@/lib/ingestion/security/require-admin";
import { okResponse, ApiError } from "@/lib/ingestion/security/api-errors";
import { queryObject } from "@/lib/ingestion/security/request";
import { InvalidCursorError, listCandidates } from "@/lib/ingestion/storage/candidates";
import { LIST_QUERY_SCHEMA, toListItem } from "@/lib/ingestion/review/review-candidate";

export const dynamic = "force-dynamic";

export const GET = withIngestionAdmin(async (request, _route: unknown, { client }) => {
  const query = LIST_QUERY_SCHEMA.parse(queryObject(request));
  try {
    const { rows, nextCursor } = await listCandidates(client, { status: query.status, limit: query.limit, cursor: query.cursor });
    return okResponse({ data: rows.map(toListItem), next_cursor: nextCursor });
  } catch (error) {
    if (error instanceof InvalidCursorError) throw new ApiError("VALIDATION_ERROR", "Invalid cursor");
    throw error;
  }
});
