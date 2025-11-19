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
  onClearFilters: () => void; // Add the new prop
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
  onClearFilters, // Receive the new prop
  availableAreas,
  availableCategories,
}: Props) {
  const [searchTerm, setSearchTerm] = useState(currentFilters.search);

  // Sync local search term if URL changes from outside
  useEffect(() => {
    setSearchTerm(currentFilters.search);
  }, [currentFilters.search]);

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      if (searchTerm !== currentFilters.search) {
        onFilterChange("search", searchTerm);
      }
    }, 500);
    return () => clearTimeout(handler);
  }, [searchTerm, currentFilters.search, onFilterChange]);

  const isFilterActive =
    currentFilters.search ||
    currentFilters.when !== "anytime" ||
    currentFilters.areas.size > 0 ||
    currentFilters.categories.size > 0;

  // FIX: The clearFilters function now just calls the prop from the parent
  const clearFilters = () => {
    setSearchTerm(""); // Clear local state immediately for responsiveness
    onClearFilters();
  };

  return (
    <div className="sticky top-0 z-20 bg-base-200 border-b border-base-300 p-2 flex flex-col gap-2">
      {/* Row 1: Search Bar */}
      <div className="relative w-full">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-base-content/50" />
        <input
          type="text"
          placeholder="Search events..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="input input-bordered w-full h-12 pl-11 pr-3 rounded-full leading-normal bg-base-100
               placeholder:text-base-content/50 focus:input-primary focus:border-primary transition-colors"
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

        <div className="flex-grow"></div>

        {isFilterActive && (
          <button
            onClick={clearFilters}
            className="text-xs flex items-center gap-1 text-base-content/70 hover:text-base-content whitespace-nowrap"
          >
            <X className="h-3 w-3" />
            Clear Filters
          </button>
        )}
      </div>
    </div>
  );
}