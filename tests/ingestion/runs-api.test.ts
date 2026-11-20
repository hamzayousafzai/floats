/**
 * @jest-environment node
 */
import { MemoryDb } from "./helpers/memory-db";
import * as runsRoute from "@/app/api/admin/ingestion/runs/route";

type Row = Record<string, unknown>;

const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const mockState = { user: null as { id: string } | null, admins: [] as string[], db: new MemoryDb(), created: 0 };

jest.mock("@/lib/supabase/server", () => ({
  createSupabaseServer: () => ({
    auth: { getUser: async () => ({ data: { user: mockState.user }, error: null }) },
    from: () => ({
      select: () => ({
        eq: (_column: string, value: string) => ({
          maybeSingle: async () => ({ data: mockState.admins.includes(value) ? { user_id: value } : null, error: null }),
        }),
      }),
    }),
  }),
}));
jest.mock("@/lib/ingestion/storage/client", () => ({
  ...jest.requireActual("@/lib/ingestion/storage/client"),
  createIngestionClient: () => {
    mockState.created += 1;
    return mockState.db.client();
  },
}));

const BASE = "http://localhost/api/admin/ingestion/runs";
const get = (query = "") => runsRoute.GET(new Request(`${BASE}${query}`), undefined);
const json = async (res: Response) => (await res.json()) as Record<string, unknown> & { error?: { code: string } };

function seedRuns(count: number, over: Row = {}) {
  for (let i = 0; i < count; i += 1) {
    mockState.db.seed("ingestion.runs", [
      { run_type: "collection", status: "succeeded", started_at: new Date(Date.UTC(2026, 11, 1, 9, i)).toISOString(), finished_at: new Date(Date.UTC(2026, 11, 1, 9, i, 30)).toISOString(), sources_attempted: 3, sources_succeeded: 3, observations_found: 18, candidates_created: 12, candidates_published: 0, candidates_review: 4, ...over },
    ]);
  }
}

beforeEach(() => {
  mockState.user = { id: ADMIN_ID };
  mockState.admins = [ADMIN_ID];
  mockState.db = new MemoryDb();
  mockState.created = 0;
});

describe("GET /runs", () => {
  it("rejects anonymous callers and non-admins before touching the database", async () => {
    mockState.user = null;
    expect((await get()).status).toBe(401);
    mockState.user = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
    expect((await get()).status).toBe(403);
    expect(mockState.created).toBe(0);
  });

  it("returns the spec shape, newest first, defaulting to 25 rows", async () => {
    seedRuns(30);
    const body = await json(await get());
    expect(body.ok).toBe(true);
    const data = body.data as Row[];
    expect(data).toHaveLength(25);
    expect(Object.keys(data[0]).sort()).toEqual(
      ["candidates_created", "candidates_published", "candidates_review", "error_summary", "finished_at", "id", "observations_found", "run_type", "sources_attempted", "sources_succeeded", "started_at", "status"].sort(),
    );
    const starts = data.map((r) => r.started_at as string);
    expect([...starts].sort().reverse()).toEqual(starts);
  });

  it("honours limit within 1..100 and rejects anything else", async () => {
    seedRuns(5);
    expect(((await json(await get("?limit=2"))).data as Row[]).length).toBe(2);
    for (const bad of ["?limit=0", "?limit=101", "?limit=x", "?offset=1", "?limit=1.5"]) {
      const res = await get(bad);
      expect(res.status).toBe(400);
      expect((await json(res)).error?.code).toBe("VALIDATION_ERROR");
    }
  });

  it("sanitizes error summaries and omits run metadata", async () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlLXZhbHVlLTEyMw";
    seedRuns(1, { status: "failed", error_summary: `fetch failed with Bearer abcdefghijklmnop and ${jwt} at postgres://user:pass@db.example.test/x`, metadata: { rawHtml: "<html>secret</html>", token: "sb_secret_abcdefghijkl" } });
    const res = await get();
    const text = await res.text();
    expect(text).not.toContain(jwt);
    expect(text).not.toContain("abcdefghijklmnop");
    expect(text).not.toContain("user:pass");
    expect(text).not.toMatch(/rawHtml|sb_secret|metadata/);
    expect(JSON.parse(text).data[0].error_summary).toMatch(/\[REDACTED/);
  });

  it("returns an empty list when there are no runs", async () => {
    expect(await json(await get())).toEqual({ ok: true, data: [] });
  });
});
