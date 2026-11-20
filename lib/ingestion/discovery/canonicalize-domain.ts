import { validatePublicUrl } from "@/lib/ingestion/security/url-validation";

/**
 * Platforms whose terms or technical controls forbid automated collection (login walls, anti-bot systems, API-only
 * access). They are recorded as `restricted` and never fetched or registered.
 */
const RESTRICTED_DOMAINS: Readonly<Record<string, string>> = {
  "facebook.com": "Platform requires login and forbids automated access",
  "fb.com": "Platform requires login and forbids automated access",
  "instagram.com": "Platform requires login and forbids automated access",
  "x.com": "Platform requires login and forbids automated access",
  "twitter.com": "Platform requires login and forbids automated access",
  "tiktok.com": "Platform requires login and forbids automated access",
  "linkedin.com": "Platform requires login and forbids automated access",
  "pinterest.com": "Platform requires login and forbids automated access",
  "eventbrite.com": "Platform terms forbid scraping; API access only",
  "meetup.com": "Platform terms forbid scraping; API access only",
  "ticketmaster.com": "Platform terms forbid scraping",
  "google.com": "Search and map pages must not be crawled",
  "goo.gl": "URL shortener",
  "bit.ly": "URL shortener",
  "linktr.ee": "Link aggregator; not an event source",
};

/** Hosts that carry no events of their own (analytics, CDNs, widgets, payment). Skipped silently as not candidates. */
const IGNORED_DOMAINS: ReadonlySet<string> = new Set([
  "youtube.com", "youtu.be", "vimeo.com", "paypal.com", "venmo.com", "gstatic.com", "googleapis.com", "cloudflare.com",
  "squarespace.com", "wix.com", "wordpress.org", "wordpress.com", "apple.com", "apps.apple.com", "play.google.com", "mailchi.mp", "mailchimp.com",
]);

/** Lowercase host without a leading `www.` or trailing dot. Not a public-suffix lookup; it only dedupes the common `www.` variant. */
export function canonicalDomain(url: string): string {
  const host = new URL(url).hostname.replace(/\.$/, "").toLowerCase();
  return host.startsWith("www.") ? host.slice(4) : host;
}

function matchesDomain(domain: string, table: Iterable<string>): string | null {
  for (const entry of table) {
    if (domain === entry || domain.endsWith(`.${entry}`)) return entry;
  }
  return null;
}

/** Returns the reason a domain must never be crawled, or null. */
export function restrictedReason(url: string): string | null {
  const domain = canonicalDomain(url);
  const entry = matchesDomain(domain, Object.keys(RESTRICTED_DOMAINS));
  return entry ? RESTRICTED_DOMAINS[entry] : null;
}

export function isIgnoredDomain(url: string): boolean {
  return matchesDomain(canonicalDomain(url), IGNORED_DOMAINS) !== null;
}

/** True when the URL is syntactically safe to fetch (public host, http/https, no credentials). Does not resolve DNS. */
export function isSafeCandidateUrl(url: string): boolean {
  try {
    validatePublicUrl(url);
    return true;
  } catch {
    return false;
  }
}

export function isSameSite(a: string, b: string): boolean {
  try {
    return canonicalDomain(a) === canonicalDomain(b);
  } catch {
    return false;
  }
}
