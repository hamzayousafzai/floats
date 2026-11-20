import type { NormalizedEvent } from "@/lib/ingestion/types";
import { CANCELLATION_PATTERN, NEGATIVE_RULES, POSITIVE_CATEGORY_SLUGS, POSITIVE_RULES } from "./keywords";

export type MarketKind = "market" | "excluded" | "unclear";

export interface MarketClassification {
  kind: MarketKind;
  isMarket: boolean;
  /** Clearly not a vendor market; callers reject these. */
  excluded: boolean;
  /** 0 = none, 1 = supported by description or category only, 2 = stated in the title. */
  strength: 0 | 1 | 2;
  positives: string[];
  negatives: string[];
}

type ClassifiableEvent = Pick<NormalizedEvent, "title" | "description" | "categorySlugs">;

function matches(rules: typeof POSITIVE_RULES, text: string): string[] {
  return rules.filter((rule) => rule.pattern.test(text)).map((rule) => rule.label);
}

/**
 * Context rules (spec 6.3):
 * - A positive market phrase in the title qualifies the event even if live music, workshops, etc. are also mentioned.
 * - A negative phrase in the title with no market evidence anywhere is a clear exclusion.
 * - Negatives that appear only in the description never override market evidence.
 * - Market evidence only in the description or category slugs is accepted, but weaker.
 * - No signal at all is "unclear": neither a market nor excluded.
 */
export function classifyMarket(event: ClassifiableEvent): MarketClassification {
  const title = event.title ?? "";
  const description = event.description ?? "";
  const titlePositives = matches(POSITIVE_RULES, title);
  const descriptionPositives = matches(POSITIVE_RULES, description).filter((label) => !titlePositives.includes(label));
  const categoryPositives = event.categorySlugs.filter((slug) => POSITIVE_CATEGORY_SLUGS.has(slug)).map((slug) => `category:${slug}`);
  const positives = [...titlePositives, ...descriptionPositives, ...categoryPositives];

  const titleNegatives = matches(NEGATIVE_RULES, title);
  const descriptionNegatives = matches(NEGATIVE_RULES, description).filter((label) => !titleNegatives.includes(label));
  const negatives = [...titleNegatives, ...descriptionNegatives];

  if (titlePositives.length > 0) return { kind: "market", isMarket: true, excluded: false, strength: 2, positives, negatives };

  const supported = descriptionPositives.length > 0 || categoryPositives.length > 0;
  if (supported && titleNegatives.length === 0) return { kind: "market", isMarket: true, excluded: false, strength: 1, positives, negatives };
  if (supported) return { kind: "unclear", isMarket: false, excluded: false, strength: 0, positives, negatives };
  if (negatives.length > 0) return { kind: "excluded", isMarket: false, excluded: true, strength: 0, positives, negatives };
  return { kind: "unclear", isMarket: false, excluded: false, strength: 0, positives, negatives };
}

/** True when the structured flag or the title states the event is cancelled or postponed. */
export function isCancelled(event: Pick<NormalizedEvent, "title" | "cancelled">): boolean {
  return event.cancelled === true || CANCELLATION_PATTERN.test(event.title ?? "");
}
