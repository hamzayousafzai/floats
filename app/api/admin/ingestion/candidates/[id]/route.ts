import { loadIngestionConfig } from "@/lib/ingestion/config";
import { reviewCandidate, reviewPatchSchema, toDetail } from "@/lib/ingestion/review/review-candidate";
import { ApiError, okResponse } from "@/lib/ingestion/security/api-errors";
import { withIngestionAdmin } from "@/lib/ingestion/security/require-admin";
import { parseUuidParam, readJsonBody } from "@/lib/ingestion/security/request";
import { getCandidateById, listCandidateSources } from "@/lib/ingestion/storage/candidates";

export const dynamic = "force-dynamic";

interface IdRoute {
  params: Promise<{ id: string }>;
}

export const GET = withIngestionAdmin(async (_request, route: IdRoute, { client }) => {
  const id = parseUuidParam((await route.params).id);
  const candidate = await getCandidateById(client, id);
  if (!candidate) throw new ApiError("NOT_FOUND", "Candidate not found");
  const sources = await listCandidateSources(client, id);
  return okResponse({ data: toDetail(candidate, sources) });
});

export const PATCH = withIngestionAdmin(async (request, route: IdRoute, { admin, client }) => {
  const id = parseUuidParam((await route.params).id);
  const patch = reviewPatchSchema.parse(await readJsonBody(request));
  const config = loadIngestionConfig();
  const result = await reviewCandidate({ client, config }, { candidateId: id, adminId: admin.userId, patch });
  return okResponse({ candidate_id: result.candidateId, status: result.status, published_event_id: result.publishedEventId });
});
