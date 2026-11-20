import { sourcePatchSchema, updateSourceControls } from "@/lib/ingestion/review/source-trust";
import { okResponse } from "@/lib/ingestion/security/api-errors";
import { withIngestionAdmin } from "@/lib/ingestion/security/require-admin";
import { parseUuidParam, readJsonBody } from "@/lib/ingestion/security/request";

export const dynamic = "force-dynamic";

interface IdRoute {
  params: Promise<{ id: string }>;
}

export const PATCH = withIngestionAdmin(async (request, route: IdRoute, { admin, client }) => {
  const sourceId = parseUuidParam((await route.params).id);
  const patch = sourcePatchSchema.parse(await readJsonBody(request));
  const result = await updateSourceControls(client, { sourceId, adminId: admin.userId, patch });
  return okResponse({ source_id: result.sourceId, trust_state: result.trustState, enabled: result.enabled });
});
