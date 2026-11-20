/**
 * @jest-environment node
 */
import { classifyMarket, isCancelled } from "@/lib/ingestion/validation/classify";

const base = { description: null as string | null, categorySlugs: [] as string[] };

describe("classifyMarket", () => {
  it.each([
    "Makers Market at Example Pavilion",
    "Charlotte Maker's Market",
    "Farmers' Market Saturday",
    "Vintage Market & Vinyl Fair",
    "Holiday Craft Fair",
    "South End Flea Market",
    "Winter Market",
    "Artisan Market Charlotte",
    "Pop-Up Market Night",
    "Shop Local Saturday",
    "Vendor Market",
  ])("qualifies %s from the title", (title) => {
    expect(classifyMarket({ ...base, title })).toMatchObject({ kind: "market", isMarket: true, excluded: false, strength: 2 });
  });

  it("accepts weaker evidence from the description or an explicit market category", () => {
    expect(classifyMarket({ title: "Spring Fling", description: "Join our makers market with 30 local vendors", categorySlugs: [] })).toMatchObject({ kind: "market", strength: 1 });
    expect(classifyMarket({ title: "Spring Fling", description: null, categorySlugs: ["farmers-market"] })).toMatchObject({ kind: "market", strength: 1 });
  });

  it.each([
    "Sunrise Yoga in the Park",
    "Trivia Night",
    "Karaoke Thursday",
    "Summer Concert Series",
    "Candle Making Workshop",
    "Business Networking Mixer",
    "Grand Opening at Example Boutique",
    "Trunk Show at Example Store",
  ])("excludes %s", (title) => {
    expect(classifyMarket({ ...base, title })).toMatchObject({ kind: "excluded", isMarket: false, excluded: true });
  });

  it("does not reject a market that also features live music, a workshop or a class", () => {
    const result = classifyMarket({ title: "Makers Market with Live Music", description: "Free yoga class at 10am and a DJ set.", categorySlugs: [] });
    expect(result).toMatchObject({ kind: "market", isMarket: true, excluded: false });
    expect(result.negatives).toEqual(expect.arrayContaining(["concert", "yoga"]));
  });

  it("treats a negative title with market evidence only elsewhere as unclear, not excluded", () => {
    expect(classifyMarket({ title: "Trivia Night", description: "Also visit the makers market next door", categorySlugs: [] })).toMatchObject({ kind: "unclear", excluded: false, isMarket: false });
  });

  it("treats events with no signal as unclear", () => {
    expect(classifyMarket({ title: "Spring Fling", description: "Come out and enjoy the afternoon.", categorySlugs: [] })).toMatchObject({ kind: "unclear", isMarket: false, excluded: false });
  });

  it("does not match phrases inside other words", () => {
    expect(classifyMarket({ title: "Supermarket Sweep", description: null, categorySlugs: [] }).kind).toBe("unclear");
    expect(classifyMarket({ title: "Flea marketing seminar", description: null, categorySlugs: [] }).isMarket).toBe(false);
  });
});

describe("isCancelled", () => {
  it("uses the structured flag and common title wording", () => {
    expect(isCancelled({ title: "Makers Market", cancelled: true })).toBe(true);
    expect(isCancelled({ title: "Makers Market (CANCELLED)", cancelled: false })).toBe(true);
    expect(isCancelled({ title: "Makers Market - Postponed", cancelled: false })).toBe(true);
    expect(isCancelled({ title: "Makers Market", cancelled: false })).toBe(false);
  });
});
