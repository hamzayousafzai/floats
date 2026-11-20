/**
 * @jest-environment node
 */
import { ApiError } from "@/lib/ingestion/security/api-errors";

const mockRequire = jest.fn();
const mockRedirect = jest.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});
const mockNotFound = jest.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

jest.mock("next/navigation", () => ({ redirect: (p: string) => mockRedirect(p), notFound: () => mockNotFound() }));
jest.mock("@/lib/ingestion/security/require-admin", () => ({ requireIngestionAdmin: () => mockRequire() }));

import { requireAdminPage } from "@/lib/ingestion/security/require-admin-page";

beforeEach(() => jest.clearAllMocks());

describe("requireAdminPage", () => {
  it("lets administrators through", async () => {
    mockRequire.mockResolvedValue({ userId: "u" });
    await expect(requireAdminPage()).resolves.toBeUndefined();
  });
  it("sends anonymous users to login", async () => {
    mockRequire.mockRejectedValue(new ApiError("UNAUTHORIZED"));
    await expect(requireAdminPage()).rejects.toThrow("NEXT_REDIRECT:/login");
  });
  it("hides the area from signed-in non-admins", async () => {
    mockRequire.mockRejectedValue(new ApiError("FORBIDDEN"));
    await expect(requireAdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
  it("fails closed on unexpected errors", async () => {
    mockRequire.mockRejectedValue(new ApiError("INTERNAL_ERROR"));
    await expect(requireAdminPage()).rejects.toThrow();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
