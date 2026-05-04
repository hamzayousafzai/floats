/**
 * @jest-environment node
 *
 * signOut - server action unit tests
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

jest.mock("next/navigation");
jest.mock("next/headers");
jest.mock("@supabase/ssr", () => ({
  createServerClient: jest.fn(),
}));

import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import * as nav from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { signOut } from "@/app/actions/logout";

const mockCreateClient = jest.mocked(createServerClient);

function makeClient() {
  return {
    auth: { signOut: jest.fn().mockResolvedValue({ error: null }) },
  };
}

let client: ReturnType<typeof makeClient>;

beforeEach(() => {
  jest.clearAllMocks();
  client = makeClient();
  mockCreateClient.mockReturnValue(client as never);
});

describe("signOut", () => {
  it("calls supabase.auth.signOut()", async () => {
    await expect(signOut()).rejects.toMatchObject({ digest: "NEXT_REDIRECT" });
    expect(client.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("redirects to '/' by default", async () => {
    await expect(signOut()).rejects.toMatchObject({ digest: "NEXT_REDIRECT" });
    expect(nav.redirect).toHaveBeenCalledWith("/");
  });

  it("redirects to the provided 'next' path", async () => {
    await expect(signOut("/explore")).rejects.toMatchObject({ digest: "NEXT_REDIRECT" });
    expect(nav.redirect).toHaveBeenCalledWith("/explore");
  });
});
