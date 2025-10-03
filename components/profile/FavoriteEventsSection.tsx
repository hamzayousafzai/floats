// components/FavoriteEventsSection.tsx
"use client";

import { useEffect, useState } from "react";
import FeaturedCarousel from "@/components/explore/FeaturedCarousel";
import EventDetailModal from "@/components/explore/EventDetailModal";

// IMPORTANT: use the shared ExploreCardData shape so EventDetailModal(event) accepts it
import type { ExploreCardData } from "@/components/explore/EventCard";

type Props = { events: Array<any> };

export default function FavoriteEventsSection({ events }: Props) {
  const [cards, setCards] = useState<ExploreCardData[]>(
    () =>
      events.map((e: any) => ({
        id: String(e.id),
        title: e.title ?? "",
        starts_at: e.starts_at ?? null,
        image_url: e.image_url ?? null,
        description: e.description ?? null,
        address: e.address ?? null,
        latitude: e.latitude ?? null,
        longitude: e.longitude ?? null,
        categories: Array.isArray(e.categories) ? e.categories : [],
        is_starred: !!e.is_starred,
        series_id: e.series_id ?? null,
        event_media: e.event_media ?? null, // Add this line
      }))
  );

  // sync when incoming events prop changes (server refresh)
  useEffect(() => {
    setCards(
      events.map((e: any) => ({
        id: String(e.id),
        title: e.title ?? "",
        starts_at: e.starts_at ?? null,
        image_url: e.image_url ?? null,
        description: e.description ?? null,
        address: e.address ?? null,
        latitude: e.latitude ?? null,
        longitude: e.longitude ?? null,
        categories: Array.isArray(e.categories) ? e.categories : [],
        is_starred: !!e.is_starred,
        series_id: e.series_id ?? null,
        event_media: e.event_media ?? null, // And also add this line
      }))
    );
  }, [events]);

  const [activeEvent, setActiveEvent] = useState<ExploreCardData | null>(null);

  // open modal with the card from current state (not the stale prop)
  const openCard = (c: ExploreCardData) => {
    const current = cards.find((x) => x.id === c.id) ?? c;
    setActiveEvent(current);
  };

  // updater used by modal to sync changes back into the carousel
  const updateCard = (id: string, patch: Partial<ExploreCardData>) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    setActiveEvent((ae) => (ae && ae.id === id ? { ...ae, ...patch } : ae));
  };

  // Add this handler to update the card's is_starred when FavoriteButton changes
  const handleStarChange = (cardId: string, nextStarred: boolean) => {
    updateCard(cardId, { is_starred: nextStarred });
  };

  if (cards.length === 0) return null;

  return (
    <>
      <FeaturedCarousel
        featuredCards={cards}
        onCardClick={openCard}
        title="Your Favorites"
        onStarChange={handleStarChange} // NEW: Pass the handler
      />
      {activeEvent && (
        <EventDetailModal
          event={activeEvent}
          onClose={() => setActiveEvent(null)}
          onCardChange={(id, patch) => updateCard(id, patch)}
        />
      )}
    </>
  );
}
