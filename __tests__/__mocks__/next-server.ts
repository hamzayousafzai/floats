/**
 * Helpers for testing Next.js API route handlers.
 *
 * Usage:
 *   import { makeRequest, makeJsonRequest } from "@/__tests__/__mocks__/next-server";
 *
 *   const req = makeJsonRequest("POST", "http://localhost/api/check-in", { event_id: "abc" });
 *   const res = await POST(req);
 *   const body = await res.json();
 */

/** Create a minimal NextRequest-compatible Request for GET/DELETE routes */
export function makeRequest(
  method: string,
  url: string,
  searchParams?: Record<string, string>
): Request {
  const fullUrl = searchParams
    ? `${url}?${new URLSearchParams(searchParams).toString()}`
    : url;
  return new Request(fullUrl, { method });
}

/** Create a NextRequest-compatible Request with a JSON body */
export function makeJsonRequest(
  method: string,
  url: string,
  body: unknown,
  headers?: Record<string, string>
): Request {
  return new Request(url, {
    method,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

/** Create a Request with Authorization header (for cron/bearer-token protected routes) */
export function makeBearerRequest(
  method: string,
  url: string,
  token: string
): Request {
  return new Request(url, {
    method,
    headers: { authorization: `Bearer ${token}` },
  });
}

/** Parse the JSON body from a Response without consuming it */
export async function parseJson<T = Record<string, unknown>>(
  response: Response
): Promise<T> {
  const clone = response.clone();
  return clone.json() as Promise<T>;
}
