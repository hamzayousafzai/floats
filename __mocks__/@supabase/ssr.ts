/**
 * Manual Jest mock for @supabase/ssr
 * Placed at __mocks__/@supabase/ssr.ts so Jest auto-applies it when
 * jest.mock("@supabase/ssr") is called.
 */
const createServerClient = jest.fn();
const createBrowserClient = jest.fn();

module.exports = { createServerClient, createBrowserClient };
