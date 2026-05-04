/**
 * Manual Jest mock for @supabase/supabase-js
 * Placed at __mocks__/@supabase/supabase-js.ts so Jest auto-applies it when
 * jest.mock("@supabase/supabase-js") is called, and ensures factory-based
 * mocks via jest.mock("@supabase/supabase-js", () => {...}) are intercepted
 * correctly in test file import scope (same pattern as @supabase/ssr).
 */
const createClient = jest.fn();

module.exports = { createClient };
