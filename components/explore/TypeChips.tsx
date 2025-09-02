"use client";

type Props = {
  value: string;
  onChange: (val: string) => void;
  options: string[];
  className?: string;
};

export default function TypeChips({ value, onChange, options, className }: Props) {
  return (
    <div className={`flex gap-2 overflow-x-auto no-scrollbar ${className ?? ""}`}>
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={`whitespace-nowrap rounded-full border px-3 py-1 text-sm
              ${active ? "bg-black text-white" : "bg-white text-gray-700 hover:bg-gray-100"}`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
