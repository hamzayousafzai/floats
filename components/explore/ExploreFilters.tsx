"use client";

import { useState, useEffect } from "react";
import { Search, X } from "lucide-react";
import FilterDropdown from "./FilterDropdown";
import SingleSelectDropdown from "./SingleSelectDropdown";

type FilterValues = {
  search: string;
  when: string;
  areas: Set<string>;
  categories: Set<string>;
};

type Props = {
  currentFilters: FilterValues;
  onFilterChange: (
    filterType: keyof FilterValues,
    value: string | Set<string>
  ) => void;
  availableAreas: { name: string; slug: string }[];
  availableCategories: { name: string; slug: string }[];
};

const whenOptions = [
  { label: "This Week", value: "this-week" },
  { label: "Today", value: "today" },
  { label: "This Month", value: "this-month" },
  { label: "Anytime", value: "anytime" },
];

export default function ExploreFilters({
  currentFilters,
  onFilterChange,
  availableAreas,
  availableCategories,
}: Props) {
  const [searchTerm, setSearchTerm] = useState(currentFilters.search);

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      onFilterChange("search", searchTerm);
    }, 500);
    return () => clearTimeout(handler);
  }, [searchTerm, onFilterChange]);

  const isFilterActive =
    currentFilters.search ||
    currentFilters.when !== "this-month" || // Match the default
    currentFilters.areas.size > 0 ||
    currentFilters.categories.size > 0;

  const clearFilters = () => {
    setSearchTerm("");
    onFilterChange("search", "");
    onFilterChange("when", "this-month"); // Match the default
    onFilterChange("areas", new Set());
    onFilterChange("categories", new Set());
  };

  return (
    // The main sticky container now uses flex-col
    <div className="sticky top-0 z-20 bg-white/80 backdrop-blur-sm border-b p-2 flex flex-col gap-2">
      {/* Row 1: Search Bar */}
      <div className="relative w-full">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search events..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="input input-bordered w-full h-12 pl-11 pr-3 rounded-full leading-normal
               placeholder:text-base-content/50"
        />
      </div>

      {/* Row 2: Filter Buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterDropdown
          label="Areas"
          options={availableAreas}
          selected={currentFilters.areas}
          onChange={(value) => onFilterChange("areas", value)}
        />
        <FilterDropdown
          label="Types"
          options={availableCategories}
          selected={currentFilters.categories}
          onChange={(value) => onFilterChange("categories", value)}
        />
        <SingleSelectDropdown
          options={whenOptions}
          value={currentFilters.when}
          onChange={(value) => onFilterChange("when", value)}
        />

        {/* Spacer to push the clear button to the right */}
        <div className="flex-grow"></div>

        {isFilterActive && (
          <button
            onClick={clearFilters}
            className="text-xs flex items-center gap-1 text-gray-600 hover:text-black whitespace-nowrap"
          >
            <X className="h-3 w-3" />
            Clear Filters
          </button>
        )}
      </div>
    </div>
  );
}