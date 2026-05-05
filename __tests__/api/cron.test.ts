/**
 * @jest-environment node
 *
 * Cron: process-notifications API route tests
 *
 * Route: app/api/cron/process-notifications/route.tsx
 */

// Set env vars before hoisted jest.mock calls execute
process.env.CRON_SECRET = "test-secret-xyz";
process.env.RESEND_API_KEY = "re_test_key";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { makeBearerRequest, parseJson } from "@/__tests__/__mocks__/next-server";

// ─── Supabase admin mock ──────────────────────────────────────────────────────
// NOTE: jest.mock is hoisted — variables defined below would be undefined inside the factory.
// Use jest.fn() inline; retrieve via jest.mocked() after import.

// Mock the underlying @supabase/supabase-js createClient so the real
// createSupabaseAdmin() wrapper works without @/ alias resolution issues.
jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(),
}));

// ─── Resend mock ──────────────────────────────────────────────────────────────
jest.mock("resend", () => ({
  Resend: jest.fn(),
}));

// ─── Email component mocks ────────────────────────────────────────────────────
jest.mock("@/components/emails/TwoDayReminderEmail", () => ({
  __esModule: true,
  default: jest.fn(() => null),
}));
jest.mock("@/components/emails/EventStartingEmail", () => ({
  __esModule: true,
  default: jest.fn(() => null),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────
import { GET } from "@/app/api/cron/process-notifications/route";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

// ─── Typed references ─────────────────────────────────────────────────────────
const MockCreateClient = jest.mocked(createClient);
const MockResend = jest.mocked(Resend);

// ─── Per-test mock state ──────────────────────────────────────────────────────
const CRON_SECRET = process.env.CRON_SECRET!;
const BASE_URL = "http://localhost/api/cron/process-notifications";

function makeAdminClient() {
  const mockEq = jest.fn().mockResolvedValue({ data: null, error: null });
  const mockUpdate = jest.fn().mockReturnValue({ eq: mockEq });
  const mockFrom = jest.fn().mockReturnValue({ update: mockUpdate });
  const mockRpc = jest.fn().mockResolvedValue({ data: [], error: null });
  return { from: mockFrom, rpc: mockRpc, _mockUpdate: mockUpdate, _mockEq: mockEq };
}

function makeResendClient() {
  const mockEmailSend = jest.fn().mockResolvedValue({ id: "email-id", error: null });
  return { emails: { send: mockEmailSend }, _mockEmailSend: mockEmailSend };
}

function makeJob(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "job-1",
    user_email: "user@test.com",
    event_id: "event-1",
    event_title: "Test Event",
    notification_kind: "reminder_48hr",
    ...overrides,
  };
}

let adminClient: ReturnType<typeof makeAdminClient>;
let resendClient: ReturnType<typeof makeResendClient>;

beforeEach(() => {
  jest.clearAllMocks();
  adminClient = makeAdminClient();
  resendClient = makeResendClient();
  MockCreateClient.mockReturnValue(adminClient as never);
  MockResend.mockImplementation(() => resendClient as never);
});

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("GET /api/cron/process-notifications", () => {
  describe("authorization", () => {
    it("returns 401 when Authorization header is missing", async () => {
      const req = new Request(BASE_URL, { method: "GET" });
      const res = await GET(req);
      expect(res.status).toBe(401);
    });

    it("returns 401 when Authorization header has wrong secret", async () => {
      const req = makeBearerRequest("GET", BASE_URL, "wrong-secret");
      const res = await GET(req);
      expect(res.status).toBe(401);
    });

    it("proceeds when Authorization header is correct", async () => {
      const req = makeBearerRequest("GET", BASE_URL, CRON_SECRET);
      const res = await GET(req);
      expect(res.status).not.toBe(401);
    });
  });

  describe("no pending jobs", () => {
    it("returns { ok: true } and a message when no jobs are queued", async () => {
      const req = makeBearerRequest("GET", BASE_URL, CRON_SECRET);
      const res = await GET(req);
      expect(res.status).toBe(200);
      const body = await parseJson<{ ok: boolean; message: string }>(res);
      expect(body.ok).toBe(true);
      expect(body.message).toBeTruthy();
    });

    it("does not call Resend when there are no jobs", async () => {
      const req = makeBearerRequest("GET", BASE_URL, CRON_SECRET);
      await GET(req);
      expect(resendClient._mockEmailSend).not.toHaveBeenCalled();
    });
  });

  describe("RPC failure", () => {
    it("returns 500 when the RPC query fails", async () => {
      adminClient.rpc.mockResolvedValueOnce({ data: null, error: { message: "DB error" } });
      const req = makeBearerRequest("GET", BASE_URL, CRON_SECRET);
      const res = await GET(req);
      expect(res.status).toBe(500);
    });
  });

  describe("job processing", () => {
    it("calls Resend once per job", async () => {
      const jobs = [makeJob({ id: "j1" }), makeJob({ id: "j2", notification_kind: "reminder_starting" })];
      adminClient.rpc.mockResolvedValueOnce({ data: jobs, error: null });
      const req = makeBearerRequest("GET", BASE_URL, CRON_SECRET);
      await GET(req);
      expect(resendClient._mockEmailSend).toHaveBeenCalledTimes(2);
    });

    it("returns { ok: true, processed } with the count of jobs", async () => {
      const jobs = [makeJob({ id: "j1" }), makeJob({ id: "j2" })];
      adminClient.rpc.mockResolvedValueOnce({ data: jobs, error: null });
      const req = makeBearerRequest("GET", BASE_URL, CRON_SECRET);
      const res = await GET(req);
      expect(res.status).toBe(200);
      const body = await parseJson<{ ok: boolean; processed: number }>(res);
      expect(body.ok).toBe(true);
      expect(body.processed).toBe(2);
    });

    it("marks successfully sent jobs as 'sent'", async () => {
      adminClient.rpc.mockResolvedValueOnce({ data: [makeJob()], error: null });
      const req = makeBearerRequest("GET", BASE_URL, CRON_SECRET);
      await GET(req);
      expect(adminClient._mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ status: "sent" })
      );
    });

    it("marks failed jobs as 'failed' and records the error message", async () => {
      resendClient._mockEmailSend.mockRejectedValueOnce(new Error("Resend network error"));
      adminClient.rpc.mockResolvedValueOnce({ data: [makeJob()], error: null });
      const req = makeBearerRequest("GET", BASE_URL, CRON_SECRET);
      await GET(req);
      expect(adminClient._mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed", error_message: "Resend network error" })
      );
    });

    it("processes all jobs even if one fails (Promise.all)", async () => {
      const jobs = [makeJob({ id: "j1" }), makeJob({ id: "j2" })];
      resendClient._mockEmailSend
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValueOnce({ id: "ok", error: null });
      adminClient.rpc.mockResolvedValueOnce({ data: jobs, error: null });
      const req = makeBearerRequest("GET", BASE_URL, CRON_SECRET);
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(adminClient._mockUpdate).toHaveBeenCalledTimes(2);
    });
  });
});
