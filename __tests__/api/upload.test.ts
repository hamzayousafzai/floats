/**
 * @jest-environment node
 *
 * upload API route tests
 *
 * Route: app/api/upload/route.ts
 */

// Set env vars required by createSupabaseAdmin()'s env check
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { parseJson } from "@/__tests__/__mocks__/next-server";

// ─── Supabase mocks ───────────────────────────────────────────────────────────
const mockGetUser = jest.fn();
const mockUpload = jest.fn();
const mockGetPublicUrl = jest.fn();

// Mock the underlying npm packages so the real wrapper functions (createSupabaseServer,
// createSupabaseAdmin) return our mock clients — avoids unreliable @/ alias resolution.
jest.mock("@supabase/ssr", () => ({
  createServerClient: jest.fn(() => ({
    auth: { getUser: mockGetUser },
  })),
  createBrowserClient: jest.fn(),
}));

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => ({
    storage: {
      from: jest.fn(() => ({
        upload: mockUpload,
        getPublicUrl: mockGetPublicUrl,
      })),
    },
  })),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────
import { POST } from "@/app/api/upload/route";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const BASE_URL = "http://localhost/api/upload";
const USER_ID = "user-abc";

function authAs(id = USER_ID) {
  mockGetUser.mockResolvedValue({ data: { user: { id } }, error: null });
}
function noAuth() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
}

function makeUploadRequest(file?: File): Request {
  const formData = new FormData();
  if (file) formData.append("file", file);
  return new Request(BASE_URL, { method: "POST", body: formData });
}

function makeTestFile(name = "photo.jpg", type = "image/jpeg"): File {
  return new File(["fake-image-content"], name, { type });
}

beforeEach(() => {
  jest.clearAllMocks();
  // Re-apply mock factories after clearAllMocks() resets them (Jest 30)
  jest.mocked(createServerClient).mockReturnValue({
    auth: { getUser: mockGetUser },
  } as never);
  jest.mocked(createClient).mockReturnValue({
    storage: {
      from: jest.fn(() => ({
        upload: mockUpload,
        getPublicUrl: mockGetPublicUrl,
      })),
    },
  } as never);
  noAuth();
  mockUpload.mockResolvedValue({ data: { path: "test.jpg" }, error: null });
  mockGetPublicUrl.mockReturnValue({ data: { publicUrl: "https://example.com/test.jpg" } });
});

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("POST /api/upload", () => {
  it("returns 401 when unauthenticated", async () => {
    noAuth();
    const req = makeUploadRequest(makeTestFile());
    const res = await POST(req as never);
    expect(res.status).toBe(401);
    const body = await parseJson(res);
    expect(body).toMatchObject({ error: "Unauthorized" });
  });

  it("returns 400 when no file is provided in the form data", async () => {
    authAs();
    const req = makeUploadRequest(); // no file
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const body = await parseJson(res);
    expect(body).toMatchObject({ error: "No file provided" });
  });

  it("returns the public URL on a successful upload", async () => {
    authAs();
    const req = makeUploadRequest(makeTestFile());
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const body = await parseJson<{ url: string }>(res);
    expect(body.url).toBe("https://example.com/test.jpg");
  });

  it("returns 500 when the storage upload fails", async () => {
    authAs();
    mockUpload.mockResolvedValueOnce({ data: null, error: { message: "Storage error" } });
    const req = makeUploadRequest(makeTestFile());
    const res = await POST(req as never);
    expect(res.status).toBe(500);
    const body = await parseJson(res);
    expect(body).toMatchObject({ error: "Upload failed" });
  });

  it("uses the admin storage client (bypasses RLS)", async () => {
    authAs();
    const req = makeUploadRequest(makeTestFile());
    await POST(req as never);
    expect(createClient).toHaveBeenCalled();
  });
});
