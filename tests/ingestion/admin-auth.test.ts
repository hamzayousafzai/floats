/**
 * @jest-environment node
 */
import { z } from "zod";
import { ApiError, ERROR_STATUS, errorResponse, toErrorResponse, type ApiErrorCode } from "@/lib/ingestion/security/api-errors";
import { requireIngestionAdmin, withIngestionAdmin, type SessionClient } from "@/lib/ingestion/security/require-admin";
import type { IngestionClient } from "@/lib/ingestion/storage/client";

interface FakeOptions {
  user?: { id: string } | null;
  authError?: boolean;
  authThrows?: boolean;
  adminRows?: { user_id: string }[];
  lookupError?: string;
  lookupThrows?: boolean;
}

function fakeSession(options: FakeOptions = {}) {
  const queried: string[] = [];
  const client: SessionClient = {
    auth: {
      getUser: async () => {
        if (options.authThrows) throw new Error("auth down");
        return { data: { user: options.user ?? null }, error: options.authError ? { message: "invalid jwt" } : null };
      },
    },
    from: (table) => ({
      select: () => ({
        eq: (_column, value) => ({
          maybeSingle: async () => {
            queried.push(`${table}:${value}`);
            if (options.lookupThrows) throw new Error("connection reset");
            if (options.lookupError) return { data: null, error: { message: options.lookupError } };
            return { data: (options.adminRows ?? []).find((r) => r.user_id === value) ?? null, error: null };
          },
        }),
      }),
    }),
  };
  return { sessionClient: () => client, queried };
}

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "RESOLVED";
  } catch (error) {
    return error instanceof ApiError ? error.code : `OTHER:${String(error)}`;
  }
}

const ADMIN = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const OWNER = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };

describe("requireIngestionAdmin", () => {
  it("rejects anonymous requests with 401 and never queries admin membership", async () => {
    const f = fakeSession({ user: null });
    expect(await code(requireIngestionAdmin(f))).toBe("UNAUTHORIZED");
    expect(f.queried).toEqual([]);
  });

  it("treats auth errors and auth outages as unauthenticated", async () => {
    expect(await code(requireIngestionAdmin(fakeSession({ user: ADMIN, authError: true, adminRows: [{ user_id: ADMIN.id }] })))).toBe("UNAUTHORIZED");
    expect(await code(requireIngestionAdmin(fakeSession({ authThrows: true })))).toBe("UNAUTHORIZED");
  });

  it("rejects a signed-in user who is not a platform administrator with 403", async () => {
    expect(await code(requireIngestionAdmin(fakeSession({ user: OWNER, adminRows: [{ user_id: ADMIN.id }] })))).toBe("FORBIDDEN");
  });

  it("does not treat an organization owner as a platform admin (only app_admins is consulted)", async () => {
    const f = fakeSession({ user: OWNER, adminRows: [] });
    expect(await code(requireIngestionAdmin(f))).toBe("FORBIDDEN");
    expect(f.queried).toEqual([`app_admins:${OWNER.id}`]);
  });

  it("accepts an actual platform administrator", async () => {
    await expect(requireIngestionAdmin(fakeSession({ user: ADMIN, adminRows: [{ user_id: ADMIN.id }] }))).resolves.toEqual({ userId: ADMIN.id });
  });

  it("fails closed when the lookup errors or throws", async () => {
    expect(await code(requireIngestionAdmin(fakeSession({ user: ADMIN, lookupError: "rls" })))).toBe("INTERNAL_ERROR");
    expect(await code(requireIngestionAdmin(fakeSession({ user: ADMIN, lookupThrows: true })))).toBe("INTERNAL_ERROR");
  });

  it("fails closed when the session client cannot be created", async () => {
    expect(await code(requireIngestionAdmin({ sessionClient: () => { throw new Error("no cookies"); } }))).toBe("INTERNAL_ERROR");
  });
});

describe("withIngestionAdmin", () => {
  const elevated = {} as IngestionClient;
  const run = (session: ReturnType<typeof fakeSession>, handler = jest.fn(async () => Response.json({ ok: true })), createClient = jest.fn(() => elevated)) => {
    const route = withIngestionAdmin(handler, { ...session, createClient });
    return { route, handler, createClient };
  };
  const req = () => new Request("http://localhost/api/admin/ingestion/candidates");

  it("never creates the elevated client or runs the handler for unauthorized callers", async () => {
    for (const [options, status] of [[{ user: null }, 401], [{ user: OWNER }, 403], [{ user: ADMIN, lookupError: "x" }, 500]] as [FakeOptions, number][]) {
      const { route, handler, createClient } = run(fakeSession(options));
      const res = await route(req(), {});
      expect(res.status).toBe(status);
      expect(createClient).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    }
  });

  it("passes the admin and the elevated client to the handler after authorization", async () => {
    const { route, handler, createClient } = run(fakeSession({ user: ADMIN, adminRows: [{ user_id: ADMIN.id }] }));
    const res = await route(req(), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(200);
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.any(Request), expect.anything(), { admin: { userId: ADMIN.id }, client: elevated });
  });

  it("returns a generic 500 when the elevated client cannot be created, without leaking the reason", async () => {
    const { route } = run(fakeSession({ user: ADMIN, adminRows: [{ user_id: ADMIN.id }] }), undefined, jest.fn(() => { throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing: secret-value-123"); }));
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await route(req(), {});
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(JSON.stringify(body)).not.toMatch(/secret|SERVICE_ROLE/);
    jest.restoreAllMocks();
  });

  it("maps handler failures to JSON errors without leaking internals", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = jest.fn(async () => {
      throw new Error('relation "ingestion.candidates" does not exist; password=hunter2');
    });
    const { route } = run(fakeSession({ user: ADMIN, adminRows: [{ user_id: ADMIN.id }] }), failing);
    const res = await route(req(), {});
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ ok: false, error: { code: "INTERNAL_ERROR", message: "Internal error" } });
    expect(text).not.toMatch(/relation|hunter2|ingestion\./);
    jest.restoreAllMocks();
  });
});

describe("error mapping", () => {
  it.each<[ApiErrorCode, number]>([
    ["UNAUTHORIZED", 401],
    ["FORBIDDEN", 403],
    ["VALIDATION_ERROR", 400],
    ["NOT_FOUND", 404],
    ["CONFLICT", 409],
    ["INTERNAL_ERROR", 500],
  ])("%s -> %i with the spec JSON shape", async (errorCode, status) => {
    expect(ERROR_STATUS[errorCode]).toBe(status);
    const res = errorResponse(errorCode);
    expect(res.status).toBe(status);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: { code: errorCode, message: expect.any(String) } });
  });

  it("maps Zod failures to VALIDATION_ERROR without echoing the input", async () => {
    const parsed = z.object({ limit: z.number() }).safeParse({ limit: "secret-input" });
    if (parsed.success) throw new Error("expected failure");
    const res = toErrorResponse(parsed.error);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain("secret-input");
  });

  it("keeps ApiError messages but never logs or returns the cause to the caller", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    const res = toErrorResponse(new ApiError("INTERNAL_ERROR", undefined, { cause: "db password=hunter2" }));
    expect(JSON.stringify(await res.json())).not.toContain("hunter2");
    const conflict = toErrorResponse(new ApiError("CONFLICT", "Candidate was modified"));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ ok: false, error: { code: "CONFLICT", message: "Candidate was modified" } });
    jest.restoreAllMocks();
  });
});
