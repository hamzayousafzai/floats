"use client";

import { useState, useRef, useEffect } from "react";
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

  const handleToggle = (slug: string) => {
    const newSelected = new Set(selected);
    if (newSelected.has(slug)) {
      newSelected.delete(slug);
    } else {
      newSelected.add(slug);
    }
    onChange(newSelected);
  };

  const isActive = selected.size > 0;

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        // DAISYUI UPDATE: Using 'btn' classes
        // - btn-sm: Small size
        // - rounded-full: Pill shape
        // - btn-primary: Active state (Blue)
        // - btn-outline: Inactive state (White/Grey)
        className={`btn btn-sm rounded-full font-normal normal-case transition-all gap-2 ${
          isActive 
            ? "btn-primary text-primary-content border-primary shadow-sm" 
            : "btn-outline border-base-300 bg-base-100 text-base-content hover:bg-base-200 hover:border-base-content/20"
        }`}
      >
        {label} {isActive && <span className="badge badge-sm badge-ghost bg-white/20 text-current border-0">{selected.size}</span>}
        <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        // DAISYUI UPDATE: Dropdown container styling
        <div className="absolute top-full mt-2 w-56 p-2 bg-base-100 border border-base-200 rounded-box shadow-xl z-30">
          {/* DAISYUI UPDATE: Using 'menu' component for the list */}
          <ul className="menu menu-sm p-0 gap-1">
            {options.map((option) => (
              <li key={option.slug}>
                <label className="label cursor-pointer justify-start gap-3 hover:bg-base-200 rounded-lg active:bg-base-300">
                  {/* DAISYUI UPDATE: 'checkbox-primary' for brand color */}
                  <input
                    type="checkbox"
                    checked={selected.has(option.slug)}
                    onChange={() => handleToggle(option.slug)}
                    className="checkbox checkbox-primary checkbox-sm rounded-md"
                  />
                  <span className="label-text text-base-content truncate font-medium">{option.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}