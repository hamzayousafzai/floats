/**
 * @jest-environment node
 */
import { randomUUID } from "node:crypto";
import { MemoryDb } from "./helpers/memory-db";
import * as listRoute from "@/app/api/admin/ingestion/sources/route";
import * as sourceRoute from "@/app/api/admin/ingestion/sources/[id]/route";
import { AUDIT_ENTRY_LIMIT, TRUST_REQUIREMENTS } from "@/lib/ingestion/review/source-trust";

type Row = Record<string, unknown>;

const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAIN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

const BASE = "http://localhost/api/admin/ingestion/sources";
const idRoute = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (id: string, body: unknown) =>
  sourceRoute.PATCH(new Request(`${BASE}/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }), idRoute(id));
const json = async (res: Response) => (await res.json()) as Record<string, unknown> & { error?: { code: string; message: string } };

function seedSource(over: Row = {}): Row {
  return mockState.db.seed("ingestion.sources", [
    { name: "Example Organizer", base_url: `https://example.org/${randomUUID()}`, source_type: "organizer", adapter: "html", trust_state: "probation", enabled: true, successful_runs: 3, ...over },
  ])[0];
}

/** Seeds `count` eligible candidates for the source, each with one administrator approval. */
function seedApproved(sourceId: unknown, count: number, over: Row = {}): Row[] {
  const out: Row[] = [];
  for (let i = 0; i < count; i += 1) {
    const [candidate] = mockState.db.seed("ingestion.candidates", [
      { primary_source_id: sourceId, canonical_key: randomUUID(), source_url: "https://example.org/e", title: `Approved Market ${i}`, status: "approved", is_market: true, vendor_verified: true, location_verified: true, cancelled: false, ...over },
    ]);
    mockState.db.seed("ingestion.reviews", [{ candidate_id: candidate.id, reviewer_id: ADMIN_ID, decision: "approve", reason: "Verified" }]);
    out.push(candidate);
  }
  return out;
}

const sourceRow = (id: unknown) => mockState.db.rows("ingestion.sources").find((r) => r.id === id) as Row;
const audit = (id: unknown) => ((sourceRow(id).configuration as Row).audit ?? []) as Row[];

beforeEach(() => {
  mockState.user = { id: ADMIN_ID };
  mockState.admins = [ADMIN_ID];
  mockState.db = new MemoryDb();
  mockState.created = 0;
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("source routes: authorization", () => {
  const calls: [string, () => Promise<Response>][] = [
    ["GET list", () => listRoute.GET(new Request(BASE), undefined)],
    ["PATCH", () => patch(randomUUID(), { trust_state: "trusted" })],
  ];
  it.each(calls)("%s rejects anonymous callers before touching the database", async (_n, call) => {
    mockState.user = null;
    const res = await call();
    expect(res.status).toBe(401);
    expect(mockState.created).toBe(0);
  });
  it.each(calls)("%s rejects non-admins before touching the database", async (_n, call) => {
    mockState.user = { id: PLAIN_ID };
    const res = await call();
    expect(res.status).toBe(403);
    expect(mockState.created).toBe(0);
  });
});

describe("GET /sources", () => {
  it("returns the spec shape and never exposes configuration or audit data", async () => {
    const s = seedSource({ trust_state: "probation", configuration: { audit: [{ admin_id: ADMIN_ID }], secret: "x" }, successful_runs: 0 });
    const body = await json(await listRoute.GET(new Request(BASE), undefined));
    expect(body.ok).toBe(true);
    const [item] = body.data as Row[];
    expect(item).toMatchObject({ id: s.id, name: "Example Organizer", source_type: "organizer", adapter: "html", trust_state: "probation", enabled: true, valid_events: 0, rejected_events: 0, successful_runs: 0, failed_runs: 0, last_success_at: null });
    expect(JSON.stringify(item)).not.toMatch(/audit|secret|configuration/);
  });

  it("never promotes by itself, however strong the evidence", async () => {
    const s = seedSource({ successful_runs: 50 });
    seedApproved(s.id, 20);
    await listRoute.GET(new Request(BASE), undefined);
    expect(sourceRow(s.id).trust_state).toBe("probation");
  });
});

describe("PATCH /sources/{id}: validation", () => {
  it.each<[string, unknown]>([
    ["empty body", {}],
    ["unknown trust state", { trust_state: "superuser" }],
    ["non-boolean enabled", { enabled: "yes" }],
    ["client-supplied evidence", { trust_state: "trusted", successful_runs: 99 }],
    ["extra key", { trust_state: "trusted", configuration: {} }],
    ["array", []],
    ["malformed JSON", "{oops"],
  ])("rejects %s", async (_n, body) => {
    const s = seedSource();
    const res = await patch(s.id as string, body);
    expect(res.status).toBe(400);
    expect(sourceRow(s.id).trust_state).toBe("probation");
  });

  it("rejects a malformed id and returns 404 for an unknown source", async () => {
    expect((await patch("not-a-uuid", { enabled: false })).status).toBe(400);
    expect((await patch(randomUUID(), { enabled: false })).status).toBe(404);
  });
});

describe("PATCH /sources/{id}: trust promotion", () => {
  const promote = (id: unknown) => patch(id as string, { trust_state: "trusted", enabled: true });
  const message = async (res: Response) => (await json(res)).error?.message ?? "";

  it("requires the minimum successful runs", async () => {
    const s = seedSource({ successful_runs: TRUST_REQUIREMENTS.minSuccessfulRuns - 1 });
    seedApproved(s.id, 5);
    const res = await promote(s.id);
    expect(res.status).toBe(409);
    expect(await message(res)).toContain("insufficient_successful_runs");
    expect(sourceRow(s.id).trust_state).toBe("probation");
  });

  it("requires the minimum distinct approved candidates", async () => {
    const s = seedSource();
    seedApproved(s.id, TRUST_REQUIREMENTS.minApprovedCandidates - 1);
    const res = await promote(s.id);
    expect(res.status).toBe(409);
    expect(await message(res)).toContain("insufficient_approved_candidates");
  });

  it("counts a candidate once however many approvals it has", async () => {
    const s = seedSource();
    const approved = seedApproved(s.id, 4);
    for (let i = 0; i < 3; i += 1) mockState.db.seed("ingestion.reviews", [{ candidate_id: approved[0].id, reviewer_id: ADMIN_ID, decision: "approve", reason: "Again" }]);
    expect((await promote(s.id)).status).toBe(409);
  });

  it("ignores other sources, non-approvals, unapproved states and ineligible candidates", async () => {
    const s = seedSource();
    const other = seedSource();
    seedApproved(other.id, 5);
    seedApproved(s.id, 1);
    for (const over of [{ status: "rejected" }, { status: "needs_review" }, { is_market: false }, { vendor_verified: false }, { location_verified: false }, { cancelled: true }]) seedApproved(s.id, 1, over);
    const [noApproval] = mockState.db.seed("ingestion.candidates", [{ primary_source_id: s.id, canonical_key: randomUUID(), source_url: "https://example.org/x", title: "Auto Published Market", status: "published", is_market: true, vendor_verified: true, location_verified: true }]);
    mockState.db.seed("ingestion.reviews", [{ candidate_id: noApproval.id, reviewer_id: ADMIN_ID, decision: "request_review", reason: "Look" }]);
    const res = await promote(s.id);
    expect(res.status).toBe(409);
    expect(await message(res)).toContain("insufficient_approved_candidates");
  });

  it("refuses sources with an access restriction, a disabled state, discovery-only use or a disabled flag", async () => {
    const cases: [Row, string][] = [
      [{ configuration: { disabledReason: "Terms forbid automated access" } }, "access_restricted"],
      [{ trust_state: "disabled" }, "source_disabled"],
      [{ discovery_only: true }, "discovery_only_source"],
      [{ enabled: false }, "source_not_enabled"],
    ];
    for (const [over, expected] of cases) {
      const s = seedSource(over);
      seedApproved(s.id, 5);
      const res = await patch(s.id as string, { trust_state: "trusted" });
      expect(res.status).toBe(409);
      expect(await message(res)).toContain(expected);
    }
  });

  it("promotes when every requirement is met and records an audit entry with the admin and evidence", async () => {
    const s = seedSource({ successful_runs: 4 });
    seedApproved(s.id, 6);
    const res = await promote(s.id);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, source_id: s.id, trust_state: "trusted", enabled: true });
    expect(sourceRow(s.id).trust_state).toBe("trusted");
    const [entry] = audit(s.id);
    expect(entry).toMatchObject({ admin_id: ADMIN_ID, trust_state: { from: "probation", to: "trusted" }, evidence: { successful_runs: 4, approved_candidates: 6 } });
  });

  it("allows demotion and disabling without evidence, and audits them", async () => {
    const s = seedSource({ trust_state: "trusted", successful_runs: 0 });
    expect((await patch(s.id as string, { trust_state: "probation" })).status).toBe(200);
    expect((await patch(s.id as string, { enabled: false })).status).toBe(200);
    expect(sourceRow(s.id)).toMatchObject({ trust_state: "probation", enabled: false });
    expect(audit(s.id)).toHaveLength(2);
  });

  it("is a no-op without an audit entry when nothing changes", async () => {
    const s = seedSource();
    const res = await patch(s.id as string, { trust_state: "probation", enabled: true });
    expect(res.status).toBe(200);
    expect(audit(s.id)).toHaveLength(0);
  });

  it("refuses to enable a restricted or disabled source and to promote straight from disabled", async () => {
    const restricted = seedSource({ enabled: false, configuration: { disabledReason: "Terms forbid automated access" } });
    expect((await patch(restricted.id as string, { enabled: true })).status).toBe(409);
    const disabled = seedSource({ enabled: false, trust_state: "disabled" });
    expect((await patch(disabled.id as string, { enabled: true })).status).toBe(409);
    expect((await patch(disabled.id as string, { trust_state: "probation", enabled: true })).status).toBe(200);
  });

  it("keeps the audit trail bounded", async () => {
    const existing = Array.from({ length: AUDIT_ENTRY_LIMIT + 10 }, (_, i) => ({ at: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`, n: i }));
    const s = seedSource({ trust_state: "trusted", configuration: { audit: existing } });
    expect((await patch(s.id as string, { trust_state: "probation" })).status).toBe(200);
    const entries = audit(s.id);
    expect(entries).toHaveLength(AUDIT_ENTRY_LIMIT);
    expect(entries[entries.length - 1]).toMatchObject({ admin_id: ADMIN_ID });
  });
});
