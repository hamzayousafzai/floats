"use client";

import { useState } from "react";
import EventCard, { type ExploreCardData } from "./EventCard"; // Updated import
import MapFilters from "./MapFilters";
import { Search } from "lucide-react";

type Props = {
  cards: ExploreCardData[];
  favoriteVendorIds: string[]; // Renamed for clarity
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
      (card.vendor && card.vendor.name.toLowerCase().includes(searchQuery.toLowerCase()));
    return categoryMatch && searchMatch;
  });

  return (
    <main className="flex h-full flex-col">
      {/* Filters Container */}
      <div className="bg-white p-4 border-b sticky top-0 z-20">
        {/* Search Bar */}
        <div className="relative mb-4">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Search className="h-4 w-4 text-gray-400" />
          </div>
          <input
            type="text"
            placeholder="Search events or vendors..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="block w-full rounded-md border-gray-300 pl-9 shadow-sm focus:border-black focus:ring-black sm:text-sm"
          />
        </div>

        {/* Category Filters */}
        <MapFilters
          options={typeOptions}
          active={categoryFilter}
          onSelect={setCategoryFilter}
        />
      </div>

      {/* Results Grid */}
      <div className="flex-1 overflow-y-auto bg-gray-50 p-4">
        {filteredCards.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {filteredCards.map((card) => (
              <EventCard
                key={card.id}
                card={card}
                isFavorite={!!card.vendor && favoriteVendorIds.includes(card.vendor.id)}
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
    </main>
  );
}