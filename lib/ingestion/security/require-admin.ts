import { createSupabaseServer } from "@/lib/supabase/server";
import { type IngestionClient, createIngestionClient } from "@/lib/ingestion/storage/client";
import { ApiError, toErrorResponse } from "@/lib/ingestion/security/api-errors";

export interface IngestionAdmin {
  userId: string;
}

type AdminLookup = { data: { user_id: string } | null; error: { message: string } | null };

/** The minimal user-session client surface used for authorization (the anon-key, cookie-bound server client). */
export interface SessionClient {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null }; error: { message: string } | null }> };
  from(table: "app_admins"): {
    select(columns: string): {
      eq(column: string, value: string): { maybeSingle(): PromiseLike<AdminLookup> };
    };
  };
}

export interface AdminGuardDeps {
  sessionClient?: () => SessionClient | Promise<SessionClient>;
}

/**
 * Authorizes a request as a platform administrator BEFORE any elevated client is created.
 *
 * - No verified session: 401. `auth.getUser()` validates the token with Supabase Auth (it does not trust the cookie).
 * - Authenticated but not in `public.app_admins`: 403. Organization ownership or membership never grants access.
 * - Any lookup failure denies access (fail closed): the caller never receives an `IngestionAdmin`.
 */
export async function requireIngestionAdmin(deps: AdminGuardDeps = {}): Promise<IngestionAdmin> {
  let client: SessionClient;
  try {
    client = await (deps.sessionClient ?? (() => createSupabaseServer() as unknown as SessionClient))();
  } catch (cause) {
    throw new ApiError("INTERNAL_ERROR", undefined, { cause });
  }

  let userId: string | null = null;
  try {
    const { data, error } = await client.auth.getUser();
    userId = error ? null : (data.user?.id ?? null);
  } catch {
    userId = null;
  }
  if (!userId) throw new ApiError("UNAUTHORIZED");

  let lookup: AdminLookup;
  try {
    lookup = await client.from("app_admins").select("user_id").eq("user_id", userId).maybeSingle();
  } catch (cause) {
    throw new ApiError("INTERNAL_ERROR", undefined, { cause });
  }
  if (lookup.error) throw new ApiError("INTERNAL_ERROR", undefined, { cause: lookup.error.message });
  if (!lookup.data || lookup.data.user_id !== userId) throw new ApiError("FORBIDDEN");
  return { userId };
}

export interface AdminRouteContext {
  admin: IngestionAdmin;
  /** Service-role client, created only after authorization succeeded. Never expose it to a response. */
  client: IngestionClient;
}

export interface WrapperDeps extends AdminGuardDeps {
  createClient?: () => IngestionClient;
}

/**
 * Wraps an admin route handler: authorize first, then create the elevated client, then run the handler. Every thrown
 * error is mapped to the spec's JSON error shape.
 */
export function withIngestionAdmin<Ctx = unknown>(
  handler: (request: Request, route: Ctx, context: AdminRouteContext) => Promise<Response>,
  deps: WrapperDeps = {},
) {
  return async (request: Request, route: Ctx): Promise<Response> => {
    try {
      const admin = await requireIngestionAdmin(deps);
      let client: IngestionClient;
      try {
        client = (deps.createClient ?? (() => createIngestionClient()))();
      } catch (cause) {
        throw new ApiError("INTERNAL_ERROR", undefined, { cause });
      }
      return await handler(request, route, { admin, client });
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}
