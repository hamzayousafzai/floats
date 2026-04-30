/**
 * ExploreView — unit tests
 *
 * Tests the routing and filter logic inside ExploreView:
 *  - Renders EventCard for each item in initialCards
 *  - Renders empty state when initialCards is empty
 *  - Renders the Featured section when featuredCards is non-empty
 *  - handleCardClick: saves scrollTop to sessionStorage and navigates with ?from=
 *  - handleFilterChange: builds correct URLSearchParams and calls router.push
 *  - clearAllFilters: removes search, when, areas, categories and calls router.push
 *  - Scroll position restored from sessionStorage on mount
 */
import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ExploreView from "@/components/explore/ExploreView";
import type { ExploreCardData } from "@/lib/types";
import type { FeaturedCardData } from "@/components/explore/FeaturedEventCard";

// ── Next.js navigation mocks ───────────────────────────────────────────────

const mockPush = jest.fn();
const mockSearchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/explore",
  useSearchParams: () => mockSearchParams,
}));

// ── Child component mocks ──────────────────────────────────────────────────

// Stub ExploreFilters to avoid complex sub-tree; capture onFilterChange / onClearFilters
let capturedFilterChange: ((type: string, value: string | Set<string>) => void) | null = null;
let capturedClearFilters: (() => void) | null = null;

jest.mock("@/components/explore/ExploreFilters", () => ({
  __esModule: true,
  default: ({ onFilterChange, onClearFilters }: {
    onFilterChange: (type: string, value: string | Set<string>) => void;
    onClearFilters: () => void;
  }) => {
    capturedFilterChange = onFilterChange;
    capturedClearFilters = onClearFilters;
    return <div data-testid="explore-filters" />;
  },
}));

// Stub FeaturedCarousel — expose onCardClick so we can trigger it
let capturedCarouselClick: ((card: FeaturedCardData) => void) | null = null;
jest.mock("@/components/explore/FeaturedCarousel", () => ({
  __esModule: true,
  default: ({ featuredCards, onCardClick }: {
    featuredCards: FeaturedCardData[];
    onCardClick?: (c: FeaturedCardData) => void;
  }) => {
    capturedCarouselClick = onCardClick ?? null;
    return <div data-testid="featured-carousel">{featuredCards.length} featured</div>;
  },
}));

// Stub EventCard — renders title and calls onClick on click
jest.mock("@/components/explore/EventCard", () => ({
  __esModule: true,
  default: ({ card, onClick }: { card: ExploreCardData; onClick: () => void }) => (
    <div data-testid={`event-card-${card.id}`} onClick={onClick}>
      {card.title}
    </div>
  ),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function makeCard(id: string, title = `Event ${id}`): ExploreCardData {
  return {
    id,
    title,
    image_url: null,
    starts_at: null,
    categories: [],
    is_past: false,
  };
}

function renderView(
  initialCards: ExploreCardData[] = [],
  featuredCards: FeaturedCardData[] = []
) {
  return render(
    <ExploreView
      featuredCards={featuredCards}
      initialCards={initialCards}
      availableAreas={[{ name: "Uptown", slug: "uptown" }]}
      availableCategories={[{ name: "Music", slug: "music" }]}
    />
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockPush.mockClear();
  capturedFilterChange = null;
  capturedClearFilters = null;
  capturedCarouselClick = null;
  sessionStorage.clear();
  // Reset searchParams to empty
  Array.from(mockSearchParams.keys()).forEach((k) => mockSearchParams.delete(k));
});

describe("ExploreView", () => {
  // ── Rendering ─────────────────────────────────────────────────────────────
  describe("Card rendering", () => {
    it("renders an EventCard for each item in initialCards", () => {
      renderView([makeCard("1"), makeCard("2"), makeCard("3")]);
      expect(screen.getByTestId("event-card-1")).toBeInTheDocument();
      expect(screen.getByTestId("event-card-2")).toBeInTheDocument();
      expect(screen.getByTestId("event-card-3")).toBeInTheDocument();
    });

    it("renders empty state when initialCards is empty", () => {
      renderView([]);
      expect(screen.getByText("No events found")).toBeInTheDocument();
    });

    it("does NOT render the featured section when featuredCards is empty", () => {
      renderView([makeCard("1")], []);
      expect(screen.queryByTestId("featured-carousel")).not.toBeInTheDocument();
    });

    it("renders the featured carousel when featuredCards is non-empty", () => {
      renderView([], [makeCard("f1") as FeaturedCardData]);
      expect(screen.getByTestId("featured-carousel")).toBeInTheDocument();
    });
  });

  // ── handleCardClick ───────────────────────────────────────────────────────
  describe("handleCardClick", () => {
    it("navigates to /events/[id]?from=/explore on card click", () => {
      renderView([makeCard("abc")]);
      fireEvent.click(screen.getByTestId("event-card-abc"));
      expect(mockPush).toHaveBeenCalledTimes(1);
      const url: string = mockPush.mock.calls[0][0];
      expect(url).toMatch(/\/events\/abc/);
      expect(url).toMatch(/from=/);
    });

    it("includes current query string in the 'from' param", () => {
      // Simulate active filters in the URL
      mockSearchParams.set("when", "today");
      renderView([makeCard("xyz")]);
      fireEvent.click(screen.getByTestId("event-card-xyz"));
      const url: string = mockPush.mock.calls[0][0];
      expect(url).toMatch(/from=.*when/);
    });

    it("saves scroll position to sessionStorage before navigating", () => {
      renderView([makeCard("s1")]);
      fireEvent.click(screen.getByTestId("event-card-s1"));
      // sessionStorage should have a key set (even if scroll is 0)
      expect(sessionStorage.getItem("explore_scroll_pos")).not.toBeNull();
    });
  });

  // ── handleFilterChange ────────────────────────────────────────────────────
  describe("handleFilterChange", () => {
    it("adds a string filter param and calls router.push", () => {
      renderView([makeCard("1")]);
      act(() => capturedFilterChange?.("when", "today"));
      expect(mockPush).toHaveBeenCalledTimes(1);
      const url: string = mockPush.mock.calls[0][0];
      expect(url).toContain("when=today");
    });

    it("removes the param when the value is 'anytime' (default)", () => {
      mockSearchParams.set("when", "this-week");
      renderView([makeCard("1")]);
      act(() => capturedFilterChange?.("when", "anytime"));
      const url: string = mockPush.mock.calls[0][0];
      expect(url).not.toContain("when=");
    });

    it("serialises a Set filter (areas) into a comma-separated param", () => {
      renderView([makeCard("1")]);
      act(() => capturedFilterChange?.("areas", new Set(["uptown", "noda"])));
      const url: string = mockPush.mock.calls[0][0];
      // Both slugs should appear in the URL
      expect(url).toMatch(/areas=.*uptown/);
      expect(url).toMatch(/areas=.*noda/);
    });

    it("removes the param when Set is empty", () => {
      mockSearchParams.set("areas", "uptown");
      renderView([makeCard("1")]);
      act(() => capturedFilterChange?.("areas", new Set<string>()));
      const url: string = mockPush.mock.calls[0][0];
      expect(url).not.toContain("areas=");
    });

    it("clears sessionStorage scroll position when filters change", () => {
      sessionStorage.setItem("explore_scroll_pos", "400");
      renderView([makeCard("1")]);
      act(() => capturedFilterChange?.("when", "this-month"));
      expect(sessionStorage.getItem("explore_scroll_pos")).toBeNull();
    });
  });

  // ── clearAllFilters ────────────────────────────────────────────────────────
  describe("clearAllFilters", () => {
    it("removes search, when, areas, and categories from the URL", () => {
      mockSearchParams.set("search", "jazz");
      mockSearchParams.set("when", "today");
      mockSearchParams.set("areas", "uptown");
      mockSearchParams.set("categories", "music");
      renderView([makeCard("1")]);
      act(() => capturedClearFilters?.());
      const url: string = mockPush.mock.calls[0][0];
      expect(url).not.toContain("search=");
      expect(url).not.toContain("when=");
      expect(url).not.toContain("areas=");
      expect(url).not.toContain("categories=");
    });

    it("clears sessionStorage scroll position when filters are cleared", () => {
      sessionStorage.setItem("explore_scroll_pos", "200");
      renderView([makeCard("1")]);
      act(() => capturedClearFilters?.());
      expect(sessionStorage.getItem("explore_scroll_pos")).toBeNull();
    });
  });

  // ── Scroll restoration ─────────────────────────────────────────────────────
  describe("Scroll restoration", () => {
    it("does nothing if no saved scroll position exists in sessionStorage", () => {
      // Just verify it doesn't throw
      expect(() => renderView([makeCard("1")])).not.toThrow();
    });
  });
});
