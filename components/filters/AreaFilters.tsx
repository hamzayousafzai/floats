"use client";

export type Area = {
  name: string;
  slug: string;
};

type Props = {
  areas: Area[];
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
};

export default function AreaFilters({ areas, selected, onChange }: Props) {
  const handleToggle = (slug: string) => {
    // If "All" is clicked, clear the selection
    if (slug === "all") {
      onChange(new Set());
      return;
    }

    const newSelected = new Set(selected);
    if (newSelected.has(slug)) {
      newSelected.delete(slug);
    } else {
      newSelected.add(slug);
    }
    onChange(newSelected);
  };

  // "All" is active if no specific areas are selected
  const isAllActive = selected.size === 0;

  return (
    <div className="bg-white rounded-full shadow-md flex p-1 flex-wrap gap-1">
      {/* "All" Button */}
      <button
        onClick={() => handleToggle("all")}
        className={`text-xs px-3 py-1 rounded-full transition-colors ${
          isAllActive
            ? "bg-blue-500 text-white"
            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
        }`}
      >
        All Areas
      </button>

      {/* Individual Area Buttons */}
      {areas.map(({ name, slug }) => (
        <button
          key={slug}
          onClick={() => handleToggle(slug)}
          className={`text-xs px-3 py-1 rounded-full transition-colors ${
            selected.has(slug)
              ? "bg-blue-500 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          {name}
        </button>
      ))}
    </div>
  );
}