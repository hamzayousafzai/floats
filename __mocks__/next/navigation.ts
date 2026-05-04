/**
 * Manual Jest mock for next/navigation
 */
const redirect = jest.fn((_url) => {
  throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT" });
});

const useRouter = jest.fn(() => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }));
const usePathname = jest.fn(() => "/");
const useSearchParams = jest.fn(() => new URLSearchParams());

module.exports = { redirect, useRouter, usePathname, useSearchParams };
