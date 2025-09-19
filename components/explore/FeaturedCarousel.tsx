"use client";

import FeaturedEventCard from "./FeaturedEventCard";
// use the shared ExploreCardData shape
import type { ExploreCardData } from "./EventCard";

type Props = {
  featuredCards: ExploreCardData[];
  onCardClick?: (card: ExploreCardData) => void;
  title?: string | null;
  onStarChange?: (cardId: string, nextStarred: boolean) => void;
};

export default function FeaturedCarousel({
  featuredCards,
  onCardClick,
  title = "Featured Events",
  onStarChange,
}: Props) {
  if (!featuredCards || featuredCards.length === 0) return null;

  return (
    <div className="p-4 border-b">
      {title !== null && (
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
      )}

      <div className="flex gap-4 overflow-x-auto py-2 px-1 snap-x">
        {featuredCards.map((card) => (
          <div key={card.id} className="snap-start">
            <FeaturedEventCard
              card={card}
              onClick={() => onCardClick?.(card)}
              // FeaturedEventCard expects onStarChange(cardId, next)
              onStarChange={(id, next) => onStarChange?.(id, next)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}