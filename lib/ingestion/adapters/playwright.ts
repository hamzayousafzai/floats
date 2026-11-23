import type { CollectionResult } from "@/lib/ingestion/types";
import { assertPublicAddresses, validatePublicUrl } from "@/lib/ingestion/security/url-validation";
import { defaultResolve } from "@/lib/ingestion/security/safe-fetch";
import { collectionFailure, collectionSuccess } from "./common";
import { parseHtmlListing, readHtmlConfig } from "./html";
import type { CollectionContext, EventAdapter, SourceDefinition } from "./types";

/** Minimal structural view of the Playwright API so tests can inject a fake and `playwright` is loaded lazily. */
export interface BrowserRoute {
  request(): { url(): string; resourceType(): string };
  abort(): Promise<void>;
  continue(): Promise<void>;
}
export interface BrowserPage {
  goto(url: string, options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<unknown>;
  waitForSelector(selector: string, options: { timeout: number }): Promise<unknown>;
  content(): Promise<string>;
  url(): string;
  close(): Promise<void>;
}
export interface BrowserContext {
  route(url: string, handler: (route: BrowserRoute) => Promise<void>): Promise<void>;
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}
export interface BrowserHandle {
  newContext(options: { userAgent: string; acceptDownloads: false; serviceWorkers: "block"; javaScriptEnabled: true }): Promise<BrowserContext>;
  close(): Promise<void>;
}

export interface PlaywrightAdapterDeps {
  launch?: () => Promise<BrowserHandle>;
  resolve?: (hostname: string) => Promise<string[]>;
  userAgent: string;
  navigationTimeoutMs: number;
  maxHtmlBytes: number;
  /** Optional robots gate evaluated before the browser is started. */
  isAllowed?: (url: string) => Promise<boolean>;
}

const BLOCKED_RESOURCE_TYPES = new Set(["image", "media", "font", "websocket", "eventsource", "manifest"]);

async function defaultLaunch(): Promise<BrowserHandle> {
  const { chromium } = await import("playwright");
  return (await chromium.launch({ headless: true })) as unknown as BrowserHandle;
}

async function quietly(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch {
    // Teardown must never mask the real result.
  }
}

/**
 * Renders a JavaScript page with bounded navigation and always closes the browser.
 *
 * NOT SSRF-SAFE, therefore NOT WIRED INTO ANY WORKER. The route handler validates and resolves each request's host, but
 * Chromium then resolves the name again itself and `route.continue()` cannot pin the connection to the validated IP, so
 * DNS rebinding (and redirects chained inside the browser) can still reach private addresses. `safeFetch` pins the
 * connection; this adapter cannot. The worker scripts therefore do not register it and sources typed `playwright` fail
 * with `adapter_unavailable`. Enable only behind an egress-restricted network or proxy that blocks private/metadata
 * ranges at the network layer, with tests against that proxy.
 */
export function createPlaywrightAdapter(deps: PlaywrightAdapterDeps): EventAdapter {
  const resolve = deps.resolve ?? defaultResolve;
  const launch = deps.launch ?? defaultLaunch;
  return {
    type: "playwright",
    async collect(source: SourceDefinition, context: CollectionContext): Promise<CollectionResult> {
      let browser: BrowserHandle | null = null;
      let browserContext: BrowserContext | null = null;
      let page: BrowserPage | null = null;
      let deadline: NodeJS.Timeout | null = null;
      let finished = false;
      let workPromise: Promise<unknown> | null = null;
      try {
        const config = readHtmlConfig(source.configuration);
        const url = validatePublicUrl(source.baseUrl);
        if (deps.isAllowed && !(await deps.isAllowed(url.toString()))) throw new Error("Blocked by robots.txt");
        if (context.signal.aborted) throw new Error("Run aborted");

        const work = (async () => {
          browser = await launch();
          if (finished) {
            const late = browser;
            await quietly(() => late.close());
            throw new Error("Run ended before the browser started");
          }
          browserContext = await browser.newContext({ userAgent: deps.userAgent, acceptDownloads: false, serviceWorkers: "block", javaScriptEnabled: true });
          await browserContext.route("**/*", async (route) => {
            const request = route.request();
            if (BLOCKED_RESOURCE_TYPES.has(request.resourceType())) return route.abort();
            try {
              const target = validatePublicUrl(request.url());
              assertPublicAddresses(await resolve(target.hostname));
            } catch {
              return route.abort();
            }
            return route.continue();
          });
          page = await browserContext.newPage();
          await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: deps.navigationTimeoutMs });
          const waitFor = (source.configuration.playwright as { waitForSelector?: unknown } | undefined)?.waitForSelector;
          if (typeof waitFor === "string") await page.waitForSelector(waitFor, { timeout: deps.navigationTimeoutMs });
          const html = await page.content();
          if (Buffer.byteLength(html) > deps.maxHtmlBytes) throw new Error("Rendered page exceeds the size limit");
          return { html, finalUrl: page.url() };
        })();
        const timeout = new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(() => reject(new Error("Playwright collection timed out")), deps.navigationTimeoutMs * 2);
        });
        const aborted = new Promise<never>((_resolve, reject) => {
          context.signal.addEventListener("abort", () => reject(new Error("Run aborted")), { once: true });
        });
        // If the race is lost the work promise may still reject later; that rejection is already handled by teardown.
        work.catch(() => undefined);
        workPromise = work;
        const rendered = await Promise.race([work, timeout, aborted]);
        const parsed = parseHtmlListing(rendered.html, source, rendered.finalUrl, config);
        const warning = parsed.skipped > 0 ? `${parsed.skipped} of ${parsed.cards} cards skipped (no title)` : null;
        return collectionSuccess(source.id, parsed.events, [], warning);
      } catch (error) {
        return collectionFailure(source.id, error);
      } finally {
        finished = true;
        if (deadline) clearTimeout(deadline);
        if (workPromise) {
          await Promise.race([workPromise.catch(() => undefined), new Promise((r) => setTimeout(r, 1000))]);
        }
        const p = page as BrowserPage | null;
        const c = browserContext as BrowserContext | null;
        const b = browser as BrowserHandle | null;
        if (p) await quietly(() => p.close());
        if (c) await quietly(() => c.close());
        if (b) await quietly(() => b.close());
      }
    },
  };
}
