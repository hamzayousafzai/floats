"use client";

import { useState } from "react";
import { SlidersHorizontal, ChevronDown } from "lucide-react";

export type TimeFilter = "today" | "this-week" | "this-month";
export type DistanceFilter = "5" | "10" | "20";

const TIME_LABELS: Record<TimeFilter, string> = {
  "today": "Today",
  "this-week": "This Week",
  "this-month": "This Month",
};

type Props = {
  time: TimeFilter;
  onTimeChange: (t: TimeFilter) => void;
  hasActiveFilters: boolean;
  onFiltersOpen: () => void;
};

export default function MapFilters({
  time,
  onTimeChange,
  hasActiveFilters,
  onFiltersOpen,
}: Props) {
  const [timeOpen, setTimeOpen] = useState(false);

  const timeOptions: { label: string; value: TimeFilter }[] = [
    { label: "Today", value: "today" },
    { label: "This Week", value: "this-week" },
    { label: "This Month", value: "this-month" },
  ];

  return (
    <div className="flex items-center gap-2">
      {/* Time dropdown pill */}
      <div className="relative">
        <button
          onClick={() => setTimeOpen((v) => !v)}
          className="flex items-center gap-1.5 bg-base-100 border border-base-200 rounded-full shadow-md px-4 py-2 text-sm font-medium text-base-content active:scale-95 transition-transform"
        >
          <span>{TIME_LABELS[time]}</span>
          <ChevronDown
            size={14}
            className={`text-base-content/50 transition-transform duration-200 ${timeOpen ? "rotate-180" : ""}`}
          />
        </button>

        {timeOpen && (
          <>
            {/* Invisible backdrop to close on outside tap */}
            <div
              className="fixed inset-0 z-10"
              onClick={() => setTimeOpen(false)}
            />
            <div className="absolute top-full left-0 mt-1 z-20 bg-base-100 border border-base-200 rounded-2xl shadow-xl overflow-hidden min-w-[140px]">
              {timeOptions.map(({ label, value }) => (
                <button
                  key={value}
                  onClick={() => {
                    onTimeChange(value);
                    setTimeOpen(false);
                  }}
                  className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                    time === value
                      ? "bg-primary/10 text-primary font-semibold"
                      : "text-base-content hover:bg-base-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Filters button */}
      <button
        onClick={onFiltersOpen}
        className="relative flex items-center gap-1.5 bg-base-100 border border-base-200 rounded-full shadow-md px-4 py-2 text-sm font-medium text-base-content active:scale-95 transition-transform"
      >
        <SlidersHorizontal size={15} className="text-base-content/70" />
        <span>Filters</span>
        {hasActiveFilters && (
          <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-primary border-2 border-base-100" />
        )}
      </button>
    </div>
  );
}
