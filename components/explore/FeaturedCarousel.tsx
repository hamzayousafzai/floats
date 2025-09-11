"use client";

import FeaturedEventCard, { FeaturedCardData } from "./FeaturedEventCard";

type Props = {
  featuredCards: FeaturedCardData[];
  onCardClick: (card: FeaturedCardData) => void; // Add this prop
};

export default function FeaturedCarousel({ featuredCards, onCardClick }: Props) {
  if (!featuredCards || featuredCards.length === 0) {
    return null;
  }

  return (
    <div className="p-4 border-b">
      <h2 className="text-lg font-bold mb-3">Featured Events</h2>
      <div className="carousel carousel-center w-full space-x-4">
        {featuredCards.map((card) => (
          // Pass the onClick handler to each card
          <FeaturedEventCard
            key={card.id}
            card={card}
            onClick={() => onCardClick(card)}
          />
        ))}
      </div>
    </div>
  );
}