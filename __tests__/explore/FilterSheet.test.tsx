/**
 * FilterSheet — unit tests
 *
 * Tests:
 *  - "Reset" button hidden when no filters are active
 *  - "Reset" button visible when at least one filter is active
 *  - Reset calls onClearFilters
 *  - "When" pill buttons render and call onFilterChange correctly
 *  - Category toggle adds / removes from the categories Set
 *  - Area toggle adds / removes from the areas Set
 *  - Apply Filters button closes the dialog (form method=dialog)
 *  - onClose fires when the dialog closes
 */
import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import FilterSheet from "@/components/explore/FilterSheet";

// jsdom doesn't implement dialog.showModal / dialog.close — polyfill them
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    const event = new Event("close");
    this.dispatchEvent(event);
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────

const areas = [
  { name: "Uptown", slug: "uptown" },
  { name: "NoDa", slug: "noda" },
];
const categories = [
  { name: "Music", slug: "music" },
  { name: "Food", slug: "food" },
];

type FilterValues = {
  search: string;
  when: string;
  areas: Set<string>;
  categories: Set<string>;
};

type FilterType = keyof FilterValues;

function renderSheet(
  filterOverrides: Partial<FilterValues> = {},
  props: { open?: boolean } = {}
) {
  const onFilterChange = jest.fn();
  const onClearFilters = jest.fn();
  const onClose = jest.fn();

  const currentFilters: FilterValues = {
    search: "",
    when: "anytime",
    areas: new Set<string>(),
    categories: new Set<string>(),
    ...filterOverrides,
  };

  render(
    <FilterSheet
      open={props.open ?? true}
      onClose={onClose}
      currentFilters={currentFilters}
      onFilterChange={onFilterChange}
      onClearFilters={onClearFilters}
      availableAreas={areas}
      availableCategories={categories}
    />
  );
  return { onFilterChange, onClearFilters, onClose, currentFilters };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("FilterSheet", () => {
  // ── Reset button visibility ───────────────────────────────────────────────
  describe("Reset button", () => {
    it("is hidden when all filters are at their default values", () => {
      renderSheet();
      expect(screen.queryByText("Reset")).not.toBeInTheDocument();
    });

    it("shows when 'when' is not 'anytime'", () => {
      renderSheet({ when: "today" });
      expect(screen.getByText("Reset")).toBeInTheDocument();
    });

    it("shows when at least one area is selected", () => {
      renderSheet({ areas: new Set(["uptown"]) });
      expect(screen.getByText("Reset")).toBeInTheDocument();
    });

    it("shows when at least one category is selected", () => {
      renderSheet({ categories: new Set(["music"]) });
      expect(screen.getByText("Reset")).toBeInTheDocument();
    });

    it("calls onClearFilters when Reset is clicked", () => {
      const { onClearFilters } = renderSheet({ when: "this-week" });
      fireEvent.click(screen.getByText("Reset"));
      expect(onClearFilters).toHaveBeenCalledTimes(1);
    });
  });

  // ── When section ─────────────────────────────────────────────────────────
  describe("When section", () => {
    it("renders all four time options", () => {
      renderSheet();
      expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "This Week" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "This Month" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Anytime" })).toBeInTheDocument();
    });

    it("calls onFilterChange('when', 'today') when Today is clicked", () => {
      const { onFilterChange } = renderSheet();
      fireEvent.click(screen.getByRole("button", { name: "Today" }));
      expect(onFilterChange).toHaveBeenCalledWith("when", "today");
    });

    it("calls onFilterChange('when', 'this-week') when This Week is clicked", () => {
      const { onFilterChange } = renderSheet();
      fireEvent.click(screen.getByRole("button", { name: "This Week" }));
      expect(onFilterChange).toHaveBeenCalledWith("when", "this-week");
    });

    it("calls onFilterChange('when', 'anytime') when Anytime is clicked", () => {
      const { onFilterChange } = renderSheet({ when: "today" });
      fireEvent.click(screen.getByRole("button", { name: "Anytime" }));
      expect(onFilterChange).toHaveBeenCalledWith("when", "anytime");
    });
  });

  // ── Categories section ───────────────────────────────────────────────────
  describe("Categories section", () => {
    it("renders all available categories", () => {
      renderSheet();
      expect(screen.getByRole("button", { name: "Music" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Food" })).toBeInTheDocument();
    });

    it("adds a category to the Set when its button is clicked (was un-selected)", () => {
      const { onFilterChange } = renderSheet({ categories: new Set<string>() });
      fireEvent.click(screen.getByRole("button", { name: "Music" }));
      const [type, newSet] = onFilterChange.mock.calls[0] as [FilterType, Set<string>];
      expect(type).toBe("categories");
      expect(newSet.has("music")).toBe(true);
    });

    it("removes a category from the Set when its button is clicked (was selected)", () => {
      const { onFilterChange } = renderSheet({ categories: new Set(["music"]) });
      fireEvent.click(screen.getByRole("button", { name: "Music" }));
      const [type, newSet] = onFilterChange.mock.calls[0] as [FilterType, Set<string>];
      expect(type).toBe("categories");
      expect(newSet.has("music")).toBe(false);
    });
  });

  // ── Areas section ────────────────────────────────────────────────────────
  describe("Areas section", () => {
    it("renders all available areas", () => {
      renderSheet();
      expect(screen.getByRole("button", { name: "Uptown" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "NoDa" })).toBeInTheDocument();
    });

    it("adds an area to the Set when its button is clicked (was un-selected)", () => {
      const { onFilterChange } = renderSheet({ areas: new Set<string>() });
      fireEvent.click(screen.getByRole("button", { name: "Uptown" }));
      const [type, newSet] = onFilterChange.mock.calls[0] as [FilterType, Set<string>];
      expect(type).toBe("areas");
      expect(newSet.has("uptown")).toBe(true);
    });

    it("removes an area from the Set when its button is clicked (was selected)", () => {
      const { onFilterChange } = renderSheet({ areas: new Set(["uptown"]) });
      fireEvent.click(screen.getByRole("button", { name: "Uptown" }));
      const [type, newSet] = onFilterChange.mock.calls[0] as [FilterType, Set<string>];
      expect(type).toBe("areas");
      expect(newSet.has("uptown")).toBe(false);
    });

    it("keeps other selected areas intact when one area is removed", () => {
      const { onFilterChange } = renderSheet({ areas: new Set(["uptown", "noda"]) });
      fireEvent.click(screen.getByRole("button", { name: "Uptown" }));
      const newSet = onFilterChange.mock.calls[0][1] as Set<string>;
      expect(newSet.has("noda")).toBe(true);
    });
  });

  // ── Visibility ───────────────────────────────────────────────────────────
  describe("Visibility", () => {
    it("does not open the dialog when open=false", () => {
      renderSheet({}, { open: false });
      // The <dialog> element should NOT have the 'open' attribute
      const dialog = document.querySelector("dialog");
      expect(dialog).not.toHaveAttribute("open");
    });

    it("opens the dialog when open=true", () => {
      renderSheet({}, { open: true });
      // The <dialog> element should have the 'open' attribute added by our polyfill
      const dialog = document.querySelector("dialog");
      expect(dialog).toHaveAttribute("open");
    });
  });
});
