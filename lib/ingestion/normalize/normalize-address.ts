const ABBREVIATIONS: Record<string, string> = {
  street: "st", avenue: "ave", road: "rd", boulevard: "blvd", drive: "dr", lane: "ln", court: "ct", place: "pl",
  parkway: "pkwy", highway: "hwy", circle: "cir", trail: "trl", terrace: "ter", suite: "ste", apartment: "apt",
  north: "n", south: "s", east: "e", west: "w", northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw",
};
const STREET_SUFFIXES = new Set(["st", "ave", "rd", "blvd", "dr", "ln", "ct", "pl", "pkwy", "hwy", "cir", "way", "trl", "ter", "sq", "aly"]);

function stripMarks(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Lowercase, punctuation-free comparison form of a US address: "2315 North Davidson Street Charlotte, NC, 28205
 * United States" and "2315 N Davidson St Charlotte, NC 28205" compare equal. Not a display format.
 */
export function normalizeAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  let text = stripMarks(address)
    .toLowerCase()
    .replace(/\b(?:united states(?: of america)?|usa)\b/g, " ")
    .replace(/\bnorth carolina\b/g, " nc ")
    .replace(/(\d{5})-\d{4}\b/g, "$1")
    .replace(/[.,;:#()'’"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  text = text
    .split(" ")
    .map((token) => ABBREVIATIONS[token] ?? token)
    .join(" ");
  return text.length > 0 ? text : null;
}

/**
 * The building-level part of a normalized address (number, street name and suffix). Used for identity so that a
 * listing with and without the city, state or zip, or with a suite number, resolves to the same place.
 */
export function streetKey(address: string | null | undefined): string | null {
  const normalized = normalizeAddress(address);
  if (!normalized) return null;
  const tokens = normalized.split(" ");
  const suffixAt = tokens.findIndex((token, index) => index > 0 && STREET_SUFFIXES.has(token));
  return (suffixAt >= 0 ? tokens.slice(0, suffixAt + 1) : tokens).join(" ");
}
