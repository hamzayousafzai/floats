export type AdminApiErrorCode = "UNAUTHORIZED" | "FORBIDDEN" | "VALIDATION_ERROR" | "NOT_FOUND" | "CONFLICT" | "INTERNAL_ERROR" | "NETWORK_ERROR";

export class AdminApiError extends Error {
  readonly code: AdminApiErrorCode;
  readonly status: number;
  constructor(code: AdminApiErrorCode, message: string, status: number) {
    super(message);
    this.name = "AdminApiError";
    this.code = code;
    this.status = status;
  }
}

const API_PREFIX = "/api/admin/ingestion/";

/**
 * The only network entry point for the ingestion admin UI. It talks to the same-origin, administrator-guarded REST
 * API; the browser never queries the ingestion schema and never holds a service credential.
 */
export async function adminFetch<T>(path: string, init: { method?: "GET" | "PATCH" | "POST"; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  if (!path.startsWith(API_PREFIX)) throw new Error("adminFetch only calls the ingestion admin API");
  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method ?? "GET",
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
      cache: "no-store",
      signal: init.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new AdminApiError("NETWORK_ERROR", "Network error. Check your connection and retry.", 0);
  }
  let payload: { ok?: boolean; error?: { code?: AdminApiErrorCode; message?: string } } | null = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok || !payload || payload.ok !== true) {
    throw new AdminApiError(payload?.error?.code ?? "INTERNAL_ERROR", payload?.error?.message ?? "Request failed", response.status);
  }
  return payload as T;
}

export const errorMessage = (error: unknown): string => (error instanceof AdminApiError ? error.message : "Something went wrong. Retry.");
