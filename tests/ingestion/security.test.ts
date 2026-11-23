/**
 * @jest-environment node
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sanitizeForLog } from "@/lib/ingestion/log";
import { UnsafeUrlError, validatePublicUrl } from "@/lib/ingestion/security/url-validation";
import { DEFAULT_RUN_DEADLINE_MS } from "@/lib/ingestion/workers/daily-collection";
import { DEFAULT_VERIFY_DEADLINE_MS } from "@/lib/ingestion/workers/verify-worker";

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function walk(dir: string, filter: (file: string) => boolean, out: string[] = []): string[] {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) return out;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(rel, filter, out);
    } else if (filter(rel)) out.push(rel.replace(/\\/g, "/"));
  }
  return out;
}

const mockState = { user: null as { id: string } | null, created: 0 };
jest.mock("@/lib/supabase/server", () => ({
  createSupabaseServer: () => ({
    auth: { getUser: async () => ({ data: { user: mockState.user }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  }),
}));
jest.mock("@/lib/ingestion/storage/client", () => ({
  ...jest.requireActual("@/lib/ingestion/storage/client"),
  createIngestionClient: () => {
    mockState.created += 1;
    throw new Error("service-role client must not be created for unauthorized callers");
  },
}));

describe("admin API: every route handler is admin-only", () => {
  const routeFiles = walk("app/api/admin/ingestion", (f) => /route\.ts$/.test(f));
  const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

  it("finds the expected route files", () => {
    expect(routeFiles.length).toBeGreaterThanOrEqual(6);
  });

  it.each(routeFiles)("%s rejects anonymous and non-admin callers without creating a service-role client", async (file) => {
    const mod = (await import(`@/${file.replace(/\.ts$/, "")}`)) as Record<string, unknown>;
    const handlers = METHODS.filter((m) => typeof mod[m] === "function");
    expect(handlers.length).toBeGreaterThan(0);
    expect(handlers.filter((m) => m === "PUT" || m === "DELETE")).toEqual([]);
    const ctx = { params: Promise.resolve({ id: randomUUID() }) };
    for (const method of handlers) {
      for (const user of [null, { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }]) {
        mockState.user = user;
        const request = new Request("http://localhost/api/admin/ingestion/x", { method, headers: { "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" });
        const response = await (mod[method] as (r: Request, c: unknown) => Promise<Response>)(request, ctx);
        expect(response.status).toBe(user ? 403 : 401);
      }
    }
    expect(mockState.created).toBe(0);
  });

  it("returns sanitized, generic error bodies", async () => {
    const mod = (await import("@/app/api/admin/ingestion/candidates/route")) as unknown as Record<string, (r: Request, c?: unknown) => Promise<Response>>;
    mockState.user = null;
    const body = JSON.stringify(await (await mod.GET(new Request("http://localhost/api/admin/ingestion/candidates"))).json());
    expect(body).not.toMatch(/stack|at .*\(|SUPABASE|service/i);
  });
});

describe("service-role isolation", () => {
  const sourceFiles = [...walk("app", (f) => /\.(ts|tsx)$/.test(f)), ...walk("components", (f) => /\.(ts|tsx)$/.test(f)), ...walk("lib", (f) => /\.(ts|tsx)$/.test(f))];

  it("never exposes the service-role key through a NEXT_PUBLIC variable", () => {
    const files = [...sourceFiles, ...walk("scripts", () => true), ...walk(".github", () => true), ".env.example", "next.config.ts"];
    for (const file of files) {
      expect(`${file}: ${/NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE/.test(read(file))}`).toBe(`${file}: false`);
    }
  });

  it("references the service-role key only in configuration, log redaction and the pre-existing admin client", () => {
    const referencing = sourceFiles.filter((f) => read(f).includes("SUPABASE_SERVICE_ROLE_KEY")).sort();
    expect(referencing).toEqual(["lib/ingestion/config.ts", "lib/ingestion/log.ts", "lib/supabase/admin.ts"]);
  });

  it("client components never import the ingestion backend (storage, config, workers, publication)", () => {
    const clientFiles = sourceFiles.filter((f) => /^\s*["']use client["']/m.test(read(f).split("\n").slice(0, 5).join("\n")));
    expect(clientFiles.length).toBeGreaterThan(0);
    for (const file of clientFiles) {
      const text = read(file);
      expect(`${file}: ${/@\/lib\/ingestion\/(storage|config|workers|publication|security\/(require-admin|safe-fetch)|adapters)/.test(text)}`).toBe(`${file}: false`);
      expect(`${file}: ${/lib\/supabase\/admin|createIngestionClient/.test(text)}`).toBe(`${file}: false`);
    }
  });

  it("ingestion UI never renders raw HTML", () => {
    const ui = [...walk("components/ingestion", () => true), ...walk("app/admin/ingestion", () => true)];
    expect(ui.length).toBeGreaterThan(0);
    for (const file of ui) expect(`${file}: ${/dangerouslySetInnerHTML|innerHTML\s*=/.test(read(file))}`).toBe(`${file}: false`);
  });

  it("does not ship a real credential in .env.example", () => {
    const example = read(".env.example");
    expect(example).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
    expect(example).not.toMatch(/^SUPABASE_SERVICE_ROLE_KEY=\S{20,}/m);
    expect(example).toMatch(/INGESTION_PUBLISH_MODE=shadow/);
  });
});

describe("scheduled workflows", () => {
  const files = [".github/workflows/ingestion-daily.yml", ".github/workflows/ingestion-discovery.yml"];
  it.each(files)("%s is scheduled-only, read-only, shadow-mode and uses only the two named secrets", (file) => {
    const text = read(file).replace(/\r\n/g, "\n");
    const triggers = [...(/^on:\n((?:[ ]{2,}.*\n)+)/m.exec(text)?.[1] ?? "").matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]).sort();
    expect(triggers).toEqual(["schedule", "workflow_dispatch"]);
    expect(/^permissions:\n {2}contents: read\n(?! {2})/m.test(text)).toBe(true);
    expect(text).toMatch(/^ {6}INGESTION_PUBLISH_MODE: shadow$/m);
    expect(Number(/timeout-minutes: (\d+)/.exec(text)?.[1])).toBeLessThanOrEqual(60);
    const secrets = [...text.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]).sort();
    expect([...new Set(secrets)]).toEqual(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
    expect(text).not.toMatch(/pull_request|echo\s+.*secrets|set -x/);
  });

  it.each(files)("%s pins every third-party action to a full commit SHA and installs no browser", (file) => {
    const text = read(file);
    const uses = [...text.matchAll(/^\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const ref of uses) expect(`${ref}: ${/@[0-9a-f]{40}$/.test(ref)}`).toBe(`${ref}: true`);
    expect(text).not.toMatch(/playwright\s+install/);
  });

  it("the daily workflow runs verification after collection, even when collection fails", () => {
    const text = read(".github/workflows/ingestion-daily.yml").replace(/\r\n/g, "\n");
    const collect = text.indexOf("npm run ingest:daily");
    const verify = text.indexOf("npm run ingest:verify");
    expect(collect).toBeGreaterThan(0);
    expect(verify).toBeGreaterThan(collect);
    expect(text).toMatch(/if: \$\{\{ !cancelled\(\) \}\}\n(?:\s+timeout-minutes: \d+\n)?\s+run: npm run ingest:verify/);
    expect(text).not.toMatch(/continue-on-error/);
  });

  it("the daily job timeout covers the collection and verification worker deadlines separately", () => {
    const text = read(".github/workflows/ingestion-daily.yml").replace(/\r\n/g, "\n");
    const minutes = (re: RegExp) => Number(re.exec(text)?.[1]);
    const job = minutes(/^ {4}timeout-minutes: (\d+)$/m);
    const collectStep = minutes(/- name: Collect\n\s+timeout-minutes: (\d+)/);
    const verifyStep = minutes(/- name: Verify\n\s+if: [^\n]+\n\s+timeout-minutes: (\d+)/);
    const collectDeadline = DEFAULT_RUN_DEADLINE_MS / 60_000;
    const verifyDeadline = DEFAULT_VERIFY_DEADLINE_MS / 60_000;
    expect(verifyDeadline).toBeLessThan(collectDeadline);
    expect(collectStep).toBeGreaterThan(collectDeadline);
    expect(verifyStep).toBeGreaterThan(verifyDeadline);
    const INSTALL_ALLOWANCE = 5;
    expect(job).toBeGreaterThanOrEqual(INSTALL_ALLOWANCE + collectStep + verifyStep);
  });

  it("the daily workflow serializes runs and never cancels one in progress", () => {
    const text = read(".github/workflows/ingestion-daily.yml").replace(/\r\n/g, "\n");
    expect(text).toMatch(/^concurrency:\n {2}group: floats-ingestion-daily\n {2}cancel-in-progress: false$/m);
    expect(text.match(/^ {2}[a-z]+:$/gm)?.filter((j) => !/permissions|concurrency|schedule|jobs/.test(j))).toEqual(["  ingest:"]);
  });
});

describe("browser rendering is disabled until network containment exists", () => {
  it.each(["scripts/ingestion/collect.ts", "scripts/ingestion/verify.ts", "scripts/ingestion/discover.ts", "scripts/ingestion/replay.ts"])("%s never enables the Playwright adapter", (file) => {
    expect(read(file)).not.toMatch(/navigationTimeoutMs|createPlaywrightAdapter|from "playwright"/);
  });

  it("only the adapter module itself imports playwright", () => {
    const importers = walk("lib", (f) => /\.ts$/.test(f)).filter((f) => /import\("playwright"\)|from "playwright"/.test(read(f)));
    expect(importers).toEqual(["lib/ingestion/adapters/playwright.ts"]);
  });
});

describe("migration 20261121000100: event deletion policy", () => {
  const sql = read("supabase/migrations/20261121000100_ingestion_event_deletion_policy.sql");
  it("detaches events without deleting evidence and keeps the trigger function private", () => {
    expect(sql).toMatch(/foreign key \(published_event_id\) references public\.events\(id\) on delete set null/);
    expect(sql).toMatch(/foreign key \(event_id\) references public\.events\(id\) on delete set null/);
    expect(sql).not.toMatch(/on delete cascade/i);
    expect(sql).toMatch(/security definer set search_path = ''/);
    expect(sql).toMatch(/revoke all on function ingestion\.record_event_removal\(\) from public, anon, authenticated/);
    expect(sql).not.toMatch(/\bgrant\b/i);
  });
});

describe("migration 20261122000100: shared pipeline run lock", () => {
  const sql = read("supabase/migrations/20261122000100_ingestion_pipeline_run_lock.sql").replace(/--.*$/gm, "");
  it("allows one running pipeline run across collection, verification and replay, and not discovery", () => {
    expect(sql).toMatch(/create unique index if not exists uq_runs_one_running_pipeline\s+on ingestion\.runs \(\(true\)\)\s+where status = 'running' and run_type in \('collection', 'verification', 'replay'\)/);
    expect(sql).not.toMatch(/discovery/);
  });
  it("only closes overlapping runs and changes no privileges or data definitions", () => {
    expect(sql).toMatch(/set status = 'failed'/);
    expect(sql).not.toMatch(/\b(grant|revoke|drop|delete|truncate|alter table)\b/i);
  });
});

describe("migrations: privileges, RLS and definer functions", () => {
  const sql = walk("supabase/migrations", (f) => /automated_event_ingestion|ingestion_updates/.test(f)).map(read).join("\n");

  it("enables row level security on every ingestion table and the link table", () => {
    const tables = [...sql.matchAll(/create table (ingestion\.\w+|public\.event_ingestion_links)\b/g)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThanOrEqual(9);
    for (const table of tables) expect(sql).toMatch(new RegExp(`alter table ${table.replace(".", "\\.")} enable row level security`));
  });

  it("grants nothing to anon, authenticated or public", () => {
    expect(sql).not.toMatch(/grant\s+[^;]*\bto\s+[^;]*\b(anon|authenticated|public)\b/i);
    expect(sql).toMatch(/revoke all on schema ingestion from public, anon, authenticated/);
  });

  it("pins search_path on every SECURITY DEFINER function and revokes public execute", () => {
    const definers = [...sql.matchAll(/create or replace function (ingestion\.\w+)\(([\s\S]*?)\)\s*returns[^;]*?security definer([^$]*?)(?=\bas \$|\bas\b\s*\$)/gi)];
    expect(definers.length).toBeGreaterThanOrEqual(3);
    for (const match of definers) {
      expect(`${match[1]}: ${/set search_path = ''/.test(match[0])}`).toBe(`${match[1]}: true`);
      expect(sql).toMatch(new RegExp(`revoke all on function ${match[1].replace(".", "\\.")}`));
      expect(sql).toMatch(new RegExp(`grant execute on function ${match[1].replace(".", "\\.")}[\\s\\S]*?to service_role`));
    }
  });
});

describe("SSRF guard", () => {
  const unsafe = [
    "http://localhost/",
    "http://127.0.0.1/",
    "http://127.1/",
    "http://0.0.0.0/",
    "http://2130706433/",
    "http://0x7f.0.0.1/",
    "http://017700000001/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[fe80::1]/",
    "http://[fd00::1]/",
    "http://10.0.0.1/",
    "http://172.16.5.5/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://100.64.0.1/",
    "http://metadata.google.internal/",
    "http://printer.local/",
    "http://intranet/",
    "https://user:password@example.org/",
    "file:///etc/passwd",
    "ftp://example.org/",
    "gopher://example.org/",
    "javascript:alert(1)",
    "data:text/html,hi",
  ];
  it.each(unsafe)("rejects %s", (url) => {
    expect(() => validatePublicUrl(url)).toThrow(UnsafeUrlError);
  });
  it("accepts an ordinary public https URL", () => {
    expect(validatePublicUrl("https://example.org/events?page=2").hostname).toBe("example.org");
  });
});

describe("log redaction", () => {
  it("removes credentials from anything that could be printed", () => {
    const key = "super-secret-service-role-value";
    const text = sanitizeForLog(new Error(`fail ${key} Bearer abcdefghijklmnop https://user:pw@db.example.org/x eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.abcdefghijkl sbp_0123456789abcdef`), { SUPABASE_SERVICE_ROLE_KEY: key });
    expect(text).not.toMatch(/super-secret|abcdefghijklmnop|user:pw|eyJhbGci|sbp_0123/);
  });
  it("bounds length and does not echo non-string, non-error values", () => {
    expect(sanitizeForLog("x".repeat(5000)).length).toBeLessThanOrEqual(503);
    expect(sanitizeForLog({ secret: "value" })).toBe("Unknown error");
  });
});
