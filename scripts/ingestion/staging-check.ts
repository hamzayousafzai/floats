/**
 * Staging access check for the ingestion schema. Run it by hand, against an ISOLATED staging project only.
 *
 *   npm run ingest:staging-check
 *
 * It sends read-only table selects and one deliberately unauthorised function call through the Data API, to prove that
 * service_role can use the `ingestion` schema and that anon (and optionally an authenticated user) cannot. It writes nothing.
 *
 * Refuses to run unless the target is positively identified as the staging project (see assertIsolatedTarget). It has
 * never been run against a real project: the offline tests cover only these guards and the result classification.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { runCli, sanitizeForLog } from "@/lib/ingestion/log";

export const CONFIRMATION_VALUE = "staging-not-production";
/** The production project ref is hardcoded in package.json (db:types). It must never be a target here. */
export const KNOWN_PRODUCTION_PROJECT_REFS: readonly string[] = ["inxlsvowzpqvfulhbnou"];

export const INGESTION_TABLES = ["sources", "runs", "observations", "candidates", "candidate_sources", "source_discoveries", "reviews", "publication_audit"] as const;

type Env = Readonly<Record<string, string | undefined>>;

export interface Target {
  url: string;
  /** Project ref for hosted Supabase, or `local` for a local stack on a loopback address. */
  projectRef: string;
}

/**
 * Positive identification of an isolated target. Every condition must hold; anything else throws before any request is made:
 * - INGESTION_STAGING_CONFIRM equals the confirmation phrase,
 * - INGESTION_STAGING_PROJECT_REF is set and equals the ref in NEXT_PUBLIC_SUPABASE_URL (`https://<ref>.supabase.co`, or `local` for a loopback URL),
 * - neither the ref nor the URL contains a known production ref (built in, plus INGESTION_PRODUCTION_PROJECT_REFS).
 */
export function assertIsolatedTarget(env: Env): Target {
  if (env.INGESTION_STAGING_CONFIRM !== CONFIRMATION_VALUE) {
    throw new Error(`Refusing to run: set INGESTION_STAGING_CONFIRM=${CONFIRMATION_VALUE} to confirm the target is a staging project, not production`);
  }
  const rawUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const expectedRef = env.INGESTION_STAGING_PROJECT_REF?.trim().toLowerCase();
  if (!rawUrl) throw new Error("Refusing to run: NEXT_PUBLIC_SUPABASE_URL is not set");
  if (!expectedRef) throw new Error("Refusing to run: INGESTION_STAGING_PROJECT_REF is not set (name the staging project explicitly)");

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Refusing to run: NEXT_PUBLIC_SUPABASE_URL is not a valid URL");
  }
  if (parsed.username || parsed.password) throw new Error("Refusing to run: the URL must not contain credentials");

  const production = [...KNOWN_PRODUCTION_PROJECT_REFS, ...(env.INGESTION_PRODUCTION_PROJECT_REFS ?? "").split(",")]
    .map((ref) => ref.trim().toLowerCase())
    .filter(Boolean);
  const haystack = `${rawUrl} ${expectedRef}`.toLowerCase();
  if (production.some((ref) => haystack.includes(ref))) throw new Error("Refusing to run: the target matches a production project ref");

  const host = parsed.hostname.toLowerCase();
  let projectRef: string;
  if (parsed.protocol === "https:" && /^[a-z0-9]{20}\.supabase\.co$/.test(host)) {
    projectRef = host.split(".")[0];
  } else if (parsed.protocol === "http:" && (host === "127.0.0.1" || host === "localhost" || host === "[::1]")) {
    projectRef = "local";
  } else {
    throw new Error("Refusing to run: the URL must be https://<20-character-ref>.supabase.co or a loopback http URL for a local stack");
  }
  if (projectRef !== expectedRef) throw new Error("Refusing to run: INGESTION_STAGING_PROJECT_REF does not match the URL");
  return { url: parsed.origin, projectRef };
}

export interface CheckResult {
  name: string;
  status: "pass" | "fail" | "skipped";
  detail?: string;
}

interface QueryOutcome {
  data: unknown;
  error: { code?: string | null; message: string } | null;
}

/** An unprivileged role is denied when the call errors and returns no data. A successful response, even an empty one, is a failure. */
export function isDenied(outcome: QueryOutcome): boolean {
  return outcome.error !== null && (outcome.data === null || outcome.data === undefined);
}

export interface Roles {
  service: SupabaseClient;
  anon: SupabaseClient;
  authenticated?: SupabaseClient;
}

const UNAUTHORISED_CALL_ARGS = {
  p_candidate_id: "00000000-0000-4000-8000-000000000000",
  p_min_score: 90,
  p_center_lat: 0,
  p_center_lng: 0,
  p_radius_miles: 1,
  p_horizon_days: 1,
  p_manual: true,
};

export async function runAccessChecks(roles: Roles): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const record = (name: string, ok: boolean, detail?: string) => results.push({ name, status: ok ? "pass" : "fail", detail });

  for (const table of INGESTION_TABLES) {
    const outcome = (await roles.service.schema("ingestion").from(table).select("*").limit(1)) as QueryOutcome;
    record(`service_role can read ingestion.${table}`, outcome.error === null, outcome.error ? `${outcome.error.code ?? ""} ${sanitizeForLog(outcome.error.message)}`.trim() : undefined);
  }
  const links = (await roles.service.from("event_ingestion_links").select("*").limit(1)) as QueryOutcome;
  record("service_role can read public.event_ingestion_links", links.error === null, links.error ? sanitizeForLog(links.error.message) : undefined);

  const unprivileged: [string, SupabaseClient | undefined][] = [["anon", roles.anon], ["authenticated", roles.authenticated]];
  for (const [role, client] of unprivileged) {
    if (!client) {
      results.push({ name: `${role} is denied on the ingestion schema`, status: "skipped", detail: "no credential supplied for this role" });
      continue;
    }
    for (const table of INGESTION_TABLES) {
      const outcome = (await client.schema("ingestion").from(table).select("*").limit(1)) as QueryOutcome;
      record(`${role} is denied on ingestion.${table}`, isDenied(outcome), isDenied(outcome) ? undefined : "the request was not rejected");
    }
    const link = (await client.from("event_ingestion_links").select("*").limit(1)) as QueryOutcome;
    record(`${role} is denied on public.event_ingestion_links`, isDenied(link), isDenied(link) ? undefined : "the request was not rejected");
    const call = (await client.schema("ingestion").rpc("publish_candidate", UNAUTHORISED_CALL_ARGS)) as QueryOutcome;
    record(`${role} cannot execute ingestion.publish_candidate`, isDenied(call), isDenied(call) ? undefined : "the call was not rejected");
  }
  return results;
}

export function summarise(results: CheckResult[]): { failed: number; lines: string[] } {
  const lines = results.map((r) => `${r.status.toUpperCase().padEnd(7)} ${r.name}${r.detail ? ` (${r.detail})` : ""}`);
  return { failed: results.filter((r) => r.status === "fail").length, lines };
}

export async function main(env: Env = process.env): Promise<void> {
  const target = assertIsolatedTarget(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!serviceKey || !anonKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_ANON_KEY (both from the STAGING project) are required");

  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const jwt = env.INGESTION_STAGING_AUTHENTICATED_JWT;
  const roles: Roles = {
    service: createClient(target.url, serviceKey, options),
    anon: createClient(target.url, anonKey, options),
    authenticated: jwt ? createClient(target.url, anonKey, { ...options, global: { headers: { Authorization: `Bearer ${jwt}` } } }) : undefined,
  };
  console.log(`[ingest:staging-check] target ${target.projectRef} (read-only checks)`);
  const { failed, lines } = summarise(await runAccessChecks(roles));
  for (const line of lines) console.log(line);
  console.log(`[ingest:staging-check] ${failed === 0 ? "all checks passed" : `${failed} check(s) FAILED`}`);
  if (failed > 0) process.exitCode = 1;
}

if (require.main === module) {
  void runCli("ingest:staging-check", () => main());
}
