"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

type Option = {
  name: string;
  slug: string;
};

type Props = {
  label: string;
  options: Option[];
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
};

export default function FilterDropdown({ label, options, selected, onChange }: Props) {
  const [isOpen, setIsOpen] = useState(false);

  const handleToggle = (slug: string) => {
    const newSelected = new Set(selected);
    if (newSelected.has(slug)) {
      newSelected.delete(slug);
    } else {
      newSelected.add(slug);
    }
    onChange(newSelected);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="text-sm px-3 py-1.5 border rounded-full whitespace-nowrap flex items-center gap-1"
      >
        {label} ({selected.size || "All"})
        <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full mt-2 w-48 bg-white border rounded-lg shadow-lg z-30">
          <ul className="p-2 space-y-1">
            {options.map((option) => (
              <li key={option.slug}>
                <label className="flex items-center gap-2 p-1 rounded-md hover:bg-gray-100 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(option.slug)}
                    onChange={() => handleToggle(option.slug)}
                    className="h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm">{option.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}