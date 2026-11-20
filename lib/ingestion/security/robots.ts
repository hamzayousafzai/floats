import { SafeFetchError, safeFetch, type SafeFetchOptions } from "./safe-fetch";

export interface RobotsPolicy {
  /** False when the policy could not be established and the origin must be treated as off limits. */
  available: boolean;
  isAllowed(pathAndQuery: string): boolean;
  crawlDelayMs: number | null;
}

interface Rule {
  allow: boolean;
  pattern: string;
}
interface Group {
  agents: string[];
  rules: Rule[];
  crawlDelay: number | null;
}

function parseGroups(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "allow" || field === "disallow") {
      if (value) current.rules.push({ allow: field === "allow", pattern: value });
    } else if (field === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }
  return groups;
}

function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Robots Exclusion Protocol (RFC 9309): most specific group, longest matching rule wins, Allow wins ties. */
export function parseRobots(text: string, userAgent: string): RobotsPolicy {
  const product = userAgent.split("/")[0].trim().toLowerCase();
  const groups = parseGroups(text);
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && product.startsWith(a)));
  const chosen = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes("*"));
  const rules = chosen.flatMap((g) => g.rules);
  const delay = chosen.map((g) => g.crawlDelay).find((d) => d !== null) ?? null;
  return {
    available: true,
    crawlDelayMs: delay === null ? null : Math.round(delay * 1000),
    isAllowed(pathAndQuery: string): boolean {
      let best: { length: number; allow: boolean } | null = null;
      for (const rule of rules) {
        if (!patternToRegExp(rule.pattern).test(pathAndQuery)) continue;
        const length = rule.pattern.length;
        if (!best || length > best.length || (length === best.length && rule.allow)) best = { length, allow: rule.allow };
      }
      return best ? best.allow : true;
    },
  };
}

const DENY_ALL: RobotsPolicy = { available: false, isAllowed: () => false, crawlDelayMs: null };
const ALLOW_ALL: RobotsPolicy = { available: true, isAllowed: () => true, crawlDelayMs: null };

export type RobotsFetcher = (url: string, options: SafeFetchOptions) => Promise<{ status: number; body: string }>;

/** Per-run cache of robots policies; failures to establish a policy are treated as "do not crawl". */
export class RobotsChecker {
  private readonly cache = new Map<string, Promise<RobotsPolicy>>();

  constructor(
    private readonly options: SafeFetchOptions,
    private readonly fetcher: RobotsFetcher = (url, opts) => safeFetch(url, { ...opts, allowedContentTypes: ["text/plain", "text/html", "application/octet-stream"] }),
  ) {}

  policyFor(origin: string): Promise<RobotsPolicy> {
    let pending = this.cache.get(origin);
    if (!pending) {
      pending = this.load(origin);
      this.cache.set(origin, pending);
    }
    return pending;
  }

  async isAllowed(url: string): Promise<boolean> {
    const parsed = new URL(url);
    const policy = await this.policyFor(parsed.origin);
    return policy.isAllowed(`${parsed.pathname}${parsed.search}`);
  }

  private async load(origin: string): Promise<RobotsPolicy> {
    try {
      const result = await this.fetcher(`${origin}/robots.txt`, this.options);
      return parseRobots(result.body, this.options.userAgent);
    } catch (error) {
      if (error instanceof SafeFetchError && error.code === "HTTP_ERROR" && error.status !== null) {
        if (error.status === 404 || error.status === 410) return ALLOW_ALL;
        return DENY_ALL; // 401/403/429/5xx: access cannot be established, so do not crawl
      }
      return DENY_ALL;
    }
  }
}
