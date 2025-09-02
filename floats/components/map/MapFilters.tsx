"use client";

import { useMemo } from "react";

export type WhenFilter = "now" | "today" | "weekend";

type Props = {
  value: WhenFilter;
  onChange: (next: WhenFilter) => void;
  className?: string;
};

export default function MapFilters({ value, onChange, className }: Props) {
  const items: { key: WhenFilter; label: string }[] = useMemo(
    () => [
      { key: "now", label: "Now" },
      { key: "today", label: "Today" },
      { key: "weekend", label: "Weekend" },
    ],
    []
  );

  return (
    <div
      role="tablist"
      aria-label="Time filter"
      className={`bg-white/90 rounded-xl shadow border flex items-center gap-1 p-1 ${className ?? ""}`}
    >
      {items.map((it) => {
        const active = value === it.key;
        return (
          <button
            key={it.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.key)}
            className={`px-2 py-1 rounded text-sm transition
              ${active ? "bg-black text-white" : "bg-white hover:bg-gray-100 border"}`}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
