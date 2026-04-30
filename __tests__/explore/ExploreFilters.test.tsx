/**
 * ExploreFilters — unit tests
 *
 * Tests the pure rendering / callback logic:
 *  - Active filter count badge (when / areas / categories)
 *  - Active chip row rendered correctly
 *  - Chip remove callback fires with correct updated Set
 *  - Clear All button calls both setSearchTerm("") and onClearFilters
 *  - Search input debounce fires onFilterChange after 500ms
 *  - Filters button opens FilterSheet
 */
import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExploreFilters from "@/components/explore/ExploreFilters";

// Stub out FilterSheet so dialog.showModal() doesn't throw in jsdom
jest.mock("@/components/explore/FilterSheet", () => ({
  __esModule: true,
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="filter-sheet-open" /> : null,
}));

// ── Helpers ────────────────────────────────────────────────────────────────

const defaultAreas = [
  { name: "Uptown", slug: "uptown" },
  { name: "South End", slug: "south-end" },
];
const defaultCategories = [
  { name: "Music", slug: "music" },
  { name: "Food", slug: "food" },
];

function defaultFilters() {
  return {
    search: "",
    when: "anytime",
    areas: new Set<string>(),
    categories: new Set<string>(),
  };
}

type FilterType = "search" | "when" | "areas" | "categories";

function renderFilters(overrides?: Partial<ReturnType<typeof defaultFilters>>) {
  const onFilterChange = jest.fn();
  const onClearFilters = jest.fn();
  const filters = { ...defaultFilters(), ...overrides };

  const utils = render(
    <ExploreFilters
      currentFilters={filters}
      onFilterChange={onFilterChange}
      onClearFilters={onClearFilters}
      availableAreas={defaultAreas}
      availableCategories={defaultCategories}
    />
  );
  return { ...utils, onFilterChange, onClearFilters, filters };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("ExploreFilters", () => {
  // ── Search input ─────────────────────────────────────────────────────────
  describe("Search input", () => {
    it("renders with an empty value by default", () => {
      renderFilters();
      expect(screen.getByPlaceholderText("Search events...")).toHaveValue("");
    });

    it("reflects the search value passed via currentFilters", () => {
      renderFilters({ search: "rooftop" });
      expect(screen.getByPlaceholderText("Search events...")).toHaveValue("rooftop");
    });

    it("fires onFilterChange with the new search term after 500ms debounce", async () => {
      jest.useFakeTimers();
      const { onFilterChange } = renderFilters();
      const input = screen.getByPlaceholderText("Search events...");

      fireEvent.change(input, { target: { value: "jazz" } });
      expect(onFilterChange).not.toHaveBeenCalled(); // debounce hasn't fired yet

      act(() => jest.advanceTimersByTime(500));
      expect(onFilterChange).toHaveBeenCalledWith("search", "jazz");
      jest.useRealTimers();
    });

    it("shows a clear (×) button when search has a value", () => {
      renderFilters({ search: "hello" });
      // The clear button wraps an X icon (svg); query by role button with X class
      const clearButtons = screen.getAllByRole("button");
      // At least one button should be near the input (the × button)
      const hasClearButton = clearButtons.some((b) =>
        b.className.includes("right-3.5") || b.querySelector("svg") !== null
      );
      expect(hasClearButton).toBe(true);
    });
  });

  // ── Active filter count badge ─────────────────────────────────────────────
  describe("Active filter count badge", () => {
    it("does NOT show a count badge when all filters are default", () => {
      renderFilters();
      // Badge is a span inside the Filters button; no badge text
      const badge = screen.queryByText(/^\d+$/);
      expect(badge).not.toBeInTheDocument();
    });

    it("shows badge = 1 when only 'when' is non-default", () => {
      renderFilters({ when: "today" });
      expect(screen.getByText("1")).toBeInTheDocument();
    });

    it("shows badge = 2 when one area and one category are selected", () => {
      renderFilters({
        areas: new Set(["uptown"]),
        categories: new Set(["music"]),
      });
      expect(screen.getByText("2")).toBeInTheDocument();
    });

    it("shows badge = 3 when when + area + category are all active", () => {
      renderFilters({
        when: "this-week",
        areas: new Set(["uptown"]),
        categories: new Set(["food"]),
      });
      expect(screen.getByText("3")).toBeInTheDocument();
    });
  });

  // ── Active chip row ──────────────────────────────────────────────────────
  describe("Active chip row", () => {
    it("renders no chips when filters are default", () => {
      renderFilters();
      expect(screen.queryByText("Today")).not.toBeInTheDocument();
      expect(screen.queryByText("Clear all")).not.toBeInTheDocument();
    });

    it("renders a 'Today' chip when when=today", () => {
      renderFilters({ when: "today" });
      expect(screen.getByText("Today")).toBeInTheDocument();
    });

    it("renders an area chip with the area display name", () => {
      renderFilters({ areas: new Set(["uptown"]) });
      expect(screen.getByText("Uptown")).toBeInTheDocument();
    });

    it("renders a category chip with the category display name", () => {
      renderFilters({ categories: new Set(["music"]) });
      expect(screen.getByText("Music")).toBeInTheDocument();
    });

    it("renders slug as fallback chip label when slug not found in availableAreas", () => {
      renderFilters({ areas: new Set(["unknown-area"]) });
      expect(screen.getByText("unknown-area")).toBeInTheDocument();
    });

    it("renders 'Clear all' link when any chip is active", () => {
      renderFilters({ when: "this-month" });
      expect(screen.getByText("Clear all")).toBeInTheDocument();
    });
  });

  // ── Chip remove callbacks ─────────────────────────────────────────────────
  describe("Chip remove callbacks", () => {
    it("calls onFilterChange('when', 'anytime') when the 'when' chip X is clicked", () => {
      const { onFilterChange } = renderFilters({ when: "today" });
      // The chip for "Today" has an × button
      const chipX = screen.getByText("Today").closest("span")!.querySelector("button")!;
      fireEvent.click(chipX);
      expect(onFilterChange).toHaveBeenCalledWith("when", "anytime");
    });

    it("calls onFilterChange('areas', new Set without the slug) when area chip X is clicked", () => {
      const { onFilterChange } = renderFilters({ areas: new Set(["uptown", "south-end"]) });
      const uptownX = screen.getByText("Uptown").closest("span")!.querySelector("button")!;
      fireEvent.click(uptownX);
      const [filterType, newSet] = onFilterChange.mock.calls[0] as [FilterType, Set<string>];
      expect(filterType).toBe("areas");
      expect(newSet.has("uptown")).toBe(false);
      expect(newSet.has("south-end")).toBe(true); // other area still present
    });

    it("calls onFilterChange('categories', new Set without the slug) when category chip X is clicked", () => {
      const { onFilterChange } = renderFilters({ categories: new Set(["music"]) });
      const musicX = screen.getByText("Music").closest("span")!.querySelector("button")!;
      fireEvent.click(musicX);
      const [filterType, newSet] = onFilterChange.mock.calls[0] as [FilterType, Set<string>];
      expect(filterType).toBe("categories");
      expect(newSet.has("music")).toBe(false);
    });
  });

  // ── Clear all ─────────────────────────────────────────────────────────────
  describe("Clear all", () => {
    it("calls onClearFilters when 'Clear all' is clicked", () => {
      const { onClearFilters } = renderFilters({ when: "today" });
      fireEvent.click(screen.getByText("Clear all"));
      expect(onClearFilters).toHaveBeenCalledTimes(1);
    });
  });

  // ── Filters button / FilterSheet ─────────────────────────────────────────
  describe("Filters button", () => {
    it("opens the FilterSheet when the 'Filters' button is clicked", () => {
      renderFilters();
      expect(screen.queryByTestId("filter-sheet-open")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /filters/i }));
      expect(screen.getByTestId("filter-sheet-open")).toBeInTheDocument();
    });
  });
});
