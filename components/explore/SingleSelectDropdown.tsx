"use client";

import { useState } from "react";
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
  const selectedOption = options.find((opt) => opt.value === value);

  const handleSelect = (option: Option) => {
    onChange(option.value);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="text-sm px-3 py-1.5 border rounded-full whitespace-nowrap flex items-center gap-1"
      >
        {selectedOption?.label ?? "Select..."}
        <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full mt-2 w-48 bg-white border rounded-lg shadow-lg z-30">
          <ul className="p-1">
            {options.map((option) => (
              <li key={option.value}>
                <button
                  onClick={() => handleSelect(option)}
                  className={`w-full text-left text-sm p-2 rounded-md hover:bg-gray-100 ${
                    option.value === value ? "font-bold bg-gray-100" : ""
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