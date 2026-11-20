export class NormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NormalizationError";
  }
}

const TRACKING_PARAMS = /^(utm_[a-z0-9_]*|fbclid|gclid|dclid|msclkid|yclid|mc_cid|mc_eid|igshid|mkt_tok|_hsenc|_hsmi|_ga|ref_src|ref_url)$/i;

/**
 * Canonical form of a source URL: http(s) only, no credentials, lowercase host, default port and fragment removed,
 * tracking parameters dropped, remaining parameters sorted, trailing slash removed (except for the root path).
 */
export function normalizeSourceUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new NormalizationError("URL is not valid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new NormalizationError("URL must use http or https");
  if (url.username || url.password) throw new NormalizationError("URL must not contain credentials");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") || "/" : url.pathname;
  const query = url.searchParams.toString();
  return `${url.protocol}//${url.host}${path}${query ? `?${query}` : ""}`;
}
