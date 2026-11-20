/**
 * @jest-environment node
 */
import { randomUUID } from "node:crypto";
import { MemoryDb } from "./helpers/memory-db";
import * as listRoute from "@/app/api/admin/ingestion/candidates/route";
import * as detailRoute from "@/app/api/admin/ingestion/candidates/[id]/route";
import * as publishRoute from "@/app/api/admin/ingestion/candidates/[id]/publish/route";
import { reviewCandidate, type ReviewPatch } from "@/lib/ingestion/review/review-candidate";
import { INGESTION_DEFAULTS } from "@/lib/ingestion/config";
import type { IngestionClient } from "@/lib/ingestion/storage/client";

type Row = Record<string, unknown>;

const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAIN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";

const mockState = {
  user: null as { id: string } | null,
  admins: [] as string[],
  db: new MemoryDb(),
  created: 0,
};

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

const DAY = 86_400_000;
const config = { ...INGESTION_DEFAULTS, supabaseUrl: "https://example.supabase.test", supabaseServiceRoleKey: "k" };
const idRoute = (id: string) => ({ params: Promise.resolve({ id }) });

function seedCandidate(db: MemoryDb, over: Row = {}): Row {
  const [source] = db.seed("ingestion.sources", [{ name: "Org", base_url: `https://example.org/${randomUUID()}`, source_type: "organizer", adapter: "html", trust_state: "probation" }]);
  const startsAt = new Date(Date.now() + 10 * DAY).toISOString();
  const endsAt = new Date(Date.now() + 10 * DAY + 5 * 3_600_000).toISOString();
  const [candidate] = db.seed("ingestion.candidates", [
    {
      primary_source_id: source.id,
      canonical_key: randomUUID(),
      source_url: "https://example.org/e/1",
      title: "Charlotte Makers Market",
      description: "A multi-vendor market featuring local makers and artists.",
      starts_at: startsAt,
      ends_at: endsAt,
      address: "123 N Tryon St, Charlotte, NC 28202",
      latitude: 35.2271,
      longitude: -80.8431,
      organizer_name: "Example Organizer",
      location_verified: true,
      vendor_verified: true,
      vendor_count: 12,
      vendor_evidence: ["12 vendors listed"],
      status: "needs_review",
      score: 82,
      is_market: true,
      duplicate_state: "clear",
      ...over,
    },
  ]);
  return candidate;
}

function request(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Request {
  const init: RequestInit = { method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers } };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  return new Request(url, init);
}

const BASE = "http://localhost/api/admin/ingestion/candidates";

function loginAdmin() {
  mockState.user = { id: ADMIN_ID };
  mockState.admins = [ADMIN_ID];
}

function reviewOk(status: string) {
  mockState.db.rpcHandlers.set("ingestion.apply_review", () => ({ data: status }));
}

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key-not-real";
});

beforeEach(() => {
  mockState.user = null;
  mockState.admins = [];
  mockState.db = new MemoryDb();
  mockState.created = 0;
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown> & { error?: { code: string; message: string } };
}

describe("authorization on every candidate route", () => {
  const calls: [string, () => Promise<Response>][] = [
    ["GET list", () => listRoute.GET(request("GET", BASE), undefined)],
    ["GET detail", () => detailRoute.GET(request("GET", `${BASE}/${randomUUID()}`), idRoute(randomUUID()))],
    ["PATCH", () => detailRoute.PATCH(request("PATCH", `${BASE}/${randomUUID()}`, { action: "approve", reason: "ok" }), idRoute(randomUUID()))],
    ["POST publish", () => publishRoute.POST(request("POST", `${BASE}/${randomUUID()}/publish`, { manual: true }), idRoute(randomUUID()))],
  ];

  it.each(calls)("%s rejects anonymous callers before touching the database", async (_name, call) => {
    const res = await call();
    expect(res.status).toBe(401);
    expect((await json(res)).error?.code).toBe("UNAUTHORIZED");
    expect(mockState.created).toBe(0);
  });

  it.each(calls)("%s rejects signed-in non-admins (including org owners) before touching the database", async (_name, call) => {
    mockState.user = { id: PLAIN_ID };
    const res = await call();
    expect(res.status).toBe(403);
    expect((await json(res)).error?.code).toBe("FORBIDDEN");
    expect(mockState.created).toBe(0);
  });
});

describe("GET /candidates", () => {
  beforeEach(loginAdmin);

  it("returns the spec list shape ordered by updated_at then id, with cursor pagination", async () => {
    const t = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
    const a = seedCandidate(mockState.db, { title: "Candidate Alpha Market", updated_at: t(1) });
    const b = seedCandidate(mockState.db, { title: "Candidate Bravo Market", updated_at: t(2) });
    const c = seedCandidate(mockState.db, { title: "Candidate Charlie Market", updated_at: t(3) });
    const first = await json(await listRoute.GET(request("GET", `${BASE}?limit=2`), undefined));
    expect(first.ok).toBe(true);
    const data = first.data as Row[];
    expect(data.map((d) => d.id)).toEqual([a.id, b.id]);
    expect(Object.keys(data[0]).sort()).toEqual(
      ["address", "duplicate_state", "ends_at", "id", "organizer_name", "published_event_id", "score", "source_url", "starts_at", "status", "title", "validation_reasons"].sort(),
    );
    expect(typeof first.next_cursor).toBe("string");
    const second = await json(await listRoute.GET(request("GET", `${BASE}?limit=2&cursor=${first.next_cursor}`), undefined));
    expect((second.data as Row[]).map((d) => d.id)).toEqual([c.id]);
    expect(second.next_cursor).toBeNull();
  });

  it("filters by status and treats a blank cursor as absent", async () => {
    seedCandidate(mockState.db, { status: "needs_review" });
    seedCandidate(mockState.db, { status: "rejected" });
    const body = await json(await listRoute.GET(request("GET", `${BASE}?status=rejected&limit=25&cursor=`), undefined));
    expect((body.data as Row[]).map((d) => d.status)).toEqual(["rejected"]);
  });

  it.each(["?status=bogus", "?limit=0", "?limit=101", "?limit=abc", "?cursor=not-a-cursor", "?offset=5"])("rejects invalid query %s with VALIDATION_ERROR", async (query) => {
    const res = await listRoute.GET(request("GET", `${BASE}${query}`), undefined);
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /candidates/{id}", () => {
  beforeEach(loginAdmin);

  it("returns the detail shape with sources", async () => {
    const c = seedCandidate(mockState.db);
    const res = await detailRoute.GET(request("GET", `${BASE}/${c.id}`), idRoute(c.id as string));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    const data = body.data as Row;
    expect(data).toMatchObject({ id: c.id, title: "Charlotte Makers Market", timezone: "America/New_York", vendor_count: 12, status: "needs_review", sources: [] });
    expect(data).not.toHaveProperty("approved_by");
    expect(data).not.toHaveProperty("primary_source_id");
  });

  it("returns 404 for an unknown candidate and 400 for a malformed id", async () => {
    const missing = randomUUID();
    expect((await detailRoute.GET(request("GET", `${BASE}/${missing}`), idRoute(missing))).status).toBe(404);
    const bad = await detailRoute.GET(request("GET", `${BASE}/x`), idRoute("x'; drop table ingestion.candidates;--"));
    expect(bad.status).toBe(400);
    expect(mockState.db.rows("ingestion.candidates")).toHaveLength(0);
  });
});

describe("PATCH /candidates/{id}", () => {
  beforeEach(loginAdmin);
  const patch = (id: string, body: unknown, headers: Record<string, string> = {}) => detailRoute.PATCH(request("PATCH", `${BASE}/${id}`, body, headers), idRoute(id));

  it("approves with the real admin id, a stale-read guard and revalidated fields, and never publishes", async () => {
    const c = seedCandidate(mockState.db);
    reviewOk("approved");
    const res = await patch(c.id as string, { action: "approve", reason: "Organizer and dates verified", changes: { title: "Charlotte Makers Market Winter" } });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, candidate_id: c.id, status: "approved", published_event_id: null });
    const call = mockState.db.rpcCalls.find((r) => r.name === "ingestion.apply_review");
    expect(call?.args).toMatchObject({
      p_candidate_id: c.id,
      p_reviewer_id: ADMIN_ID,
      p_decision: "approve",
      p_reason: "Organizer and dates verified",
      p_changes: { title: "Charlotte Makers Market Winter" },
      p_expected_updated_at: c.updated_at,
      p_hard_gates_passed: true,
    });
    expect((call?.args.p_fields as Row).title).toBe("Charlotte Makers Market Winter");
    expect((call?.args.p_fields as Row).duplicate_state).toBe("clear");
    expect(mockState.db.rpcCalls.some((r) => r.name === "ingestion.publish_candidate")).toBe(false);
    expect(mockState.db.rows("public.events")).toHaveLength(0);
  });

  it("supports reject and request_review without requiring hard gates", async () => {
    const weak = seedCandidate(mockState.db, { description: "short", vendor_count: null, vendor_verified: false });
    reviewOk("rejected");
    expect(await json(await patch(weak.id as string, { action: "reject", reason: "Not a market" }))).toMatchObject({ ok: true, status: "rejected" });
    const ready = seedCandidate(mockState.db, { status: "ready" });
    reviewOk("needs_review");
    expect(await json(await patch(ready.id as string, { action: "request_review", reason: "Second look" }))).toMatchObject({ ok: true, status: "needs_review" });
  });

  it.each<[string, unknown]>([
    ["missing reason", { action: "approve" }],
    ["blank reason", { action: "approve", reason: "   " }],
    ["unknown action", { action: "publish", reason: "x" }],
    ["unknown top-level key", { action: "approve", reason: "x", status: "published" }],
    ["non-editable change key", { action: "approve", reason: "x", changes: { status: "published" } }],
    ["non-editable change key score", { action: "approve", reason: "x", changes: { score: 100 } }],
    ["latitude without longitude", { action: "approve", reason: "x", changes: { latitude: 35.2 } }],
    ["latitude out of range", { action: "approve", reason: "x", changes: { latitude: 135, longitude: -80 } }],
    ["bad timestamp", { action: "approve", reason: "x", changes: { starts_at: "tomorrow" } }],
    ["short title", { action: "approve", reason: "x", changes: { title: "Hi" } }],
    ["negative vendor_count", { action: "approve", reason: "x", changes: { vendor_count: -1 } }],
    ["bad category slug", { action: "approve", reason: "x", changes: { category_slugs: ["Not A Slug!"] } }],
    ["array body", []],
    ["null body", null],
  ])("rejects %s with VALIDATION_ERROR and no write", async (_name, body) => {
    const c = seedCandidate(mockState.db);
    const res = await patch(c.id as string, body);
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe("VALIDATION_ERROR");
    expect(mockState.db.rpcCalls).toHaveLength(0);
  });

  it("rejects a reversed date range", async () => {
    const c = seedCandidate(mockState.db);
    const start = new Date(Date.now() + 20 * DAY).toISOString();
    const res = await patch(c.id as string, { action: "approve", reason: "x", changes: { starts_at: start, ends_at: new Date(Date.now() + 19 * DAY).toISOString() } });
    expect(res.status).toBe(400);
    expect(mockState.db.rpcCalls).toHaveLength(0);
  });

  it("rejects non-JSON, oversized, malformed and cross-origin requests", async () => {
    const c = seedCandidate(mockState.db);
    const id = c.id as string;
    const textBody = new Request(`${BASE}/${id}`, { method: "PATCH", headers: { "content-type": "text/plain" }, body: JSON.stringify({ action: "approve", reason: "x" }) });
    expect((await detailRoute.PATCH(textBody, idRoute(id))).status).toBe(400);
    expect((await patch(id, "{not json")).status).toBe(400);
    expect((await patch(id, JSON.stringify({ action: "approve", reason: "x".repeat(70_000) }))).status).toBe(400);
    const cross = await patch(id, { action: "approve", reason: "x" }, { origin: "https://evil.example", host: "localhost" });
    expect(cross.status).toBe(403);
    expect(mockState.db.rpcCalls).toHaveLength(0);
  });

  it("refuses approval while hard gates are unresolved, listing only reason codes", async () => {
    const c = seedCandidate(mockState.db, { description: "short", vendor_count: null, vendor_verified: false });
    reviewOk("approved");
    const res = await patch(c.id as string, { action: "approve", reason: "Looks fine" });
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.error?.code).toBe("CONFLICT");
    expect(body.error?.message).toMatch(/missing_description/);
    expect(body.error?.message).toMatch(/insufficient_vendor_evidence/);
    expect(mockState.db.rpcCalls).toHaveLength(0);
  });

  it("refuses approval of a candidate that is a possible duplicate of a production event", async () => {
    const c = seedCandidate(mockState.db);
    mockState.db.seed("public.events", [
      { title: c.title, starts_at: c.starts_at, ends_at: c.ends_at, address: c.address, latitude: c.latitude, longitude: c.longitude, status: "published" },
    ]);
    reviewOk("approved");
    const res = await patch(c.id as string, { action: "approve", reason: "Looks fine" });
    expect(res.status).toBe(409);
    expect(mockState.db.rpcCalls).toHaveLength(0);
  });

  it.each<[string, string, string]>([
    ["approve", "ready", "ready candidates need request_review first"],
    ["reject", "ready", "ready candidates need request_review first"],
    ["approve", "approved", "already approved"],
    ["reject", "rejected", "already rejected"],
    ["request_review", "approved", "approved cannot return to review"],
    ["approve", "published", "published"],
    ["approve", "pending", "pending"],
  ])("refuses %s on a %s candidate (%s)", async (action, status) => {
    const c = seedCandidate(mockState.db, { status });
    reviewOk("approved");
    const res = await patch(c.id as string, { action, reason: "Because" });
    expect(res.status).toBe(409);
    expect(mockState.db.rpcCalls).toHaveLength(0);
  });

  it("returns 404 for an unknown candidate", async () => {
    const missing = randomUUID();
    expect((await patch(missing, { action: "approve", reason: "x" })).status).toBe(404);
  });

  it.each<[string, number, string]>([
    ["Candidate changed", 409, "CONFLICT"],
    ["Invalid status transition", 409, "CONFLICT"],
    ["Hard gates unresolved", 409, "CONFLICT"],
    ["Administrator required", 403, "FORBIDDEN"],
    ["Candidate not found", 404, "NOT_FOUND"],
  ])("maps the database error '%s' to %i %s", async (message, status, code) => {
    const c = seedCandidate(mockState.db);
    mockState.db.rpcHandlers.set("ingestion.apply_review", () => ({ error: { code: "P0001", message } }));
    const res = await patch(c.id as string, { action: "approve", reason: "ok" });
    expect(res.status).toBe(status);
    expect((await json(res)).error?.code).toBe(code);
  });

  it("returns a generic INTERNAL_ERROR for unexpected database failures without leaking SQL", async () => {
    const c = seedCandidate(mockState.db);
    mockState.db.rpcHandlers.set("ingestion.apply_review", () => ({ error: { code: "XX000", message: 'insert into "ingestion"."reviews" failed password=hunter2' } }));
    const res = await patch(c.id as string, { action: "approve", reason: "ok" });
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toMatch(/insert|reviews|hunter2/);
    expect(JSON.parse(text)).toEqual({ ok: false, error: { code: "INTERNAL_ERROR", message: "Internal error" } });
  });
});

describe("reviewCandidate: edits and location handling", () => {
  const admin = ADMIN_ID;
  const run = (db: MemoryDb, id: string, patch: ReviewPatch, geocode?: (a: string) => Promise<{ latitude: number; longitude: number; verified: boolean } | null>) =>
    reviewCandidate({ client: db.client() as unknown as IngestionClient, config, geocode: geocode as never }, { candidateId: id, adminId: admin, patch });

  it("clears coordinates when the address changes and cannot be geocoded, so approval is refused", async () => {
    const db = new MemoryDb();
    const c = seedCandidate(db);
    reviewOk("approved");
    db.rpcHandlers.set("ingestion.apply_review", () => ({ data: "approved" }));
    await expect(run(db, c.id as string, { action: "approve", reason: "x", changes: { address: "999 Unknown Rd, Somewhere, NC 28000" } }, async () => null)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("uses verified geocoder coordinates for a changed address", async () => {
    const db = new MemoryDb();
    const c = seedCandidate(db);
    db.rpcHandlers.set("ingestion.apply_review", () => ({ data: "approved" }));
    await run(db, c.id as string, { action: "approve", reason: "x", changes: { address: "200 S Tryon St, Charlotte, NC 28202" } }, async () => ({ latitude: 35.2262, longitude: -80.8433, verified: true }));
    const fields = db.rpcCalls[0].args.p_fields as Row;
    expect(fields).toMatchObject({ address: "200 S Tryon St, Charlotte, NC 28202", latitude: 35.2262, longitude: -80.8433, location_verified: true });
  });

  it("refuses coordinates outside the service radius on approval", async () => {
    const db = new MemoryDb();
    const c = seedCandidate(db);
    db.rpcHandlers.set("ingestion.apply_review", () => ({ data: "approved" }));
    await expect(run(db, c.id as string, { action: "approve", reason: "x", changes: { latitude: 33.749, longitude: -84.388 } })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("lets a rejection retain unresolved facts and records them", async () => {
    const db = new MemoryDb();
    const c = seedCandidate(db, { description: null });
    db.rpcHandlers.set("ingestion.apply_review", () => ({ data: "rejected" }));
    const result = await run(db, c.id as string, { action: "reject", reason: "Not relevant" });
    expect(result).toEqual({ candidateId: c.id, status: "rejected", publishedEventId: null });
    expect(db.rpcCalls[0].args.p_hard_gates_passed).toBe(false);
  });
});

describe("POST /candidates/{id}/publish", () => {
  beforeEach(loginAdmin);
  const publish = (id: string, body: unknown = { manual: true }) => publishRoute.POST(request("POST", `${BASE}/${id}/publish`, body), idRoute(id));

  it("publishes an approved candidate manually and returns the spec shape", async () => {
    const c = seedCandidate(mockState.db, { status: "approved", approved_by: ADMIN_ID });
    mockState.db.rpcHandlers.set("ingestion.publish_candidate", () => ({ data: EVENT_ID }));
    const res = await publish(c.id as string);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, candidate_id: c.id, event_id: EVENT_ID, status: "published" });
    expect(mockState.db.rpcCalls[0]).toMatchObject({ name: "ingestion.publish_candidate", args: { p_candidate_id: c.id, p_manual: true } });
  });

  it("is idempotent for an already published candidate", async () => {
    const c = seedCandidate(mockState.db, { status: "published", approved_by: ADMIN_ID, published_event_id: EVENT_ID });
    const res = await publish(c.id as string);
    expect(await json(res)).toMatchObject({ ok: true, event_id: EVENT_ID });
    expect(mockState.db.rpcCalls).toHaveLength(0);
  });

  it.each<[string, unknown]>([
    ["manual false", { manual: false }],
    ["empty body", {}],
    ["extra key", { manual: true, force: true }],
    ["string flag", { manual: "true" }],
  ])("requires exactly {manual:true} (%s)", async (_name, body) => {
    const c = seedCandidate(mockState.db, { status: "approved", approved_by: ADMIN_ID });
    const res = await publish(c.id as string, body);
    expect(res.status).toBe(400);
    expect(mockState.db.rpcCalls).toHaveLength(0);
  });

  it.each<[string, Row]>([
    ["a needs_review candidate", { status: "needs_review" }],
    ["a ready candidate", { status: "ready" }],
    ["an approved candidate with no recorded approver", { status: "approved", approved_by: null }],
    ["a rejected candidate", { status: "rejected" }],
  ])("refuses to publish %s", async (_name, over) => {
    const c = seedCandidate(mockState.db, over);
    mockState.db.rpcHandlers.set("ingestion.publish_candidate", () => ({ data: EVENT_ID }));
    const res = await publish(c.id as string);
    expect(res.status).toBe(409);
    expect(mockState.db.rpcCalls.some((r) => r.name === "ingestion.publish_candidate")).toBe(false);
  });

  it.each<[string, number]>([
    ["Candidate failed hard publication gates", 409],
    ["Possible existing production duplicate", 409],
    ["Existing published event identity", 409],
    ["Event is outside radius", 409],
    ["Source unavailable", 409],
  ])("maps the publisher refusal '%s' to %i", async (message, status) => {
    const c = seedCandidate(mockState.db, { status: "approved", approved_by: ADMIN_ID });
    mockState.db.rpcHandlers.set("ingestion.publish_candidate", () => ({ error: { code: "P0001", message } }));
    const res = await publish(c.id as string);
    expect(res.status).toBe(status);
    expect((await json(res)).error?.code).toBe("CONFLICT");
  });

  it("returns 404 for an unknown candidate and a generic 500 for unexpected publisher failures", async () => {
    expect((await publish(randomUUID())).status).toBe(404);
    const c = seedCandidate(mockState.db, { status: "approved", approved_by: ADMIN_ID });
    mockState.db.rpcHandlers.set("ingestion.publish_candidate", () => ({ error: { code: "XX000", message: "deadlock detected in ingestion.candidates" } }));
    const res = await publish(c.id as string);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/deadlock|ingestion\./);
  });
});
