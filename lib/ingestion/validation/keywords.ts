/**
 * Deterministic phrase lists for market classification (spec 6.3). Every pattern is anchored on word boundaries and
 * matched case-insensitively against already-cleaned display text. No network or model dependency.
 */

const word = (source: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, "iu");

export interface KeywordRule {
  label: string;
  pattern: RegExp;
}

export const POSITIVE_RULES: readonly KeywordRule[] = [
  { label: "makers market", pattern: word("makers?['’]?s?[\\s-]+(?:market|fair)") },
  { label: "artisan market", pattern: word("artisans?['’]?s?[\\s-]+(?:market|fair)") },
  { label: "vendor market", pattern: word("vendors?['’]?s?[\\s-]+market") },
  { label: "vintage market", pattern: word("vintage[\\s-]+(?:market|fair)") },
  { label: "craft fair", pattern: word("craft(?:s|ers)?[\\s-]+(?:fair|show|market)") },
  { label: "flea market", pattern: word("flea[\\s-]+market") },
  { label: "farmers market", pattern: word("farm(?:er|ers)['’]?s?[\\s-]+market") },
  { label: "holiday market", pattern: word("(?:holiday|christmas|winter|spring|summer|fall|autumn)[\\s-]+(?:makers?[\\s-]+)?market") },
  { label: "night market", pattern: word("night[\\s-]+market") },
  { label: "pop-up market", pattern: word("pop[\\s-]?up[\\s-]+(?:market|marketplace)") },
  { label: "handmade market", pattern: word("handmade[\\s-]+(?:market|fair)") },
  { label: "shop local", pattern: word("shop[\\s-]+local") },
];

/** Category slugs that on their own indicate the source classifies the event as a market. */
export const POSITIVE_CATEGORY_SLUGS: ReadonlySet<string> = new Set([
  "market",
  "markets",
  "makers-market",
  "farmers-market",
  "flea-market",
  "craft-fair",
  "craft-market",
  "vintage-market",
  "artisan-market",
  "holiday-market",
  "vendor-market",
  "night-market",
  "pop-up-market",
]);

export const NEGATIVE_RULES: readonly KeywordRule[] = [
  { label: "yoga", pattern: word("yoga|pilates") },
  { label: "workshop", pattern: word("workshops?|classes|class|seminar|lessons?") },
  { label: "karaoke", pattern: word("karaoke|open[\\s-]+mic") },
  { label: "trivia", pattern: word("trivia|bingo") },
  { label: "networking", pattern: word("networking|mixer|business[\\s-]+after[\\s-]+hours") },
  { label: "concert", pattern: word("concerts?|live[\\s-]+music|dj[\\s-]+set|tribute[\\s-]+band|tour[\\s-]+stop") },
  { label: "single-store promotion", pattern: word("grand[\\s-]+opening|trunk[\\s-]+show|sidewalk[\\s-]+sale|storewide|store[\\s-]+sale|pop[\\s-]?up[\\s-]+shop|\\d{1,3}%[\\s-]+off|ribbon[\\s-]+cutting") },
];

export const CANCELLATION_PATTERN: RegExp = word("cancell?ed|postponed|called[\\s-]+off|rescheduled[\\s-]+tba");
