import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadIngestionConfig } from "@/lib/ingestion/config";
import { sanitizeForLog } from "@/lib/ingestion/log";

/** Service-role client. Backend only: never import this from client components or expose to the browser. */
export type IngestionClient = SupabaseClient;

export interface PostgrestLikeError {
  code?: string | null;
  message: string;
}

export class IngestionStorageError extends Error {
  readonly code: string | null;

  constructor(context: string, error: PostgrestLikeError) {
    super(`${context}: ${sanitizeForLog(error.message)}`);
    this.name = "IngestionStorageError";
    this.code = error.code ?? null;
  }
}

/** Builds the trusted service-role client from validated runtime configuration. */
export function createIngestionClient(env: Readonly<Record<string, string | undefined>> = process.env): IngestionClient {
  const config = loadIngestionConfig(env);
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Private tables live in the `ingestion` schema, which is never exposed to anon/authenticated roles. */
export function ingestionDb(client: IngestionClient) {
  return client.schema("ingestion");
}

export function throwIfError(context: string, error: PostgrestLikeError | null): void {
  if (error) throw new IngestionStorageError(context, error);
}

export const UNIQUE_VIOLATION = "23505";

/**
 * Confirms the Data API exposes the `ingestion` schema to the service role.
 * The schema must be listed in the Supabase API "Exposed schemas" setting (config.toml `[api] schemas`);
 * exposure for anon/authenticated is prevented by the revoked grants and RLS in the migration.
 */
export async function assertIngestionSchemaAccessible(client: IngestionClient): Promise<void> {
  const { error } = await ingestionDb(client).from("sources").select("id").limit(1);
  if (!error) return;
  if (error.code === "PGRST106" || error.code === "PGRST205" || /schema must be one of|not found/i.test(error.message)) {
    throw new IngestionStorageError(
      "Ingestion schema is not exposed to the Data API. Add `ingestion` to the exposed schemas for the service role",
      error,
    );
  }
  throw new IngestionStorageError("Ingestion schema check failed", error);
}
