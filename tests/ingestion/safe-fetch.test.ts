/**
 * @jest-environment node
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import {
  SafeFetchError,
  type SafeFetchDeps,
  type SafeFetchOptions,
  type TransportRequest,
  type TransportResponse,
  defaultTransport,
  resetRateLimiter,
  safeFetch,
} from "@/lib/ingestion/security/safe-fetch";
import { assertPublicAddresses, isPrivateIp, validatePublicUrl } from "@/lib/ingestion/security/url-validation";
import { RobotsChecker, parseRobots } from "@/lib/ingestion/security/robots";

const OPTIONS: SafeFetchOptions = { timeoutMs: 2000, maxResponseBytes: 1024, maxRedirects: 3, userAgent: "FloatsEventDiscovery/1.0 (+https://findfloats.com)" };

function reply(status: number, headers: Record<string, string>, body = ""): TransportResponse {
  const stream = Readable.from([Buffer.from(body)]);
  return { status, headers, body: stream, destroy: () => stream.destroy() };
}

function deps(overrides: Partial<SafeFetchDeps> = {}): Partial<SafeFetchDeps> & { requests: TransportRequest[] } {
  const requests: TransportRequest[] = [];
  return {
    requests,
    resolve: async () => ["93.184.216.34"],
    transport: async (r) => {
      requests.push(r);
      return reply(200, { "content-type": "text/html; charset=utf-8" }, "<html>ok</html>");
    },
    sleep: async () => undefined,
    ...overrides,
  };
}

beforeEach(() => resetRateLimiter());

describe("isPrivateIp / validatePublicUrl", () => {
  it.each([
    "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "127.255.255.254", "169.254.169.254", "172.16.0.1", "172.31.255.255",
    "192.168.1.1", "198.18.0.1", "224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255",
    "::", "::1", "fe80::1", "fc00::1", "fd00:ec2::254", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1",
    "64:ff9b::7f00:1", "2002:7f00:1::1", "2001:db8::1", "[::1]", "not-an-ip",
  ])("treats %s as private/reserved", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "100.63.255.255", "2606:2800:220:1:248:1893:25c8:1946", "::ffff:8.8.8.8"])("allows public %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });

  it.each([
    "ftp://example.com/", "file:///etc/passwd", "javascript:alert(1)", "http://user:pass@example.com/", "http://localhost/",
    "http://LOCALHOST:3000/", "http://foo.localhost/", "http://127.0.0.1/", "http://2130706433/", "http://0x7f.1/", "http://017700000001/",
    "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://169.254.169.254/latest/meta-data/", "http://metadata.google.internal/",
    "http://intranet/", "http://printer.local/", "http://10.0.0.1:8080/", "not a url", "",
  ])("rejects %s", (url) => {
    expect(() => validatePublicUrl(url)).toThrow();
  });

  it("accepts ordinary public URLs", () => {
    expect(validatePublicUrl("https://www.example.com/events?x=1").hostname).toBe("www.example.com");
    expect(validatePublicUrl("http://93.184.216.34/").hostname).toBe("93.184.216.34");
  });

  it("rejects empty and mixed DNS answers", () => {
    expect(() => assertPublicAddresses([])).toThrow();
    expect(() => assertPublicAddresses(["93.184.216.34", "10.0.0.5"])).toThrow();
    expect(() => assertPublicAddresses(["93.184.216.34", "2606:2800:220:1::1"])).not.toThrow();
  });
});

describe("safeFetch", () => {
  it("fetches a good public HTTPS page and pins the connection to the validated address", async () => {
    const d = deps();
    const result = await safeFetch("https://www.example.com/markets", OPTIONS, d);
    expect(result).toMatchObject({ status: 200, contentType: "text/html", body: "<html>ok</html>", finalUrl: "https://www.example.com/markets", etag: null });
    expect(d.requests).toHaveLength(1);
    expect(d.requests[0].address).toBe("93.184.216.34");
    expect(d.requests[0].headers["user-agent"]).toBe(OPTIONS.userAgent);
    expect(d.requests[0].headers.cookie).toBeUndefined();
    expect(d.requests[0].headers.authorization).toBeUndefined();
  });

  it("rejects unsafe URLs before making any DNS lookup or request", async () => {
    const resolve = jest.fn();
    const d = deps({ resolve });
    for (const url of ["http://127.0.0.1/", "http://localhost/", "ftp://example.com/", "https://u:p@example.com/", "http://169.254.169.254/"]) {
      await expect(safeFetch(url, OPTIONS, d)).rejects.toMatchObject({ code: "UNSAFE_URL" });
    }
    expect(resolve).not.toHaveBeenCalled();
    expect(d.requests).toHaveLength(0);
  });

  it("rejects a hostname that resolves to a private address", async () => {
    const d = deps({ resolve: async () => ["10.0.0.7"] });
    await expect(safeFetch("https://internal-looking.example.com/", OPTIONS, d)).rejects.toMatchObject({ code: "UNSAFE_URL" });
    expect(d.requests).toHaveLength(0);
  });

  it("rejects a redirect to a private IP and never contacts it", async () => {
    const d = deps({
      transport: async (r) => {
        d.requests.push(r);
        return reply(302, { location: "http://192.168.0.10/admin" });
      },
    });
    await expect(safeFetch("https://www.example.com/", OPTIONS, d)).rejects.toMatchObject({ code: "UNSAFE_URL" });
    expect(d.requests).toHaveLength(1);
  });

  it("rejects redirects to metadata, localhost and non-HTTP schemes", async () => {
    for (const location of ["http://169.254.169.254/latest/meta-data", "http://localhost:8080/", "file:///etc/passwd", "http://[::1]/"]) {
      const d = deps({ transport: async () => reply(301, { location }) });
      await expect(safeFetch("https://www.example.com/", OPTIONS, d)).rejects.toMatchObject({ code: "UNSAFE_URL" });
    }
  });

  it("re-resolves and validates every redirect hop (DNS rebinding on the second host)", async () => {
    const answers: Record<string, string[]> = { "www.example.com": ["93.184.216.34"], "rebind.example.net": ["127.0.0.1"] };
    const d = deps({
      resolve: async (host) => answers[host] ?? [],
      transport: async () => reply(302, { location: "https://rebind.example.net/evil" }),
    });
    await expect(safeFetch("https://www.example.com/", OPTIONS, d)).rejects.toMatchObject({ code: "UNSAFE_URL" });
  });

  it("pins to the first validated answer: a later DNS change cannot redirect the connection", async () => {
    let lookups = 0;
    const d = deps({
      resolve: async () => {
        lookups += 1;
        return lookups === 1 ? ["93.184.216.34"] : ["127.0.0.1"];
      },
    });
    await safeFetch("https://www.example.com/", OPTIONS, d);
    expect(lookups).toBe(1);
    expect(d.requests[0].address).toBe("93.184.216.34");
  });

  it("follows safe redirects up to the limit and then stops", async () => {
    let n = 0;
    const d = deps({ transport: async () => (n++ < 2 ? reply(302, { location: `/page${n}` }) : reply(200, { "content-type": "text/html" }, "done")) });
    expect((await safeFetch("https://www.example.com/", OPTIONS, d)).finalUrl).toBe("https://www.example.com/page2");
    const loop = deps({ transport: async () => reply(302, { location: "/again" }) });
    await expect(safeFetch("https://www.example.com/", OPTIONS, loop)).rejects.toMatchObject({ code: "TOO_MANY_REDIRECTS" });
  });

  it("rejects overly large bodies, by header and by streamed bytes", async () => {
    const declared = deps({ transport: async () => reply(200, { "content-type": "text/html", "content-length": "999999" }, "x") });
    await expect(safeFetch("https://www.example.com/", OPTIONS, declared)).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
    const streamed = deps({ transport: async () => reply(200, { "content-type": "text/html" }, "y".repeat(5000)) });
    await expect(safeFetch("https://www.example.com/", OPTIONS, streamed)).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });

  it("times out when the transport never answers", async () => {
    const d = deps({
      transport: (r) => new Promise((_resolve, reject) => r.signal.addEventListener("abort", () => reject(new Error("aborted")))),
    });
    await expect(safeFetch("https://www.example.com/", { ...OPTIONS, timeoutMs: 50 }, d)).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("rejects wrong content types, compression and error statuses", async () => {
    const img = deps({ transport: async () => reply(200, { "content-type": "image/png" }, "x") });
    await expect(safeFetch("https://www.example.com/", OPTIONS, img)).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT_TYPE" });
    const gz = deps({ transport: async () => reply(200, { "content-type": "text/html", "content-encoding": "gzip" }, "x") });
    await expect(safeFetch("https://www.example.com/", OPTIONS, gz)).rejects.toMatchObject({ code: "UNSUPPORTED_ENCODING" });
    for (const status of [403, 404, 429, 500]) {
      const bad = deps({ transport: async () => reply(status, { "content-type": "text/html" }, "nope") });
      await expect(safeFetch("https://www.example.com/", OPTIONS, bad)).rejects.toMatchObject({ code: "HTTP_ERROR", status });
    }
  });

  it("returns validators and respects the crawl delay per origin", async () => {
    let clock = 1000;
    const sleeps: number[] = [];
    const d = deps({
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
      transport: async () => reply(200, { "content-type": "text/calendar", etag: '"abc"', "last-modified": "Wed, 01 Jan 2031 00:00:00 GMT" }, "BEGIN:VCALENDAR"),
    });
    const options = { ...OPTIONS, minDelayMs: 2000 };
    const first = await safeFetch("https://www.example.com/a", options, d);
    expect(first.etag).toBe('"abc"');
    expect(first.lastModified).toContain("2031");
    await safeFetch("https://www.example.com/b", options, d);
    await safeFetch("https://other.example.org/c", options, d);
    expect(sleeps).toEqual([2000]);
  });

  it("never reports internal details in error messages", async () => {
    const d = deps({ transport: async () => Promise.reject(new Error("connect ECONNREFUSED 10.0.0.1:443 secret-token")) });
    const error = await safeFetch("https://www.example.com/", OPTIONS, d).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SafeFetchError);
    expect((error as Error).message).not.toContain("secret-token");
  });
});

describe("real network layer (local server only)", () => {
  let server: http.Server;
  let port: number;
  let connections = 0;
  let lastHost: string | undefined;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      lastHost = req.headers.host;
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("pinned ok");
    });
    server.on("connection", () => {
      connections += 1;
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("default pipeline refuses to connect to a loopback server", async () => {
    connections = 0;
    await expect(safeFetch(`http://127.0.0.1:${port}/`, OPTIONS)).rejects.toMatchObject({ code: "UNSAFE_URL" });
    await expect(safeFetch(`http://localhost:${port}/`, OPTIONS)).rejects.toMatchObject({ code: "UNSAFE_URL" });
    expect(connections).toBe(0);
  });

  it("transport connects to the pinned address regardless of the hostname's own DNS", async () => {
    const controller = new AbortController();
    const response = await defaultTransport({
      url: new URL(`http://pinned.example.test:${port}/x`),
      address: "127.0.0.1",
      family: 4,
      headers: { "user-agent": "t" },
      signal: controller.signal,
    });
    const chunks: Buffer[] = [];
    for await (const c of response.body) chunks.push(Buffer.from(c));
    expect(Buffer.concat(chunks).toString()).toBe("pinned ok");
    expect(lastHost).toBe(`pinned.example.test:${port}`);
  });
});

describe("robots", () => {
  const SQUARESPACE = `User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: *\nDisallow: /config\nDisallow: /search\nDisallow:/*?format=ical\nDisallow:/*&format=ical\nDisallow:/*?format=json\n`;
  const ua = "FloatsEventDiscovery/1.0 (+https://findfloats.com)";

  it("applies wildcard groups, wildcards and longest-match precedence", () => {
    const p = parseRobots(SQUARESPACE, ua);
    expect(p.isAllowed("/calendar")).toBe(true);
    expect(p.isAllowed("/calendar?format=ical")).toBe(false);
    expect(p.isAllowed("/calendar?view=1&format=ical")).toBe(false);
    expect(p.isAllowed("/search")).toBe(false);
    const nested = parseRobots("User-agent: *\nDisallow: /private\nAllow: /private/public\n", ua);
    expect(nested.isAllowed("/private/x")).toBe(false);
    expect(nested.isAllowed("/private/public/x")).toBe(true);
  });

  it("prefers a group naming this crawler and reads crawl delay", () => {
    const text = "User-agent: *\nDisallow: /\n\nUser-agent: FloatsEventDiscovery\nCrawl-delay: 5\nAllow: /\n";
    const p = parseRobots(text, ua);
    expect(p.isAllowed("/anything")).toBe(true);
    expect(p.crawlDelayMs).toBe(5000);
  });

  it("supports $ anchors and ignores comments", () => {
    const p = parseRobots("User-agent: * # all\nDisallow: /*.pdf$ # docs\n", ua);
    expect(p.isAllowed("/a.pdf")).toBe(false);
    expect(p.isAllowed("/a.pdf?x=1")).toBe(true);
  });

  it("fails closed when robots cannot be established, and opens for a missing file", async () => {
    const make = (status: number | "network") =>
      new RobotsChecker(OPTIONS, async () => {
        if (status === "network") throw new SafeFetchError("NETWORK_ERROR", "x");
        throw new SafeFetchError("HTTP_ERROR", "x", status);
      });
    expect(await make(404).isAllowed("https://a.example/x")).toBe(true);
    expect(await make(403).isAllowed("https://a.example/x")).toBe(false);
    expect(await make(500).isAllowed("https://a.example/x")).toBe(false);
    expect(await make("network").isAllowed("https://a.example/x")).toBe(false);
  });

  it("caches one robots fetch per origin", async () => {
    const fetcher = jest.fn(async () => ({ status: 200, body: "User-agent: *\nDisallow: /no\n" }));
    const checker = new RobotsChecker(OPTIONS, fetcher);
    expect(await checker.isAllowed("https://a.example/yes")).toBe(true);
    expect(await checker.isAllowed("https://a.example/no")).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
