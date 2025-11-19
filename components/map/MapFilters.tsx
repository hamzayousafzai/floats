"use client";

// Define the specific types for our filters
export type TimeFilter = "today" | "this-week" | "this-month" | "weekend";
export type DistanceFilter = "5" | "10" | "20";

type Props = {
  time: TimeFilter;
  onTimeChange: (t: TimeFilter) => void;
  distance: DistanceFilter;
  onDistanceChange: (d: DistanceFilter) => void;
};

export default function MapFilters({
  time,
  onTimeChange,
  distance,
  onDistanceChange,
}: Props) {
  const timeOptions: { label: string; value: TimeFilter }[] = [
    { label: "Today", value: "today" },
    { label: "This Week", value: "this-week" },
    { label: "This Month", value: "this-month" },
  ];

  const distanceOptions: { label: string; value: DistanceFilter }[] = [
    { label: "5 mi", value: "5" },
    { label: "10 mi", value: "10" },
    { label: "20 mi", value: "20" },
  ];

  return (
    <>
      {/* Time Filters */}
      <div className="bg-base-100 rounded-full shadow-md flex p-1 border border-base-200">
        {timeOptions.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => onTimeChange(value)}
            // FIX: Use theme colors (primary) instead of hardcoded black
            className={`text-xs px-3 py-1 rounded-full transition-colors font-medium ${
              time === value 
                ? "bg-primary text-primary-content shadow-sm" 
                : "bg-transparent text-base-content hover:bg-base-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {/* Distance Filters */}
      <div className="bg-base-100 rounded-full shadow-md flex p-1 border border-base-200">
        {distanceOptions.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => onDistanceChange(value)}
            // FIX: Use theme colors (primary) instead of hardcoded black
            className={`text-xs px-3 py-1 rounded-full transition-colors font-medium ${
              distance === value 
                ? "bg-primary text-primary-content shadow-sm" 
                : "bg-transparent text-base-content hover:bg-base-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </>
  );
}
