"use client";

import { useMemo } from "react";

// Renamed component to match filename and props to match parent component
export default function MapFilters({
  active, // Changed from 'value' to 'active'
  onChange,
  options,
  className,
}: {
  active: string;
  onChange: (v: string) => void;
  options: string[];
  className?: string;
}) {
  const items = useMemo(() => options, [options]);
  return (
    <div className={`flex gap-2 overflow-x-auto no-scrollbar ${className ?? ""}`}>
      {items.map((opt) => {
        const isActive = active === opt; // Check against the 'active' prop
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={`btn btn-sm rounded-full capitalize
              ${isActive ? "btn-neutral" : "btn-ghost"}
            `}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
