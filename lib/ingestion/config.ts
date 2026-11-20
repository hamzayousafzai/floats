import { z } from "zod";

export const INGESTION_DEFAULTS = {
  centerLat: 35.2271,
  centerLng: -80.8431,
  radiusMiles: 35,
  horizonDays: 60,
  minVendorCount: 3,
  autoPublishScore: 90,
  reviewScore: 70,
  timezone: "America/New_York",
  publishMode: "shadow",
  httpTimeoutMs: 15000,
  maxResponseBytes: 2097152,
  maxConcurrency: 3,
  maxRedirects: 3,
  maxDiscoveryDepth: 2,
  maxDiscoveryPagesPerSource: 25,
  maxPagesPerSourcePerRun: 100,
  rawRetentionDays: 90,
  runRetentionDays: 365,
  userAgent: "FloatsEventDiscovery/1.0 (+https://findfloats.com)",
} as const;

export type PublishMode = "shadow" | "live";

export interface IngestionConfig {
  centerLat: number;
  centerLng: number;
  radiusMiles: number;
  horizonDays: number;
  minVendorCount: number;
  autoPublishScore: number;
  reviewScore: number;
  timezone: "America/New_York";
  publishMode: PublishMode;
  httpTimeoutMs: number;
  maxResponseBytes: number;
  maxConcurrency: number;
  maxRedirects: number;
  maxDiscoveryDepth: number;
  maxDiscoveryPagesPerSource: number;
  maxPagesPerSourcePerRun: number;
  rawRetentionDays: number;
  runRetentionDays: number;
  userAgent: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
}

/** Lists offending variable names and rule names only; never the supplied values. */
export class IngestionConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid ingestion configuration: ${issues.join("; ")}`);
    this.name = "IngestionConfigError";
    this.issues = issues;
  }
}

const decimal = (min: number, max: number) =>
  z
    .string()
    .regex(/^-?\d+(\.\d+)?$/, "must be a number")
    .transform(Number)
    .pipe(z.number().min(min, "out of range").max(max, "out of range"));

const integer = (min: number, max: number) =>
  z
    .string()
    .regex(/^-?\d+$/, "must be an integer")
    .transform(Number)
    .pipe(z.number().int().min(min, "out of range").max(max, "out of range"));

// Local Supabase runs over plain HTTP on loopback; everything else must be HTTPS.
function isAllowedSupabaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

const ENV_SCHEMA = z
  .object({
    INGESTION_CENTER_LAT: decimal(-90, 90),
    INGESTION_CENTER_LNG: decimal(-180, 180),
    INGESTION_RADIUS_MILES: decimal(1, 100),
    INGESTION_HORIZON_DAYS: integer(1, 365),
    INGESTION_MIN_VENDOR_COUNT: integer(3, 1000),
    INGESTION_AUTO_PUBLISH_SCORE: integer(70, 100),
    INGESTION_REVIEW_SCORE: integer(0, 89),
    INGESTION_TIMEZONE: z.literal("America/New_York", "must be America/New_York"),
    INGESTION_PUBLISH_MODE: z.enum(["shadow", "live"], "must be shadow or live"),
    INGESTION_HTTP_TIMEOUT_MS: integer(1000, 60000),
    INGESTION_MAX_RESPONSE_BYTES: integer(1024, 10485760),
    INGESTION_MAX_CONCURRENCY: integer(1, 10),
    INGESTION_USER_AGENT: z.string().min(1, "must not be empty").max(300, "too long"),
    NEXT_PUBLIC_SUPABASE_URL: z
      .string()
      .min(1, "is required")
      .refine(isAllowedSupabaseUrl, "must be an HTTPS URL without credentials"),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "is required"),
  })
  .superRefine((value, ctx) => {
    if (value.INGESTION_REVIEW_SCORE >= value.INGESTION_AUTO_PUBLISH_SCORE) {
      ctx.addIssue({
        code: "custom",
        path: ["INGESTION_REVIEW_SCORE"],
        message: "must be below INGESTION_AUTO_PUBLISH_SCORE",
      });
    }
  });

const D = INGESTION_DEFAULTS;
const ENV_DEFAULTS: Record<string, string | undefined> = {
  INGESTION_CENTER_LAT: String(D.centerLat),
  INGESTION_CENTER_LNG: String(D.centerLng),
  INGESTION_RADIUS_MILES: String(D.radiusMiles),
  INGESTION_HORIZON_DAYS: String(D.horizonDays),
  INGESTION_MIN_VENDOR_COUNT: String(D.minVendorCount),
  INGESTION_AUTO_PUBLISH_SCORE: String(D.autoPublishScore),
  INGESTION_REVIEW_SCORE: String(D.reviewScore),
  INGESTION_TIMEZONE: D.timezone,
  INGESTION_PUBLISH_MODE: D.publishMode,
  INGESTION_HTTP_TIMEOUT_MS: String(D.httpTimeoutMs),
  INGESTION_MAX_RESPONSE_BYTES: String(D.maxResponseBytes),
  INGESTION_MAX_CONCURRENCY: String(D.maxConcurrency),
  INGESTION_USER_AGENT: D.userAgent,
  NEXT_PUBLIC_SUPABASE_URL: undefined,
  SUPABASE_SERVICE_ROLE_KEY: undefined,
};

/** Reads and validates configuration at call time; unset or blank variables fall back to defaults. */
export function loadIngestionConfig(env: Readonly<Record<string, string | undefined>> = process.env): IngestionConfig {
  const raw: Record<string, string> = {};
  for (const [key, fallback] of Object.entries(ENV_DEFAULTS)) {
    const supplied = env[key]?.trim();
    raw[key] = supplied ? supplied : (fallback ?? "");
  }

  const parsed = ENV_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${String(issue.path[0] ?? "config")} ${issue.message}`);
    throw new IngestionConfigError(issues);
  }

  const v = parsed.data;
  return {
    centerLat: v.INGESTION_CENTER_LAT,
    centerLng: v.INGESTION_CENTER_LNG,
    radiusMiles: v.INGESTION_RADIUS_MILES,
    horizonDays: v.INGESTION_HORIZON_DAYS,
    minVendorCount: v.INGESTION_MIN_VENDOR_COUNT,
    autoPublishScore: v.INGESTION_AUTO_PUBLISH_SCORE,
    reviewScore: v.INGESTION_REVIEW_SCORE,
    timezone: v.INGESTION_TIMEZONE,
    publishMode: v.INGESTION_PUBLISH_MODE,
    httpTimeoutMs: v.INGESTION_HTTP_TIMEOUT_MS,
    maxResponseBytes: v.INGESTION_MAX_RESPONSE_BYTES,
    maxConcurrency: v.INGESTION_MAX_CONCURRENCY,
    maxRedirects: D.maxRedirects,
    maxDiscoveryDepth: D.maxDiscoveryDepth,
    maxDiscoveryPagesPerSource: D.maxDiscoveryPagesPerSource,
    maxPagesPerSourcePerRun: D.maxPagesPerSourcePerRun,
    rawRetentionDays: D.rawRetentionDays,
    runRetentionDays: D.runRetentionDays,
    userAgent: v.INGESTION_USER_AGENT,
    supabaseUrl: v.NEXT_PUBLIC_SUPABASE_URL,
    supabaseServiceRoleKey: v.SUPABASE_SERVICE_ROLE_KEY,
  };
}
