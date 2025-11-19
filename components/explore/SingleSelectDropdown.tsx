"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";

type Option = {
  label: string;
  value: string;
};

type Props = {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
};

export default function SingleSelectDropdown({ options, value, onChange }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedLabel = options.find((o) => o.value === value)?.label || "Select";
  // Check if active (assuming 'anytime' is the default)
  const isActive = value !== "anytime";

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        // DAISYUI UPDATE: Matching the FilterDropdown styles exactly
        className={`btn btn-sm rounded-full font-normal normal-case transition-all gap-2 ${
          isActive
            ? "btn-primary text-primary-content border-primary shadow-sm"
            : "btn-outline border-base-300 bg-base-100 text-base-content hover:bg-base-200 hover:border-base-content/20"
        }`}
      >
        {selectedLabel}
        <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        // DAISYUI UPDATE: Dropdown container
        <div className="absolute top-full mt-2 w-48 p-2 bg-base-100 border border-base-200 rounded-box shadow-xl z-30">
          {/* DAISYUI UPDATE: Menu component */}
          <ul className="menu menu-sm p-0 gap-1">
            {options.map((option) => (
              <li key={option.value}>
                <button
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  // Highlight the selected item
                  className={`rounded-lg font-medium ${
                    option.value === value
                      ? "bg-primary text-primary-content hover:bg-primary hover:text-primary-content"
                      : "hover:bg-base-200"
                  }`}
                >
                  {option.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}