/**
 * @jest-environment node
 *
 * check-in API route tests — GET + POST
 *
 * Route: app/api/check-in/route.ts
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { makeRequest, makeJsonRequest, parseJson } from "@/__tests__/__mocks__/next-server";

// ─── Supabase mocks ───────────────────────────────────────────────────────────
const mockGetUser = jest.fn<(...args: any[]) => any>();
const mockMaybeSingle = jest.fn<(...args: any[]) => any>();
const mockRpc = jest.fn<(...args: any[]) => any>();

// Chainable query builder shared across .from() calls
const queryBuilder = {
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  order: jest.fn().mockReturnThis(),
  single: jest.fn<(...args: any[]) => any>().mockResolvedValue({ data: null, error: null }),
  maybeSingle: mockMaybeSingle,
};
// Make queryBuilder itself reset its returns
function resetQB() {
  (Object.keys(queryBuilder) as (keyof typeof queryBuilder)[]).forEach((k) => {
    if (k !== "maybeSingle" && k !== "single") {
      (queryBuilder[k] as jest.Mock).mockReturnValue(queryBuilder);
    }
  });
  queryBuilder.maybeSingle = mockMaybeSingle;
}

const mockFrom = jest.fn().mockReturnValue(queryBuilder);

// Mock the underlying @supabase/ssr so the real createSupabaseServer() wrapper
// returns our mock client — avoids unreliable @/ alias resolution in jest.mock().
jest.mock("@supabase/ssr", () => ({
  createServerClient: jest.fn(() => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
    rpc: mockRpc,
  })),
  createBrowserClient: jest.fn(),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────
import { GET, POST } from "@/app/api/check-in/route";
import { createServerClient } from "@supabase/ssr";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const BASE_URL = "http://localhost/api/check-in";
const EVENT_ID = "event-111";
const USER_ID = "user-abc";

function authAs(id = USER_ID) {
  mockGetUser.mockResolvedValue({ data: { user: { id } }, error: null });
}
function noAuth() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
}

beforeEach(() => {
  jest.clearAllMocks();
  // Re-apply after clearAllMocks() resets the factory implementation (Jest 30)
  jest.mocked(createServerClient).mockReturnValue({
    auth: { getUser: mockGetUser },
    from: mockFrom,
    rpc: mockRpc,
  } as never);
  resetQB();
  mockFrom.mockReturnValue(queryBuilder);
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  mockRpc.mockResolvedValue({ data: null, error: null });
  noAuth();
});

// ─── GET ──────────────────────────────────────────────────────────────────────
describe("GET /api/check-in", () => {
  it("returns { checked: false } with status 200 when unauthenticated", async () => {
    noAuth();
    const req = makeRequest("GET", `${BASE_URL}?event_id=${EVENT_ID}`);
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body).toMatchObject({ checked: false });
  });

  it("returns 400 when event_id is missing", async () => {
    authAs();
    const req = makeRequest("GET", BASE_URL);
    const res = await GET(req as never);
    expect(res.status).toBe(400);
    const body = await parseJson(res);
    expect(body).toMatchObject({ code: "bad_request" });
  });

  it("returns { checked: false } when no check-in row exists", async () => {
    authAs();
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const req = makeRequest("GET", `${BASE_URL}?event_id=${EVENT_ID}`);
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const body = await parseJson<{ checked: boolean }>(res);
    expect(body.checked).toBe(false);
  });

  it("returns { checked: true, checked_at, distance_m } when check-in exists", async () => {
    authAs();
    const row = { id: "ci-1", checked_at: "2025-01-01T12:00:00Z", distance_m: 42 };
    mockMaybeSingle.mockResolvedValueOnce({ data: row, error: null });
    const req = makeRequest("GET", `${BASE_URL}?event_id=${EVENT_ID}`);
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const body = await parseJson<{ checked: boolean; checked_at: string; distance_m: number }>(res);
    expect(body.checked).toBe(true);
    expect(body.checked_at).toBe(row.checked_at);
    expect(body.distance_m).toBe(row.distance_m);
  });

  it("returns 400 { code: 'unknown_error' } when DB query fails", async () => {
    authAs();
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: { message: "DB error" } });
    const req = makeRequest("GET", `${BASE_URL}?event_id=${EVENT_ID}`);
    const res = await GET(req as never);
    expect(res.status).toBe(400);
    const body = await parseJson(res);
    expect(body).toMatchObject({ code: "unknown_error" });
  });
});

// ─── POST ─────────────────────────────────────────────────────────────────────
describe("POST /api/check-in", () => {
  it("returns 401 when unauthenticated", async () => {
    noAuth();
    const req = makeJsonRequest("POST", BASE_URL, { event_id: EVENT_ID, lat: 40.7, lng: -74.0 });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
    const body = await parseJson(res);
    expect(body).toMatchObject({ code: "not_authenticated" });
  });

  it("returns 400 when body is not valid JSON", async () => {
    authAs();
    const req = new Request(BASE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const body = await parseJson(res);
    expect(body).toMatchObject({ code: "bad_request" });
  });

  it("returns 400 when required fields are missing", async () => {
    authAs();
    const req = makeJsonRequest("POST", BASE_URL, { event_id: EVENT_ID }); // missing lat/lng
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const body = await parseJson(res);
    expect(body).toMatchObject({ code: "bad_request" });
  });

  it("returns 400 when lat is not a number", async () => {
    authAs();
    const req = makeJsonRequest("POST", BASE_URL, { event_id: EVENT_ID, lat: "40.7", lng: -74.0 });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("returns { ok: true, check_in_id, distance_m } on success", async () => {
    authAs();
    mockRpc.mockResolvedValueOnce({
      data: [{ check_in_id: "ci-99", distance_m: 15 }],
      error: null,
    });
    const req = makeJsonRequest("POST", BASE_URL, { event_id: EVENT_ID, lat: 40.7, lng: -74.0 });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const body = await parseJson<{ ok: boolean; check_in_id: string; distance_m: number }>(res);
    expect(body.ok).toBe(true);
    expect(body.check_in_id).toBe("ci-99");
    expect(body.distance_m).toBe(15);
  });

  // Test each documented RPC error code
  const rpcErrorCodes = [
    "outside_time_window",
    "bad_accuracy",
    "outside_geofence",
    "event_missing_location",
    "event_not_found",
    "invalid_coordinates",
    "not_authenticated",
  ];

  it.each(rpcErrorCodes)(
    "maps RPC error message '%s' to the correct code in the response",
    async (code) => {
      authAs();
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: code },
      });
      const req = makeJsonRequest("POST", BASE_URL, {
        event_id: EVENT_ID,
        lat: 40.7,
        lng: -74.0,
      });
      const res = await POST(req as never);
      expect(res.status).toBe(400);
      const body = await parseJson<{ code: string }>(res);
      expect(body.code).toBe(code);
    }
  );

  it("returns code 'unknown_error' for unrecognised RPC error messages", async () => {
    authAs();
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "something completely unexpected" },
    });
    const req = makeJsonRequest("POST", BASE_URL, { event_id: EVENT_ID, lat: 40.7, lng: -74.0 });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const body = await parseJson<{ code: string }>(res);
    expect(body.code).toBe("unknown_error");
  });
});
