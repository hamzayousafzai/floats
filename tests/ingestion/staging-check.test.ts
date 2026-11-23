import type { SupabaseClient } from "@supabase/supabase-js";
import { CONFIRMATION_VALUE, INGESTION_TABLES, assertIsolatedTarget, isDenied, runAccessChecks, summarise, main } from "@/scripts/ingestion/staging-check";

/** Offline tests only: they exercise the guards and the result classification with fake clients. No network, no credentials. */
const REF = "abcdefghijklmnopqrst";
const good = { INGESTION_STAGING_CONFIRM: CONFIRMATION_VALUE, INGESTION_STAGING_PROJECT_REF: REF, NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co` };

describe("assertIsolatedTarget", () => {
  it("accepts an explicitly confirmed hosted staging project and a loopback local stack", () => {
    expect(assertIsolatedTarget(good)).toEqual({ url: `https://${REF}.supabase.co`, projectRef: REF });
    expect(assertIsolatedTarget({ ...good, INGESTION_STAGING_PROJECT_REF: "local", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })).toEqual({ url: "http://127.0.0.1:54321", projectRef: "local" });
  });

  it.each([
    ["no confirmation", { ...good, INGESTION_STAGING_CONFIRM: undefined }, /INGESTION_STAGING_CONFIRM/],
    ["a wrong confirmation", { ...good, INGESTION_STAGING_CONFIRM: "yes" }, /INGESTION_STAGING_CONFIRM/],
    ["no URL", { ...good, NEXT_PUBLIC_SUPABASE_URL: undefined }, /NEXT_PUBLIC_SUPABASE_URL is not set/],
    ["no expected ref", { ...good, INGESTION_STAGING_PROJECT_REF: undefined }, /INGESTION_STAGING_PROJECT_REF is not set/],
    ["a ref that does not match the URL", { ...good, INGESTION_STAGING_PROJECT_REF: "zzzzzzzzzzzzzzzzzzzz" }, /does not match/],
    ["the production project", { ...good, INGESTION_STAGING_PROJECT_REF: "inxlsvowzpqvfulhbnou", NEXT_PUBLIC_SUPABASE_URL: "https://inxlsvowzpqvfulhbnou.supabase.co" }, /production/],
    ["the production ref in another case or position", { ...good, NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co/?x=INXLSVOWZPQVFULHBNOU` }, /production/],
    ["an operator-listed production ref", { ...good, INGESTION_PRODUCTION_PROJECT_REFS: `other, ${REF}` }, /production/],
    ["an arbitrary host", { ...good, NEXT_PUBLIC_SUPABASE_URL: "https://db.example.org" }, /supabase\.co/],
    ["plain http on a hosted project", { ...good, NEXT_PUBLIC_SUPABASE_URL: `http://${REF}.supabase.co` }, /supabase\.co/],
    ["URL credentials", { ...good, NEXT_PUBLIC_SUPABASE_URL: `https://user:pw@${REF}.supabase.co` }, /credentials/],
    ["an invalid URL", { ...good, NEXT_PUBLIC_SUPABASE_URL: "not a url" }, /valid URL/],
  ])("refuses %s", (_name, env, message) => {
    expect(() => assertIsolatedTarget(env as Record<string, string | undefined>)).toThrow(message);
  });

  it("main refuses before creating any client", async () => {
    await expect(main({ ...good, INGESTION_STAGING_CONFIRM: undefined })).rejects.toThrow(/Refusing to run/);
    await expect(main({ ...good, NEXT_PUBLIC_SUPABASE_URL: "https://inxlsvowzpqvfulhbnou.supabase.co", INGESTION_STAGING_PROJECT_REF: "inxlsvowzpqvfulhbnou" })).rejects.toThrow(/production/);
    await expect(main(good)).rejects.toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe("access checks", () => {
  const denied = { data: null, error: { code: "42501", message: "permission denied" } };
  const allowed = { data: [], error: null };

  /** A fake client whose every table read and function call returns `outcome`. */
  const fake = (outcome: { data: unknown; error: unknown }) => {
    const reads: string[] = [];
    const table = (schema: string) => (name: string) => ({ select: () => ({ limit: () => { reads.push(`${schema}.${name}`); return Promise.resolve(outcome); } }) });
    const client = {
      schema: (schema: string) => ({ from: table(schema), rpc: () => Promise.resolve(outcome) }),
      from: table("public"),
    };
    return { client: client as unknown as SupabaseClient, reads };
  };

  it("classifies denial: an error with no data passes, a success (even empty) fails", () => {
    expect(isDenied(denied)).toBe(true);
    expect(isDenied(allowed)).toBe(false);
    expect(isDenied({ data: [{ id: 1 }], error: { message: "x" } })).toBe(false);
  });

  it("passes when service_role reads everything and anon is rejected everywhere", async () => {
    const results = await runAccessChecks({ service: fake(allowed).client, anon: fake(denied).client });
    const { failed } = summarise(results);
    expect(failed).toBe(0);
    expect(results.filter((r) => r.status === "pass")).toHaveLength(INGESTION_TABLES.length + 1 + INGESTION_TABLES.length + 2);
    expect(results.find((r) => r.name.startsWith("authenticated"))).toMatchObject({ status: "skipped" });
  });

  it("fails when anon can read a table or when the schema is not exposed to service_role", async () => {
    const leaky = await runAccessChecks({ service: fake(allowed).client, anon: fake(allowed).client });
    expect(summarise(leaky).failed).toBe(INGESTION_TABLES.length + 2);
    const notExposed = await runAccessChecks({ service: fake({ data: null, error: { code: "PGRST106", message: "Invalid schema: ingestion" } }).client, anon: fake(denied).client });
    expect(notExposed.filter((r) => r.status === "fail").every((r) => r.name.startsWith("service_role"))).toBe(true);
    expect(summarise(notExposed).failed).toBeGreaterThan(0);
  });

  it("only reads: it never calls a write method", async () => {
    const { client, reads } = fake(allowed);
    expect(Object.keys((client as unknown as { schema: (s: string) => { from: (t: string) => object } }).schema("ingestion").from("sources"))).toEqual(["select"]);
    await runAccessChecks({ service: client, anon: fake(denied).client });
    expect(reads.length).toBeGreaterThan(0);
  });
});
