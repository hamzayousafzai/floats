import { z } from "zod";
import { loadIngestionConfig } from "@/lib/ingestion/config";
import { publishCandidate, type PublicationReason } from "@/lib/ingestion/publication/publish-candidate";
import { ApiError, okResponse, type ApiErrorCode } from "@/lib/ingestion/security/api-errors";
import { withIngestionAdmin } from "@/lib/ingestion/security/require-admin";
import { parseUuidParam, readJsonBody } from "@/lib/ingestion/security/request";

export const dynamic = "force-dynamic";

interface IdRoute {
  params: Promise<{ id: string }>;
}

/** Only an explicit manual publication is exposed; there is no public or worker-callable publish endpoint. */
const bodySchema = z.strictObject({ manual: z.literal(true) });

const BLOCKED: Partial<Record<PublicationReason, readonly [ApiErrorCode, string]>> = {
  candidate_not_found: ["NOT_FOUND", "Candidate not found"],
  approval_required: ["CONFLICT", "Candidate requires recorded administrator approval"],
  source_unavailable: ["CONFLICT", "Candidate source is unavailable"],
  hard_gates_failed: ["CONFLICT", "Candidate failed the hard publication gates"],
  outside_radius: ["CONFLICT", "Event is outside the service radius"],
  existing_identity: ["CONFLICT", "An event with this identity is already published"],
  possible_duplicate: ["CONFLICT", "Possible duplicate of an existing event"],
};

export const POST = withIngestionAdmin(async (request, route: IdRoute, { client }) => {
  const id = parseUuidParam((await route.params).id);
  bodySchema.parse(await readJsonBody(request));
  const config = loadIngestionConfig();
  const result = await publishCandidate({ client, config }, id, true);
  if (result.status === "published" && result.eventId) {
    return okResponse({ candidate_id: result.candidateId, event_id: result.eventId, status: "published" });
  }
  const mapped = BLOCKED[result.reason];
  if (mapped) throw new ApiError(mapped[0], mapped[1]);
  throw new ApiError("INTERNAL_ERROR", undefined, { cause: `publication ${result.status}: ${result.reason}` });
});
