/**
 * @jest-environment node
 */
import { describe, it, expect } from "@jest/globals";
import { INGESTION_DEFAULTS, IngestionConfigError, loadIngestionConfig } from "@/lib/ingestion/config";
import { sanitizeForLog } from "@/lib/ingestion/log";

const SECRET = "service-role-secret-value-123456";
type Env = Record<string, string | undefined>;
const BASE_ENV: Env = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project.example.co",
  SUPABASE_SERVICE_ROLE_KEY: SECRET,
};

function issuesFor(env: Env): string[] {
  try {
    loadIngestionConfig(env);
  } catch (error) {
    if (error instanceof IngestionConfigError) return error.issues;
    throw error;
  }
  return [];
}

describe("loadIngestionConfig", () => {
  it("applies spec defaults, including shadow mode", () => {
    const config = loadIngestionConfig(BASE_ENV);
    expect(config).toMatchObject({
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
      maxRedirects: INGESTION_DEFAULTS.maxRedirects,
      userAgent: INGESTION_DEFAULTS.userAgent,
      supabaseUrl: "https://project.example.co",
    });
  });

  it("reads overrides and treats blank values as unset", () => {
    const config = loadIngestionConfig({
      ...BASE_ENV,
      INGESTION_RADIUS_MILES: "12.5",
      INGESTION_HORIZON_DAYS: "30",
      INGESTION_PUBLISH_MODE: "live",
      INGESTION_MAX_CONCURRENCY: "  ",
    });
    expect(config.radiusMiles).toBe(12.5);
    expect(config.horizonDays).toBe(30);
    expect(config.publishMode).toBe("live");
    expect(config.maxConcurrency).toBe(3);
  });

  it("is evaluated at call time, not import time", () => {
    expect(loadIngestionConfig({ ...BASE_ENV, INGESTION_HORIZON_DAYS: "10" }).horizonDays).toBe(10);
    expect(loadIngestionConfig({ ...BASE_ENV, INGESTION_HORIZON_DAYS: "20" }).horizonDays).toBe(20);
  });

  it.each([
    ["INGESTION_CENTER_LAT", "91"],
    ["INGESTION_CENTER_LNG", "-181"],
    ["INGESTION_RADIUS_MILES", "0"],
    ["INGESTION_RADIUS_MILES", "101"],
    ["INGESTION_HORIZON_DAYS", "366"],
    ["INGESTION_HORIZON_DAYS", "1.5"],
    ["INGESTION_MIN_VENDOR_COUNT", "2"],
    ["INGESTION_AUTO_PUBLISH_SCORE", "69"],
    ["INGESTION_REVIEW_SCORE", "90"],
    ["INGESTION_HTTP_TIMEOUT_MS", "999"],
    ["INGESTION_MAX_RESPONSE_BYTES", "10485761"],
    ["INGESTION_MAX_CONCURRENCY", "11"],
    ["INGESTION_PUBLISH_MODE", "auto"],
    ["INGESTION_TIMEZONE", "UTC"],
    ["INGESTION_RADIUS_MILES", "abc"],
    ["INGESTION_RADIUS_MILES", "0x10"],
  ])("rejects %s=%s", (key, value) => {
    const issues = issuesFor({ ...BASE_ENV, [key]: value });
    expect(issues.some((issue) => issue.startsWith(key))).toBe(true);
  });

  it("requires review score below the auto-publish score", () => {
    const issues = issuesFor({
      ...BASE_ENV,
      INGESTION_AUTO_PUBLISH_SCORE: "75",
      INGESTION_REVIEW_SCORE: "80",
    });
    expect(issues).toEqual(["INGESTION_REVIEW_SCORE must be below INGESTION_AUTO_PUBLISH_SCORE"]);
    expect(issuesFor({ ...BASE_ENV, INGESTION_AUTO_PUBLISH_SCORE: "75", INGESTION_REVIEW_SCORE: "74" })).toEqual([]);
  });

  it("requires Supabase credentials", () => {
    const issues = issuesFor({});
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("NEXT_PUBLIC_SUPABASE_URL"),
        expect.stringContaining("SUPABASE_SERVICE_ROLE_KEY"),
      ]),
    );
  });

  it("accepts HTTP only for loopback Supabase and rejects embedded credentials", () => {
    expect(issuesFor({ ...BASE_ENV, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })).toEqual([]);
    expect(issuesFor({ ...BASE_ENV, NEXT_PUBLIC_SUPABASE_URL: "http://example.com" })).not.toEqual([]);
    expect(issuesFor({ ...BASE_ENV, NEXT_PUBLIC_SUPABASE_URL: "https://user:pw@example.com" })).not.toEqual([]);
    expect(issuesFor({ ...BASE_ENV, NEXT_PUBLIC_SUPABASE_URL: "not a url" })).not.toEqual([]);
  });

  it("never leaks supplied values or the service-role key in errors", () => {
    let message = "";
    try {
      loadIngestionConfig({
        ...BASE_ENV,
        INGESTION_RADIUS_MILES: "SENSITIVE-INPUT",
        NEXT_PUBLIC_SUPABASE_URL: `https://user:${SECRET}@example.com`,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("INGESTION_RADIUS_MILES");
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain("SENSITIVE-INPUT");
  });
});

describe("sanitizeForLog", () => {
  it("redacts env secrets, JWTs, bearer tokens and URL credentials", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2lnbmF0dXJlMTIzNDU2";
    const text = sanitizeForLog(
      new Error(`key ${SECRET} jwt ${jwt} Bearer abcdefghijkl https://u:p@host.example/x`),
      { SUPABASE_SERVICE_ROLE_KEY: SECRET },
    );
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(jwt);
    expect(text).not.toContain("abcdefghijkl");
    expect(text).not.toContain("u:p@");
  });

  it("bounds length and handles non-errors", () => {
    expect(sanitizeForLog("x".repeat(2000)).length).toBeLessThan(600);
    expect(sanitizeForLog({ not: "an error" })).toBe("Unknown error");
  });
});
