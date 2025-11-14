"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback } from "react"; // Removed useRef and useEffect
import { type ExploreCardData } from "./EventCard";
import ExploreFilters from "./ExploreFilters";
import EventCard from "./EventCard";
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
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleCardClick = (cardId: string) => {
    router.push(`/events/${cardId}?from=${pathname}`);
  };

  const currentFilters = {
    search: searchParams.get("search") || "",
    when: searchParams.get("when") || "anytime",
    areas: new Set(searchParams.get("areas")?.split(",").filter(Boolean) ?? []),
    categories: new Set(
      searchParams.get("categories")?.split(",").filter(Boolean) ?? []
    ),
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
          onCardClick={(card) => handleCardClick(card.id)}
        />

        {initialCards.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {initialCards.map((card) => (
              <EventCard
                key={card.id}
                card={card}
                onClick={() => handleCardClick(card.id)}
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
    </div>
  );
}