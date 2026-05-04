/**
 * @jest-environment node
 *
 * series follow API route tests — POST + GET
 *
 * Route: app/api/series/[id]/follow/route.ts
 */

// Set env vars required by createSupabaseAdmin()'s env check
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { makeJsonRequest, makeRequest, parseJson } from "@/__tests__/__mocks__/next-server";

// ─── Supabase mocks ───────────────────────────────────────────────────────────
const mockGetUser = jest.fn();

// User-authed client
const mockUpsert = jest.fn();
const mockSelect = jest.fn();
const mockEq = jest.fn();
const mockMaybeSingle = jest.fn();

const userQB = {
  upsert: mockUpsert,
  select: jest.fn().mockReturnThis(),
  eq: mockEq,
  maybeSingle: mockMaybeSingle,
};
// Chain eq → userQB so multiple .eq() calls work
mockEq.mockReturnValue(userQB);
mockUpsert.mockResolvedValue({ error: null });
mockMaybeSingle.mockResolvedValue({ data: null, error: null });

const mockUserFrom = jest.fn().mockReturnValue(userQB);

// Mock the underlying npm packages so the real wrapper functions (createSupabaseServer,
// createSupabaseAdmin) return our mock clients — avoids unreliable @/ alias resolution.
jest.mock("@supabase/ssr", () => ({
  createServerClient: jest.fn(() => ({
    auth: { getUser: mockGetUser },
    from: mockUserFrom,
  })),
  createBrowserClient: jest.fn(),
}));

// Admin client (used for notification cancellation on unfollow)
const mockAdminUpdate = jest.fn();
const mockAdminIn = jest.fn();
const mockAdminEq = jest.fn();

const adminQB = {
  select: jest.fn().mockReturnThis(),
  eq: mockAdminEq,
  update: mockAdminUpdate,
  in: mockAdminIn,
};
mockAdminEq.mockReturnValue(adminQB);
mockAdminUpdate.mockReturnValue(adminQB);
mockAdminIn.mockReturnValue(adminQB);
// .gt() used for future events query
(adminQB as Record<string, jest.Mock>).gt = jest.fn().mockReturnValue(adminQB);

const mockAdminFrom = jest.fn().mockReturnValue(adminQB);

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => ({
    from: mockAdminFrom,
  })),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────
import { POST, GET } from "@/app/api/series/[id]/follow/route";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const BASE_URL = "http://localhost/api/series/series-abc/follow";
const SERIES_ID = "series-abc";
const USER_ID = "user-123";

function authAs(id = USER_ID) {
  mockGetUser.mockResolvedValue({ data: { user: { id } }, error: null });
}
function noAuth() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
}

// Params as Next.js passes them
const params = Promise.resolve({ id: SERIES_ID });

beforeEach(() => {
  jest.clearAllMocks();
  // Re-apply mock factories after clearAllMocks() resets them (Jest 30)
  jest.mocked(createServerClient).mockReturnValue({
    auth: { getUser: mockGetUser },
    from: mockUserFrom,
  } as never);
  jest.mocked(createClient).mockReturnValue({
    from: mockAdminFrom,
  } as never);
  noAuth();
  mockUpsert.mockResolvedValue({ error: null });
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  mockUserFrom.mockReturnValue(userQB);
  mockAdminFrom.mockReturnValue(adminQB);
  (adminQB as Record<string, jest.Mock>).gt = jest.fn().mockReturnValue(adminQB);
  mockAdminEq.mockReturnValue(adminQB);
  mockAdminUpdate.mockReturnValue(adminQB);
  mockAdminIn.mockResolvedValue({ error: null });
});

// ─── POST tests ───────────────────────────────────────────────────────────────
describe("POST /api/series/[id]/follow", () => {
  it("returns 401 when unauthenticated", async () => {
    noAuth();
    const req = makeJsonRequest("POST", BASE_URL, { following: true });
    const res = await POST(req as never, { params });
    expect(res.status).toBe(401);
  });

  it("upserts series_follows with following: true when subscribing", async () => {
    authAs();
    const req = makeJsonRequest("POST", BASE_URL, { following: true });
    await POST(req as never, { params });
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: USER_ID, series_id: SERIES_ID, following: true }),
      expect.objectContaining({ onConflict: "user_id,series_id" })
    );
  });

  it("returns { ok: true, following: true } when subscribing", async () => {
    authAs();
    const req = makeJsonRequest("POST", BASE_URL, { following: true });
    const res = await POST(req as never, { params });
    expect(res.status).toBe(200);
    const body = await parseJson<{ ok: boolean; following: boolean }>(res);
    expect(body).toEqual({ ok: true, following: true });
  });

  it("upserts series_follows with following: false when unsubscribing", async () => {
    authAs();
    const req = makeJsonRequest("POST", BASE_URL, { following: false });
    await POST(req as never, { params });
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ following: false }),
      expect.any(Object)
    );
  });

  it("cancels pending future notification jobs when unsubscribing", async () => {
    authAs();
    // Admin client returns 2 future events
    (adminQB as Record<string, jest.Mock>).gt = jest
      .fn()
      .mockResolvedValue({ data: [{ id: "e1" }, { id: "e2" }], error: null });

    const req = makeJsonRequest("POST", BASE_URL, { following: false });
    await POST(req as never, { params });

    // Admin from() called for events lookup
    expect(mockAdminFrom).toHaveBeenCalledWith("events");
    // Admin from() called for queue update
    expect(mockAdminFrom).toHaveBeenCalledWith("event_notification_queue");
  });

  it("does NOT call admin client when subscribing (following: true)", async () => {
    authAs();
    const req = makeJsonRequest("POST", BASE_URL, { following: true });
    await POST(req as never, { params });
    // When following=true, admin is not needed for notification cancellation
    // We just check the update was not called for cancellation
    expect(mockAdminUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "canceled" })
    );
  });

  it("returns 500 on upsert error", async () => {
    authAs();
    mockUpsert.mockResolvedValueOnce({ error: { message: "upsert failed" } });
    const req = makeJsonRequest("POST", BASE_URL, { following: true });
    const res = await POST(req as never, { params });
    expect(res.status).toBe(500);
  });
});

// ─── GET tests ────────────────────────────────────────────────────────────────
describe("GET /api/series/[id]/follow", () => {
  it("returns 401 when unauthenticated", async () => {
    noAuth();
    const req = makeRequest("GET", BASE_URL);
    const res = await GET(req as never, { params });
    expect(res.status).toBe(401);
  });

  it("returns { following: false } when no row exists", async () => {
    authAs();
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const req = makeRequest("GET", BASE_URL);
    const res = await GET(req as never, { params });
    expect(res.status).toBe(200);
    const body = await parseJson<{ following: boolean }>(res);
    expect(body.following).toBe(false);
  });

  it("returns { following: true } when a row with following=true exists", async () => {
    authAs();
    mockMaybeSingle.mockResolvedValueOnce({ data: { following: true }, error: null });
    const req = makeRequest("GET", BASE_URL);
    const res = await GET(req as never, { params });
    expect(res.status).toBe(200);
    const body = await parseJson<{ following: boolean }>(res);
    expect(body.following).toBe(true);
  });

  it("returns { following: false } when a row with following=false exists", async () => {
    authAs();
    mockMaybeSingle.mockResolvedValueOnce({ data: { following: false }, error: null });
    const req = makeRequest("GET", BASE_URL);
    const res = await GET(req as never, { params });
    const body = await parseJson<{ following: boolean }>(res);
    expect(body.following).toBe(false);
  });

  it("returns 500 on DB error", async () => {
    authAs();
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: { message: "DB error" } });
    const req = makeRequest("GET", BASE_URL);
    const res = await GET(req as never, { params });
    expect(res.status).toBe(500);
  });
});
