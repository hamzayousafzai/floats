import { ApiError } from "@/lib/ingestion/security/api-errors";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_JSON_BODY_BYTES = 65_536;

/** Route identifiers are validated before they reach any query. Malformed ids are a 400, never a database error. */
export function parseUuidParam(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new ApiError("VALIDATION_ERROR", "Invalid identifier");
  return value.toLowerCase();
}

/** Query parameters as a plain object; blank values (such as `cursor=`) count as absent. */
export function queryObject(request: Request): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of new URL(request.url).searchParams) {
    if (value !== "") result[key] = value;
  }
  return result;
}

function hostOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

/**
 * Reads a bounded JSON body for a state-changing admin request. Requires `application/json` (which browsers cannot send
 * cross-site without a CORS preflight) and rejects a cross-origin `Origin` header as defense in depth against CSRF.
 */
export async function readJsonBody(request: Request, maxBytes = MAX_JSON_BODY_BYTES): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(\s*;.*)?$/i.test(contentType.trim())) throw new ApiError("VALIDATION_ERROR", "Content-Type must be application/json");

  const origin = request.headers.get("origin");
  if (origin !== null) {
    const expected = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
    if (hostOf(origin) !== expected) throw new ApiError("FORBIDDEN", "Cross-origin request refused");
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new ApiError("VALIDATION_ERROR", "Request body too large");
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new ApiError("VALIDATION_ERROR", "Request body too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("VALIDATION_ERROR", "Request body must be valid JSON");
  }
}
