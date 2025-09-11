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
      <div className="bg-white rounded-full shadow-md flex p-1">
        {timeOptions.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => onTimeChange(value)}
            className={`text-xs px-3 py-1 rounded-full ${
              time === value ? "bg-black text-white" : "bg-white text-black"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {/* Distance Filters */}
      <div className="bg-white rounded-full shadow-md flex p-1">
        {distanceOptions.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => onDistanceChange(value)}
            className={`text-xs px-3 py-1 rounded-full ${
              distance === value ? "bg-black text-white" : "bg-white text-black"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </>
  );
}
