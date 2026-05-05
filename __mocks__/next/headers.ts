/**
 * Manual Jest mock for next/headers
 * Prevents "cookies() was called outside a request scope" errors in tests.
 */
const cookies = jest.fn().mockResolvedValue({
  get: jest.fn().mockReturnValue(undefined),
  set: jest.fn(),
  delete: jest.fn(),
});

const headers = jest.fn().mockResolvedValue(new Map());

module.exports = { cookies, headers };
