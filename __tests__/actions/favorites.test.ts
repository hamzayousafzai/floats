/**
 * @jest-environment node
 *
 * toggleFavorite - server action unit tests
 */

// Set env vars before any imports
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

jest.mock("next/navigation", () => ({
  redirect: jest.fn((_url) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT" });
  }),
}));

jest.mock("next/cache", () => ({
  revalidatePath: jest.fn(),
}));

jest.mock("next/headers", () => ({
  cookies: jest.fn<(...args: any[]) => any>().mockResolvedValue({
    get: jest.fn().mockReturnValue(undefined),
  }),
}));

jest.mock("@supabase/ssr", () => ({
  createServerClient: jest.fn(),
}));

import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import * as nav from "next/navigation";
import * as cache from "next/cache";
import { createServerClient } from "@supabase/ssr";
import { toggleFavorite } from "@/app/actions/favorites";

const mockCreateClient = jest.mocked(createServerClient);

const VENDOR_ID = "vendor-abc";
const USER_ID = "user-123";

function makeClient() {
  const maybeSingle = jest.fn<(...args: any[]) => any>().mockResolvedValue({ data: null, error: null });
  const qb: Record<string, jest.Mock<(...args: any[]) => any>> = {
    select: jest.fn<(...args: any[]) => any>(),
    eq: jest.fn<(...args: any[]) => any>(),
    delete: jest.fn<(...args: any[]) => any>(),
    insert: jest.fn<(...args: any[]) => any>().mockResolvedValue({ error: null }),
    maybeSingle,
  };
  qb.select.mockReturnValue(qb);
  qb.eq.mockReturnValue(qb);
  qb.delete.mockReturnValue(qb);

  return {
    auth: { getUser: jest.fn<(...args: any[]) => any>().mockResolvedValue({ data: { user: null }, error: null }) },
    from: jest.fn().mockReturnValue(qb),
    _qb: qb,
  };
}

let client: ReturnType<typeof makeClient>;

beforeEach(() => {
  jest.clearAllMocks();
  client = makeClient();
  mockCreateClient.mockReturnValue(client as never);
});

describe("toggleFavorite", () => {
  describe("unauthenticated", () => {
    it("redirects to /login when no user session", async () => {
      await expect(toggleFavorite(VENDOR_ID)).rejects.toMatchObject({ digest: "NEXT_REDIRECT" });
      expect(nav.redirect).toHaveBeenCalledWith("/login");
    });
  });

  describe("authenticated - no existing favorite", () => {
    beforeEach(() => {
      client.auth.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
      client._qb.maybeSingle.mockResolvedValue({ data: null, error: null });
    });

    it("inserts a new favorite row", async () => {
      await toggleFavorite(VENDOR_ID);
      expect(client._qb.insert).toHaveBeenCalledWith({ user_id: USER_ID, vendor_id: VENDOR_ID });
    });

    it("returns { ok: true, favorited: true }", async () => {
      expect(await toggleFavorite(VENDOR_ID)).toEqual({ ok: true, favorited: true });
    });

    it("always revalidates /profile", async () => {
      await toggleFavorite(VENDOR_ID);
      expect(cache.revalidatePath).toHaveBeenCalledWith("/profile");
    });

    it("revalidates additional paths passed in revalidate arg", async () => {
      await toggleFavorite(VENDOR_ID, ["/vendor/test", "/explore"]);
      expect(cache.revalidatePath).toHaveBeenCalledWith("/vendor/test");
      expect(cache.revalidatePath).toHaveBeenCalledWith("/explore");
    });
  });

  describe("authenticated - existing favorite", () => {
    beforeEach(() => {
      client.auth.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
      client._qb.maybeSingle.mockResolvedValue({ data: { user_id: USER_ID, vendor_id: VENDOR_ID }, error: null });
    });

    it("calls delete on the favorites table", async () => {
      await toggleFavorite(VENDOR_ID);
      expect(client._qb.delete).toHaveBeenCalled();
    });

    it("returns { ok: true, favorited: false }", async () => {
      expect(await toggleFavorite(VENDOR_ID)).toEqual({ ok: true, favorited: false });
    });
  });

  describe("error handling", () => {
    it("throws if the check query returns an error", async () => {
      client.auth.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
      client._qb.maybeSingle.mockResolvedValue({ data: null, error: { message: "DB error" } });
      await expect(toggleFavorite(VENDOR_ID)).rejects.toThrow("DB error");
    });

    it("throws if the insert returns an error", async () => {
      client.auth.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
      client._qb.maybeSingle.mockResolvedValue({ data: null, error: null });
      client._qb.insert.mockResolvedValue({ error: { message: "Insert failed" } });
      await expect(toggleFavorite(VENDOR_ID)).rejects.toThrow("Insert failed");
    });

    it("throws if the delete returns an error", async () => {
      client.auth.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
      client._qb.maybeSingle.mockResolvedValue({ data: { user_id: USER_ID, vendor_id: VENDOR_ID }, error: null });
      // Rebuild the delete chain so the terminal .eq() resolves with an error
      const deleteEq2 = jest.fn<(...args: any[]) => any>().mockResolvedValue({ error: { message: "Delete failed" } });
      const deleteEq1 = jest.fn().mockReturnValue({ eq: deleteEq2 });
      client._qb.delete.mockReturnValue({ eq: deleteEq1 });
      await expect(toggleFavorite(VENDOR_ID)).rejects.toThrow("Delete failed");
    });
  });

  describe("revalidate paths", () => {
    beforeEach(() => {
      client.auth.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
      client._qb.maybeSingle.mockResolvedValue({ data: null, error: null });
    });

    it("accepts a single string revalidate path", async () => {
      await toggleFavorite(VENDOR_ID, "/vendor/test");
      expect(cache.revalidatePath).toHaveBeenCalledWith("/vendor/test");
      expect(cache.revalidatePath).toHaveBeenCalledWith("/profile");
    });

    it("ignores empty strings in the revalidate array", async () => {
      await toggleFavorite(VENDOR_ID, ["", "/explore"]);
      expect(cache.revalidatePath).toHaveBeenCalledWith("/explore");
      expect(cache.revalidatePath).toHaveBeenCalledWith("/profile");
      // The empty string should not have been revalidated
      expect(cache.revalidatePath).not.toHaveBeenCalledWith("");
    });
  });
});
