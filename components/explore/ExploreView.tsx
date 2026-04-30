"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback, useRef, useLayoutEffect } from "react";
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
  
  // 1. Create a ref for the scroll container
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 2. Restore scroll position on mount (handles the case where the page refreshed)
  useLayoutEffect(() => {
    const savedPosition = sessionStorage.getItem("explore_scroll_pos");
    if (savedPosition && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = parseInt(savedPosition, 10);
    }
  }, []);

  const handleCardClick = (cardId: string) => {
    // 3. Save scroll position before navigating away
    if (scrollContainerRef.current) {
      sessionStorage.setItem("explore_scroll_pos", scrollContainerRef.current.scrollTop.toString());
    }
    const currentSearch = searchParams.toString();
    const fromPath = currentSearch ? `${pathname}?${currentSearch}` : pathname;
    router.push(`/events/${cardId}?from=${encodeURIComponent(fromPath)}`, { scroll: false });
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
      // 4. Clear saved scroll when filters change (user wants to see top results)
      sessionStorage.removeItem("explore_scroll_pos");

      const params = new URLSearchParams(searchParams);

      if (typeof value === "string") {
        (value && value !== "anytime")
          ? params.set(filterType, value)
          : params.delete(filterType);
      } else {
        value.size > 0
          ? params.set(filterType, Array.from(value).join(","))
          : params.delete(filterType);
      }

      router.push(`/explore?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const clearAllFilters = useCallback(() => {
    sessionStorage.removeItem("explore_scroll_pos"); // Clear here too
    const params = new URLSearchParams(searchParams);
    params.delete("search");
    params.delete("when");
    params.delete("areas");
    params.delete("categories");
    router.push(`/explore?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);


  return (
    <div className="flex flex-col h-full bg-gray-50">
      <ExploreFilters
        currentFilters={currentFilters}
        onFilterChange={handleFilterChange}
        onClearFilters={clearAllFilters}
        availableAreas={availableAreas}
        availableCategories={availableCategories}
      />

      <main
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto"
      >
        {/* Featured section */}
        {featuredCards.length > 0 && (
          <section className="pt-5 pb-2">
            <h2 className="px-4 mb-3 text-sm font-semibold text-gray-500 uppercase tracking-widest">
              Featured
            </h2>
            <FeaturedCarousel
              featuredCards={featuredCards}
              onCardClick={(card) => handleCardClick(card.id)}
            />
          </section>
        )}

        {/* All events section */}
        <section className="px-4 pt-4 pb-6">
          {featuredCards.length > 0 && (
            <h2 className="mb-3 text-sm font-semibold text-gray-500 uppercase tracking-widest">
              All Events
            </h2>
          )}
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
            <div className="text-center text-gray-400 mt-16 px-4">
              <p className="text-base font-semibold text-gray-500">No events found</p>
              <p className="text-sm mt-1">Try adjusting your filters or search.</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}