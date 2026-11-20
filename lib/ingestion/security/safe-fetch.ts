import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { assertPublicAddresses, validatePublicUrl } from "./url-validation";

export interface SafeFetchOptions {
  timeoutMs: number;
  maxResponseBytes: number;
  maxRedirects: number;
  userAgent: string;
  /** Minimum gap between requests to the same origin (crawl delay). Defaults to 0. */
  minDelayMs?: number;
  /** Lowercase media types accepted for the final response. */
  allowedContentTypes?: readonly string[];
  /** Extra request headers (for example `Accept`). Credentials and cookies are never sent. */
  accept?: string;
}

export interface SafeFetchResult {
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
  etag: string | null;
  lastModified: string | null;
}

export type SafeFetchErrorCode =
  | "UNSAFE_URL"
  | "TOO_MANY_REDIRECTS"
  | "TIMEOUT"
  | "RESPONSE_TOO_LARGE"
  | "UNSUPPORTED_CONTENT_TYPE"
  | "UNSUPPORTED_ENCODING"
  | "HTTP_ERROR"
  | "NETWORK_ERROR";

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;
  readonly status: number | null;

  constructor(code: SafeFetchErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = "SafeFetchError";
    this.code = code;
    this.status = status;
  }
}

export interface TransportRequest {
  url: URL;
  /** Pre-validated IP the connection must be made to (connection pinning). */
  address: string;
  family: 4 | 6;
  headers: Record<string, string>;
  signal: AbortSignal;
}

export interface TransportResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
  destroy(): void;
}

export interface SafeFetchDeps {
  resolve(hostname: string): Promise<string[]>;
  transport(request: TransportRequest): Promise<TransportResponse>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

const DEFAULT_CONTENT_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "text/calendar",
  "application/json",
  "application/ld+json",
  "application/xml",
  "text/xml",
  "text/plain",
];

const originLastRequest = new Map<string, number>();

/** Test hook: clears the per-origin rate limiter state. */
export function resetRateLimiter(): void {
  originLastRequest.clear();
}

export async function defaultResolve(hostname: string): Promise<string[]> {
  const records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return records.map((r) => r.address);
}

/** Default transport. Connections are pinned to the already validated address, so DNS cannot change between check and use. */
export function defaultTransport(request: TransportRequest): Promise<TransportResponse> {
  return new Promise((resolve, reject) => {
    const client = request.url.protocol === "https:" ? https : http;
    const req = client.request(
      {
        protocol: request.url.protocol,
        hostname: request.url.hostname.replace(/^\[|\]$/g, ""),
        port: request.url.port || undefined,
        path: `${request.url.pathname}${request.url.search}`,
        method: "GET",
        headers: request.headers,
        servername: isIP(request.url.hostname.replace(/^\[|\]$/g, "")) ? undefined : request.url.hostname,
        agent: false,
        signal: request.signal,
        lookup: (_host, _options, callback) => {
          // The callback signature differs when `all` is requested; support both.
          const opts = _options as { all?: boolean };
          if (opts && opts.all) (callback as unknown as (e: Error | null, a: { address: string; family: number }[]) => void)(null, [{ address: request.address, family: request.family }]);
          else (callback as unknown as (e: Error | null, a: string, f: number) => void)(null, request.address, request.family);
        },
      },
      (res) => {
        const headers: Record<string, string | undefined> = {};
        for (const [k, v] of Object.entries(res.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
        resolve({ status: res.statusCode ?? 0, headers, body: res, destroy: () => res.destroy() });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const defaultDeps: SafeFetchDeps = {
  resolve: defaultResolve,
  transport: defaultTransport,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
};

function mediaType(header: string | undefined): string {
  return (header ?? "").split(";")[0].trim().toLowerCase();
}

function charsetOf(header: string | undefined): string {
  const match = /charset\s*=\s*"?([^;"\s]+)/i.exec(header ?? "");
  return match ? match[1].toLowerCase() : "utf-8";
}

async function readBody(response: TransportResponse, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) {
    response.destroy();
    throw new SafeFetchError("RESPONSE_TOO_LARGE", "Response exceeds the maximum allowed size");
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      response.destroy();
      throw new SafeFetchError("RESPONSE_TOO_LARGE", "Response exceeds the maximum allowed size");
    }
    chunks.push(chunk);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function decode(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/**
 * Fetches a public web page safely: validates every URL (including each redirect hop) before connecting,
 * resolves DNS itself and pins the connection to a validated public address, streams with a byte cap,
 * enforces timeout, content type and a per-origin delay. It never follows credentials, cookies or logins.
 * Robots and access rules are enforced by the caller (see robots.ts) before invoking this function.
 */
export async function safeFetch(url: string, options: SafeFetchOptions, deps: Partial<SafeFetchDeps> = {}): Promise<SafeFetchResult> {
  const d: SafeFetchDeps = { ...defaultDeps, ...deps };
  const allowed = (options.allowedContentTypes ?? DEFAULT_CONTENT_TYPES).map((t) => t.toLowerCase());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const headers: Record<string, string> = {
    "user-agent": options.userAgent,
    accept: options.accept ?? "text/html,application/xhtml+xml,application/ld+json,application/json,text/calendar;q=0.9,*/*;q=0.1",
    "accept-encoding": "identity",
  };

  try {
    let current = url;
    for (let hop = 0; hop <= options.maxRedirects; hop += 1) {
      let parsed: URL;
      try {
        parsed = validatePublicUrl(current);
      } catch (error) {
        throw new SafeFetchError("UNSAFE_URL", error instanceof Error ? error.message : "Unsafe URL");
      }
      const bareHost = parsed.hostname.replace(/^\[|\]$/g, "");
      let addresses: string[];
      try {
        addresses = isIP(bareHost) ? [bareHost] : await d.resolve(bareHost);
        assertPublicAddresses(addresses);
      } catch (error) {
        if (error instanceof Error && error.name === "UnsafeUrlError") throw new SafeFetchError("UNSAFE_URL", error.message);
        throw new SafeFetchError("NETWORK_ERROR", "DNS resolution failed");
      }

      const minDelay = options.minDelayMs ?? 0;
      if (minDelay > 0) {
        const last = originLastRequest.get(parsed.origin);
        if (last !== undefined) {
          const wait = last + minDelay - d.now();
          if (wait > 0) await d.sleep(wait);
        }
      }
      originLastRequest.set(parsed.origin, d.now());

      let response: TransportResponse;
      try {
        response = await d.transport({ url: parsed, address: addresses[0], family: isIP(addresses[0]) === 6 ? 6 : 4, headers, signal: controller.signal });
      } catch (error) {
        if (controller.signal.aborted) throw new SafeFetchError("TIMEOUT", "Request timed out");
        throw new SafeFetchError("NETWORK_ERROR", error instanceof Error && error.name === "UnsafeUrlError" ? error.message : "Network request failed");
      }

      if (response.status >= 300 && response.status < 400 && response.headers.location) {
        response.destroy();
        if (hop === options.maxRedirects) throw new SafeFetchError("TOO_MANY_REDIRECTS", "Too many redirects");
        try {
          current = new URL(response.headers.location, parsed).toString();
        } catch {
          throw new SafeFetchError("UNSAFE_URL", "Invalid redirect target");
        }
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        response.destroy();
        throw new SafeFetchError("HTTP_ERROR", `Unexpected HTTP status ${response.status}`, response.status);
      }
      const encoding = (response.headers["content-encoding"] ?? "identity").toLowerCase();
      if (encoding !== "identity") {
        response.destroy();
        throw new SafeFetchError("UNSUPPORTED_ENCODING", "Compressed responses are not accepted");
      }
      const type = mediaType(response.headers["content-type"]);
      if (!allowed.includes(type)) {
        response.destroy();
        throw new SafeFetchError("UNSUPPORTED_CONTENT_TYPE", `Unsupported content type: ${type || "missing"}`);
      }
      let bytes: Uint8Array;
      try {
        bytes = await readBody(response, options.maxResponseBytes);
      } catch (error) {
        if (error instanceof SafeFetchError) throw error;
        if (controller.signal.aborted) throw new SafeFetchError("TIMEOUT", "Request timed out");
        throw new SafeFetchError("NETWORK_ERROR", "Failed to read response");
      }
      return {
        finalUrl: parsed.toString(),
        status: response.status,
        contentType: type,
        body: decode(bytes, charsetOf(response.headers["content-type"])),
        etag: response.headers.etag ?? null,
        lastModified: response.headers["last-modified"] ?? null,
      };
    }
    throw new SafeFetchError("TOO_MANY_REDIRECTS", "Too many redirects");
  } finally {
    clearTimeout(timer);
  }
}
