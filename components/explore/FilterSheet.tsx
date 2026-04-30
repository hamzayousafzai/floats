"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

type FilterValues = {
  search: string;
  when: string;
  areas: Set<string>;
  categories: Set<string>;
};

type Option = { name: string; slug: string };

type Props = {
  open: boolean;
  onClose: () => void;
  currentFilters: FilterValues;
  onFilterChange: (filterType: keyof FilterValues, value: string | Set<string>) => void;
  onClearFilters: () => void;
  availableAreas: Option[];
  availableCategories: Option[];
};

const WHEN_OPTIONS = [
  { label: "Today", value: "today" },
  { label: "This Week", value: "this-week" },
  { label: "This Month", value: "this-month" },
  { label: "Anytime", value: "anytime" },
];

export default function FilterSheet({
  open,
  onClose,
  currentFilters,
  onFilterChange,
  onClearFilters,
  availableAreas,
  availableCategories,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const toggleSet = (set: Set<string>, slug: string): Set<string> => {
    const next = new Set(set);
    next.has(slug) ? next.delete(slug) : next.add(slug);
    return next;
  };

  const isAnyFilterActive =
    currentFilters.when !== "anytime" ||
    currentFilters.areas.size > 0 ||
    currentFilters.categories.size > 0;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="fixed bottom-0 inset-x-0 m-0 max-w-full w-full rounded-t-3xl bg-white p-0 shadow-2xl backdrop:bg-black/40 backdrop:backdrop-blur-sm"
      style={{ maxHeight: "88dvh" }}
    >
      <div className="flex flex-col max-h-[88dvh]">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="h-1 w-10 rounded-full bg-gray-200" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
          <span className="text-base font-semibold text-gray-900">Filters</span>
          <div className="flex items-center gap-3">
            {isAnyFilterActive && (
              <button
                onClick={onClearFilters}
                className="text-sm font-medium text-sky-600 hover:text-sky-700"
              >
                Reset
              </button>
            )}
            <form method="dialog">
              <button className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100">
                <X className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-5 py-5 space-y-7">

          {/* When */}
          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
              When
            </h3>
            <div className="flex flex-wrap gap-2">
              {WHEN_OPTIONS.map((opt) => {
                const active = currentFilters.when === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => onFilterChange("when", opt.value)}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium border transition-colors ${
                      active
                        ? "bg-gray-900 text-white border-gray-900"
                        : "bg-white text-gray-700 border-gray-200 hover:border-gray-400"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Categories */}
          {availableCategories.length > 0 && (
            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
                Categories
              </h3>
              <div className="flex flex-wrap gap-2">
                {availableCategories.map((cat) => {
                  const active = currentFilters.categories.has(cat.slug);
                  return (
                    <button
                      key={cat.slug}
                      onClick={() =>
                        onFilterChange(
                          "categories",
                          toggleSet(currentFilters.categories, cat.slug)
                        )
                      }
                      className={`rounded-full px-4 py-1.5 text-sm font-medium border transition-colors capitalize ${
                        active
                          ? "bg-sky-600 text-white border-sky-600"
                          : "bg-white text-gray-700 border-gray-200 hover:border-gray-400"
                      }`}
                    >
                      {cat.name}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Areas */}
          {availableAreas.length > 0 && (
            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
                Areas
              </h3>
              <div className="flex flex-wrap gap-2">
                {availableAreas.map((area) => {
                  const active = currentFilters.areas.has(area.slug);
                  return (
                    <button
                      key={area.slug}
                      onClick={() =>
                        onFilterChange("areas", toggleSet(currentFilters.areas, area.slug))
                      }
                      className={`rounded-full px-4 py-1.5 text-sm font-medium border transition-colors ${
                        active
                          ? "bg-sky-600 text-white border-sky-600"
                          : "bg-white text-gray-700 border-gray-200 hover:border-gray-400"
                      }`}
                    >
                      {area.name}
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        {/* Apply button */}
        <div className="flex-shrink-0 px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4 border-t border-gray-100 bg-white">
          <form method="dialog">
            <button className="w-full rounded-2xl bg-gray-900 py-4 text-sm font-semibold text-white hover:bg-gray-800 active:bg-black transition-colors">
              Apply Filters
            </button>
          </form>
        </div>
      </div>
    </dialog>
  );
}
