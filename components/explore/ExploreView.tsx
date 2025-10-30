"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback } from "react"; // removed useState
import { type ExploreCardData } from "./EventCard";
import ExploreFilters from "./ExploreFilters";
import EventCard from "./EventCard";
// Removed local modal import
// import EventDetailModal from "./EventDetailModal";
import FeaturedCarousel from "./FeaturedCarousel";
import { FeaturedCardData } from "./FeaturedEventCard";

type Area = { name: string; slug: string };
type Category = { name: string; slug: string };

type Props = {
  featuredCards: FeaturedCardData[];
  initialCards: ExploreCardData[];
  availableAreas: Area[];
  availableCategories: Category[];
};

export default function ExploreView({
  featuredCards,
  initialCards,
  availableAreas,
  availableCategories,
}: Props) {
  const router = useRouter();
  const pathname = usePathname(); // Get the current path, e.g., "/explore"
  const searchParams = useSearchParams();

  // Removed local selectedEvent state that created a second modal
  // const [selectedEvent, setSelectedEvent] = useState<ExploreCardData | null>(null);

  const currentFilters = {
    search: searchParams.get("search") || "",
    when: searchParams.get("when") || "anytime",
    areas: new Set(searchParams.get("areas")?.split(",").filter(Boolean) ?? []),
    categories: new Set(searchParams.get("categories")?.split(",").filter(Boolean) ?? []),
  };

  const handleFilterChange = useCallback(
    (
      filterType: "search" | "when" | "areas" | "categories",
      value: string | Set<string>
    ) => {
      const params = new URLSearchParams(searchParams);

      if (typeof value === "string") {
        value ? params.set(filterType, value) : params.delete(filterType);
      } else {
        value.size > 0
          ? params.set(filterType, Array.from(value).join(","))
          : params.delete(filterType);
      }

      router.push(`/explore?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  return (
    <div className="flex flex-col h-full bg-base-200">
      <ExploreFilters
        currentFilters={currentFilters}
        onFilterChange={handleFilterChange}
        availableAreas={availableAreas}
        availableCategories={availableCategories}
      />

      <main className="flex-1 overflow-y-auto p-4">
        <FeaturedCarousel
          featuredCards={featuredCards}
          // Append the current path
          onCardClick={(card) => router.push(`/events/${card.id}?from=${pathname}`)}
        />

        {initialCards.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {initialCards.map((card) => (
              <EventCard
                key={card.id}
                card={card}
                // Append the current path
                onClick={() => router.push(`/events/${card.id}`)}
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

      {/* Removed local EventDetailModal which conflicted with intercepted modal */}
      {/*       
      <EventDetailModal
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
      />
      */}
    </div>
  );
}