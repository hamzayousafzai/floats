/**
 * Shared Supabase mock factory.
 *
 * Usage in a test file:
 *
 *   import { mockSupabaseClient, mockAdminClient } from "@/__tests__/__mocks__/supabase";
 *
 *   jest.mock("@/lib/supabase/server", () => ({
 *     createSupabaseServer: jest.fn(() => mockSupabaseClient),
 *   }));
 *
 *   jest.mock("@/lib/supabase/admin", () => ({
 *     createSupabaseAdmin: jest.fn(() => mockAdminClient),
 *   }));
 *
 * Then in your tests, manipulate the mocks before calling the route handler:
 *
 *   mockSupabaseClient.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
 */

import { jest } from "@jest/globals";

function makeQueryBuilder() {
  const builder: Record<string, jest.Mock<(...args: any[]) => any>> = {};

  const methods = [
    "select",
    "insert",
    "update",
    "delete",
    "upsert",
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "in",
    "is",
    "order",
    "limit",
    "single",
    "maybeSingle",
    "match",
    "filter",
  ];

  for (const m of methods) {
    builder[m] = jest.fn<() => any>(() => builder);
  }

  // Default terminal resolution — tests override as needed
  builder["single"].mockResolvedValue({ data: null, error: null });
  builder["maybeSingle"].mockResolvedValue({ data: null, error: null });
  // Awaiting the builder itself resolves as a successful query
  (builder as unknown as Promise<{ data: unknown; error: null }>).then = jest
    .fn<() => any>()
    .mockImplementation(
      ((resolve: (v: { data: unknown[]; error: null }) => void) =>
        resolve({ data: [], error: null })) as () => any
    ) as never;

  return builder;
}

function makeStorageBucket() {
  return {
    upload: jest.fn<(...args: any[]) => any>().mockResolvedValue({ data: { path: "test.jpg" }, error: null }),
    getPublicUrl: jest.fn().mockReturnValue({ data: { publicUrl: "https://example.com/test.jpg" } }),
    remove: jest.fn<(...args: any[]) => any>().mockResolvedValue({ data: null, error: null }),
  };
}

export function makeMockSupabaseClient() {
  const queryBuilder = makeQueryBuilder();

  return {
    auth: {
      getUser: jest.fn<(...args: any[]) => any>().mockResolvedValue({ data: { user: null }, error: null }),
      getSession: jest.fn<(...args: any[]) => any>().mockResolvedValue({ data: { session: null }, error: null }),
      signOut: jest.fn<(...args: any[]) => any>().mockResolvedValue({ error: null }),
    },
    from: jest.fn(() => queryBuilder),
    rpc: jest.fn<(...args: any[]) => any>().mockResolvedValue({ data: null, error: null }),
    storage: {
      from: jest.fn(() => makeStorageBucket()),
    },
    _queryBuilder: queryBuilder,
  };
}

export function makeMockAdminClient() {
  const queryBuilder = makeQueryBuilder();

  return {
    from: jest.fn(() => queryBuilder),
    rpc: jest.fn<(...args: any[]) => any>().mockResolvedValue({ data: null, error: null }),
    storage: {
      from: jest.fn(() => makeStorageBucket()),
    },
    _queryBuilder: queryBuilder,
  };
}

/** Pre-built instances — tests can import and manipulate directly */
export const mockSupabaseClient = makeMockSupabaseClient();
export const mockAdminClient = makeMockAdminClient();

/** Helper: reset all mocks on both clients. Call in beforeEach. */
export function resetSupabaseMocks() {
  jest.clearAllMocks();

  // Restore default auth state (unauthenticated)
  mockSupabaseClient.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
  mockSupabaseClient.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  mockSupabaseClient.auth.signOut.mockResolvedValue({ error: null });
  mockSupabaseClient.rpc.mockResolvedValue({ data: null, error: null });
  mockAdminClient.rpc.mockResolvedValue({ data: null, error: null });

  // Reset from() to return query builder
  mockSupabaseClient.from.mockReturnValue(mockSupabaseClient._queryBuilder);
  mockAdminClient.from.mockReturnValue(mockAdminClient._queryBuilder);

  // Reset query builder terminals
  mockSupabaseClient._queryBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
  mockSupabaseClient._queryBuilder.single.mockResolvedValue({ data: null, error: null });
  mockAdminClient._queryBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
  mockAdminClient._queryBuilder.single.mockResolvedValue({ data: null, error: null });
}

/** Helper: mock an authenticated user */
export function mockAuthUser(id = "user-123", email = "test@example.com") {
  mockSupabaseClient.auth.getUser.mockResolvedValue({
    data: { user: { id, email } },
    error: null,
  });
}
