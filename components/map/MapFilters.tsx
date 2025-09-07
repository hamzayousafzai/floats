"use client";

import { useMemo } from "react";

export type TimeFilter = "today" | "weekend" | "month";
export type DistanceFilter = "5" | "10" | "20";

interface MapFiltersProps {
  time: TimeFilter;
  onTimeChange: (t: TimeFilter) => void;
  distance: DistanceFilter;
  onDistanceChange: (d: DistanceFilter) => void;
  className?: string;
}

const TIME_FILTERS: { key: TimeFilter; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "weekend", label: "This Week" },
  { key: "month", label: "This Month" },
];

const DISTANCE_FILTERS: { key: DistanceFilter; label: string }[] = [
  { key: "5", label: "5 mile" },
  { key: "10", label: "10 miles" },
  { key: "20", label: "20 miles" },
];

export default function MapFilters({
  time,
  onTimeChange,
  distance,
  onDistanceChange,
  className,
}: MapFiltersProps) {

  return (
    <div
      className={`space-y-2 text-xs font-medium ${className ?? ""}`}
      aria-label="Map filters"
    >
      {/* Time */}
      <div className="flex items-center gap-2">
        <span className="text-gray-600">Time:</span>
        <div
          role="radiogroup"
          aria-label="Time range"
          className="flex items-center gap-1 bg-white/90 rounded-xl shadow border p-1"
        >
          {TIME_FILTERS.map((it) => {
            const active = time === it.key;
            return (
              <button
                key={it.key}
                role="radio"
                aria-checked={active}
                onClick={() => onTimeChange(it.key)}
                className={`px-2 py-1 rounded transition
                  ${active ? "bg-black text-white" : "bg-white hover:bg-gray-100 border"}`}
              >
                {it.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Distance */}
      <div className="flex items-center gap-2">
        <span className="text-gray-600">Distance:</span>
        <div
          role="radiogroup"
          aria-label="Distance radius"
          className="flex items-center gap-1 bg-white/90 rounded-xl shadow border p-1"
        >
          {DISTANCE_FILTERS.map((it) => {
            const active = distance === it.key;
            return (
              <button
                key={it.key}
                role="radio"
                aria-checked={active}
                onClick={() => onDistanceChange(it.key)}
                className={`px-2 py-1 rounded transition
                  ${active ? "bg-black text-white" : "bg-white hover:bg-gray-100 border"}`}
              >
                {it.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
