import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { sanitizeForLog } from "@/lib/ingestion/log";

export type ApiErrorCode = "UNAUTHORIZED" | "FORBIDDEN" | "VALIDATION_ERROR" | "NOT_FOUND" | "CONFLICT" | "INTERNAL_ERROR";

export const ERROR_STATUS: Readonly<Record<ApiErrorCode, number>> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
};

const DEFAULT_MESSAGE: Readonly<Record<ApiErrorCode, string>> = {
  UNAUTHORIZED: "Authentication required",
  FORBIDDEN: "Administrator access required",
  VALIDATION_ERROR: "Request validation failed",
  NOT_FOUND: "Resource not found",
  CONFLICT: "Request conflicts with current state",
  INTERNAL_ERROR: "Internal error",
};

/** `message` is returned to the caller: only put safe, static text in it. Internal detail goes in `cause`. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, message?: string, options?: { cause?: unknown }) {
    super(message ?? DEFAULT_MESSAGE[code], options);
    this.name = "ApiError";
    this.code = code;
    this.status = ERROR_STATUS[code];
  }
}

const NO_STORE = { "Cache-Control": "no-store" } as const;

export function errorResponse(code: ApiErrorCode, message?: string): NextResponse {
  return NextResponse.json({ ok: false, error: { code, message: message ?? DEFAULT_MESSAGE[code] } }, { status: ERROR_STATUS[code], headers: NO_STORE });
}

export function okResponse<T extends Record<string, unknown>>(body: T, status = 200): NextResponse {
  return NextResponse.json({ ok: true, ...body }, { status, headers: NO_STORE });
}

/**
 * Converts any thrown value to the spec's JSON error. Unknown errors become a generic 500: SQL text, stack traces,
 * connection strings and credentials never reach the response, and the server log receives a sanitized summary.
 */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    if (error.status >= 500) console.error(`[ingestion-api] ${error.code}: ${sanitizeForLog(error.cause ?? error)}`);
    return errorResponse(error.code, error.message);
  }
  if (error instanceof ZodError) return errorResponse("VALIDATION_ERROR");
  console.error(`[ingestion-api] unexpected failure: ${sanitizeForLog(error)}`);
  return errorResponse("INTERNAL_ERROR");
}
