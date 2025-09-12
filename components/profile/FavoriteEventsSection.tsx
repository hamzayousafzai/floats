// components/FavoriteEventsSection.tsx
"use client";

import { useState } from "react";
import FeaturedCarousel from "@/components/explore/FeaturedCarousel";
import { FeaturedCardData } from "@/components/explore/FeaturedEventCard";
import EventDetailModal from "@/components/explore/EventDetailModal";

type Props = { events: Array<any> };

export default function FavoriteEventsSection({ events }: Props) {
  const [activeEvent, setActiveEvent] = useState<FeaturedCardData | null>(null);

  const cards: FeaturedCardData[] = events.map((e: any) => ({
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
  }));

  if (cards.length === 0) return null;

  return (
    <>
      <FeaturedCarousel featuredCards={cards} onCardClick={(c) => setActiveEvent(c)} title="Your Favorites" />
      {activeEvent && <EventDetailModal event={activeEvent} onClose={() => setActiveEvent(null)} />}
    </>
  );
}
