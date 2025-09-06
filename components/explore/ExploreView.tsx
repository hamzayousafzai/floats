"use client";

import { useState } from "react";
import EventCard, { type ExploreCardData } from "./EventCard";
import MapFilters from "./MapFilters";
import { Search } from "lucide-react";
import EventDetailModal from "./EventDetailModal"; // Import the new component

type Props = {
  cards: ExploreCardData[];
  favoriteVendorIds: string[];
  typeOptions: string[];
};

export default function ExploreView({ cards, favoriteVendorIds, typeOptions }: Props) {
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<ExploreCardData | null>(null);

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

  const handleCardClick = (card: ExploreCardData) => {
    setSelectedEvent(card);
  };

  const closeModal = () => {
    setSelectedEvent(null);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header: This div does not grow or shrink. It stays at the top. */}
      <div className="shrink-0 bg-base-100 border-b p-4">
        <div className="relative mb-3">
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
          onChange={setCategoryFilter}
        />
      </div>

      {/* Card List: This div takes all remaining space and scrolls internally. */}
      <div className="flex-1 overflow-y-auto bg-base-200 p-4 pb-28">
        <div className="grid gap-3 sm:grid-cols-2">
          {filteredCards.map((card) => (
            <EventCard
              key={card.id}
              card={card}
              isFavorite={
                !!card.vendor && favoriteVendorIds.includes(card.vendor.id)
              }
              onClick={handleCardClick}
            />
          ))}
        </div>
      </div>

      {/* Use the reusable modal component */}
      <EventDetailModal event={selectedEvent} onClose={closeModal} />
    </div>
  );
}