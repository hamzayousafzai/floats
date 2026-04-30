"use client";

import { useState, useEffect } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import FilterSheet from "./FilterSheet";

type FilterValues = {
  search: string;
  when: string;
  areas: Set<string>;
  categories: Set<string>;
};

type Props = {
  currentFilters: FilterValues;
  onFilterChange: (filterType: keyof FilterValues, value: string | Set<string>) => void;
  onClearFilters: () => void;
  availableAreas: { name: string; slug: string }[];
  availableCategories: { name: string; slug: string }[];
};

const WHEN_LABELS: Record<string, string> = {
  "today": "Today",
  "this-week": "This Week",
  "this-month": "This Month",
  "anytime": "Anytime",
};

export default function ExploreFilters({
  currentFilters,
  onFilterChange,
  onClearFilters,
  availableAreas,
  availableCategories,
}: Props) {
  const [searchTerm, setSearchTerm] = useState(currentFilters.search);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    setSearchTerm(currentFilters.search);
  }, [currentFilters.search]);

  // Debounce search 500ms
  useEffect(() => {
    const handler = setTimeout(() => {
      if (searchTerm !== currentFilters.search) onFilterChange("search", searchTerm);
    }, 500);
    return () => clearTimeout(handler);
  }, [searchTerm, currentFilters.search, onFilterChange]);

  // Badge count for non-search active filters
  const activeFilterCount =
    (currentFilters.when !== "anytime" ? 1 : 0) +
    currentFilters.areas.size +
    currentFilters.categories.size;

  // Inline removable chips
  const activeChips: { label: string; onRemove: () => void }[] = [];
  if (currentFilters.when !== "anytime") {
    activeChips.push({
      label: WHEN_LABELS[currentFilters.when] ?? currentFilters.when,
      onRemove: () => onFilterChange("when", "anytime"),
    });
  }
  currentFilters.areas.forEach((slug) => {
    const area = availableAreas.find((a) => a.slug === slug);
    activeChips.push({
      label: area?.name ?? slug,
      onRemove: () => {
        const next = new Set(currentFilters.areas);
        next.delete(slug);
        onFilterChange("areas", next);
      },
    });
  });
  currentFilters.categories.forEach((slug) => {
    const cat = availableCategories.find((c) => c.slug === slug);
    activeChips.push({
      label: cat?.name ?? slug,
      onRemove: () => {
        const next = new Set(currentFilters.categories);
        next.delete(slug);
        onFilterChange("categories", next);
      },
    });
  });

  return (
    <>
      <div className="sticky top-0 z-20 bg-white border-b border-gray-100 px-4 pt-3 pb-3 space-y-2.5">
        {/* Search + Filters button */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search events..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-11 rounded-full border border-gray-200 bg-gray-50 pl-10 pr-9 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition"
            />
            {searchTerm && (
              <button
                onClick={() => { setSearchTerm(""); onFilterChange("search", ""); }}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-gray-400 hover:text-gray-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <button
            onClick={() => setSheetOpen(true)}
            className="relative flex-shrink-0 flex items-center gap-1.5 h-11 rounded-full border border-gray-200 bg-gray-50 px-4 text-sm font-medium text-gray-700 hover:bg-gray-100 transition"
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-sky-600 text-[10px] font-bold text-white px-1">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Active filter chips */}
        {activeChips.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5" style={{ scrollbarWidth: "none" }}>
            {activeChips.map((chip) => (
              <span
                key={chip.label}
                className="flex items-center gap-1 flex-shrink-0 rounded-full bg-sky-50 border border-sky-200 px-3 py-1 text-xs font-medium text-sky-700"
              >
                {chip.label}
                <button onClick={chip.onRemove} className="ml-0.5 hover:text-sky-900">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <button
              onClick={() => { setSearchTerm(""); onClearFilters(); }}
              className="flex-shrink-0 text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2 pl-1 whitespace-nowrap"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      <FilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        currentFilters={currentFilters}
        onFilterChange={onFilterChange}
        onClearFilters={() => { setSearchTerm(""); onClearFilters(); }}
        availableAreas={availableAreas}
        availableCategories={availableCategories}
      />
    </>
  );
}