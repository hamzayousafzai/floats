"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useCallback, useState } from "react"; // Import useState
import { type ExploreCardData } from "./EventCard";
import ExploreFilters from "./ExploreFilters";
import EventCard from "./EventCard";
import EventDetailModal from "./EventDetailModal"; // Import the modal

type Area = { name: string; slug: string };
type Category = { name: string; slug: string };

type Props = {
  initialCards: ExploreCardData[];
  availableAreas: Area[];
  availableCategories: Category[];
};

export default function ExploreView({
  initialCards,
  availableAreas,
  availableCategories,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // State to manage which event is shown in the modal
  const [selectedEvent, setSelectedEvent] = useState<ExploreCardData | null>(null);

  const currentFilters = {
    search: searchParams.get("search") || "",
    when: searchParams.get("when") || "this-week",
    areas: new Set(searchParams.get("areas")?.split(",").filter(Boolean) ?? []),
    categories: new Set(searchParams.get("categories")?.split(",").filter(Boolean) ?? []),
  };

  // Wrap the handler in useCallback to stabilize its reference
  const handleFilterChange = useCallback(
    (
      filterType: "search" | "when" | "areas" | "categories",
      value: string | Set<string>
    ) => {
      const params = new URLSearchParams(searchParams);

      if (typeof value === "string") {
        if (value) {
          params.set(filterType, value);
        } else {
          params.delete(filterType);
        }
      } else {
        if (value.size > 0) {
          params.set(filterType, Array.from(value).join(","));
        } else {
          params.delete(filterType);
        }
      }

      router.push(`/explore?${params.toString()}`, { scroll: false });
    },
    [router, searchParams] // Dependencies for the callback
  );

  return (
    <div className="flex flex-col h-full">
      <ExploreFilters
        currentFilters={currentFilters}
        onFilterChange={handleFilterChange}
        availableAreas={availableAreas}
        availableCategories={availableCategories}
      />
      <main className="flex-1 overflow-y-auto p-4">
        {initialCards.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {initialCards.map((card) => (
              // Pass an onClick handler to set the selected event
              <EventCard
                key={card.id}
                card={card}
                onClick={() => setSelectedEvent(card)}
              />
            ))}
          </div>
        ) : (
          <div className="text-center text-gray-500 mt-16">
            <h3 className="text-lg font-semibold">No Events Found</h3>
            <p>Try adjusting your filters.</p>
          </div>
        )}
      </main>

      {/* Render the modal and control it with state */}
      <EventDetailModal
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
      />
    </div>
  );
}