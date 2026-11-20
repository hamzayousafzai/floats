import * as cheerio from "cheerio";
import { normalizeSourceUrl } from "@/lib/ingestion/normalize/normalize-url";
import { isSameSite } from "./canonicalize-domain";

export interface ExtractedLinks {
  /** Same-site pages worth traversing (calendar, events, markets, vendors...). */
  internal: string[];
  /** Links to other sites (organizers, venues, partners). */
  external: string[];
  /** iCalendar feeds advertised by the page. */
  calendarFeeds: string[];
}

const MAX_LINKS = 500;
const TRAVERSAL_HINT = /calendar|events?|markets?|schedule|upcoming|vendors?|festivals?|fairs?/i;
const FEED_HREF = /\.ics(?:$|\?)/i;
const SKIPPED_EXTENSION = /\.(?:jpe?g|png|gif|webp|svg|pdf|zip|mp[34]|mov|css|js|ico|woff2?)(?:$|\?)/i;

function resolve(href: string | undefined, base: string): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (trimmed === "" || trimmed.startsWith("#") || /^(?:mailto|tel|javascript|sms):/i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed.replace(/^webcal:/i, "https:"), base);
    return normalizeSourceUrl(url.toString());
  } catch {
    return null;
  }
}

/** Link extraction for discovery. Output is bounded, normalized and deduplicated. */
export function extractLinks(html: string, pageUrl: string): ExtractedLinks {
  const $ = cheerio.load(html);
  const internal = new Set<string>();
  const external = new Set<string>();
  const feeds = new Set<string>();

  $('link[rel~="alternate"][type="text/calendar"]').each((_, el) => {
    const url = resolve($(el).attr("href"), pageUrl);
    if (url) feeds.add(url);
  });

  $("a[href]").each((_, el) => {
    if (internal.size + external.size + feeds.size >= MAX_LINKS) return false;
    const href = $(el).attr("href");
    const url = resolve(href, pageUrl);
    if (!url || SKIPPED_EXTENSION.test(url)) return;
    if (FEED_HREF.test(url) || /^webcal:/i.test(href?.trim() ?? "")) {
      feeds.add(url);
      return;
    }
    if (isSameSite(url, pageUrl)) {
      if (TRAVERSAL_HINT.test(new URL(url).pathname) || TRAVERSAL_HINT.test($(el).text())) internal.add(url);
    } else {
      external.add(url);
    }
  });

  internal.delete(normalizeSourceUrl(pageUrl));
  return { internal: [...internal], external: [...external], calendarFeeds: [...feeds] };
}

/** `<loc>` entries of a sitemap. Sitemap index files yield their child sitemaps; callers decide whether to follow them. */
export function parseSitemap(xml: string): { urls: string[]; isIndex: boolean } {
  const $ = cheerio.load(xml, { xml: true });
  const isIndex = $("sitemapindex").length > 0;
  const urls: string[] = [];
  $("loc").each((_, el) => {
    const url = resolve($(el).text(), "https://invalid.example/");
    if (url && urls.length < MAX_LINKS) urls.push(url);
  });
  return { urls, isIndex };
}

/** Sitemap entries that look like event or calendar pages. */
export function eventLikeUrls(urls: readonly string[]): string[] {
  return urls.filter((url) => {
    try {
      return TRAVERSAL_HINT.test(new URL(url).pathname);
    } catch {
      return false;
    }
  });
}
