"use client";

import { useMemo } from "react";

export type WhenFilter = "today" | "weekend" | "month";

type Props = {
  value: WhenFilter;
  onChange: (next: WhenFilter) => void;
  className?: string;
};

export default function MapFilters({ value, onChange, className }: Props) {
  const items: { key: WhenFilter; label: string }[] = useMemo(
    () => [
      { key: "today", label: "Today" },
      { key: "weekend", label: "Weekend" },
      { key: "month", label: "This Month" },
    ],
    []
  );

  return (
    <div
      role="tablist"
      aria-label="Time filter"
      className={`flex items-center gap-2 rounded-full border bg-white/90 p-1 shadow ${className ?? ""}`}
    >
      <span className="px-2 text-xs text-gray-600">Time:</span>
      {items.map((it) => {
        const active = value === it.key;
        return (
          <button
            key={it.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.key)}
            className={`rounded-full px-2 py-1 text-xs transition
              ${active ? "bg-black text-white" : "bg-white text-gray-700 hover:bg-gray-100"}`}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
