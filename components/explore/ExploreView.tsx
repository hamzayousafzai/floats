"use client";

import { useState } from "react";
import EventCard, { type ExploreCardData } from "./EventCard";
import MapFilters from "./MapFilters";
import { Search } from "lucide-react";

type Props = {
  cards: ExploreCardData[];
  favoriteVendorIds: string[];
  typeOptions: string[];
};

export default function ExploreView({ cards, favoriteVendorIds, typeOptions }: Props) {
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredCards = cards.filter((card) => {
    const categoryMatch =
      categoryFilter === "All" || card.category === categoryFilter;
    const searchMatch =
      searchQuery === "" ||
      card.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (card.vendor &&
        card.vendor.name.toLowerCase().includes(searchQuery.toLowerCase()));
    return categoryMatch && searchMatch;
  });

  // The component now returns fragments, as the parent provides the main layout container.
  return (
    <>
      {/* Fixed header within page */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <header className="shrink-0 bg-base-100 pb-2"></header>
          <div className="relative mb-4">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <Search className="h-4 w-4 text-gray-400" />
            </div>
            <input
            type="text"
            placeholder="Search events or vendors..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input input-bordered w-full pl-9"
          />
        </div>

        <MapFilters
          options={typeOptions}
          active={categoryFilter}
          onSelect={setCategoryFilter}
        />
      </div>

      {/* Only this area scrolls; add bottom padding so Dock doesn't cover items */}
      <div className="
              min-h-0 flex-1 overflow-y-auto
              bg-base-200 p-4
              pb-[calc(var(--floats-nav-total)+1rem)]
              -mx-4 px-4
              ">
        {filteredCards.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {filteredCards.map((card) => (
              <EventCard
                key={card.id}
                card={card}
                isFavorite={
                  !!card.vendor && favoriteVendorIds.includes(card.vendor.id)
                }
              />
            ))}
          </div>
        ) : (
          <div className="text-center text-gray-500 mt-8">
            <p>No results found.</p>
            <p className="text-sm">Try adjusting your search or filters.</p>
          </div>
        )}
      </div>
    </>
  );
}