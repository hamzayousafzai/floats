// app/(app)/map/page.tsx
"use client";

import { useState } from "react";
import MapCanvas from "@/components/map/MapCanvas";
import EventDetailModal from "@/components/explore/EventDetailModal";
import { type ExploreCardData } from "@/components/explore/EventCard";
import { type EventPin } from "@/lib/types";

export default function MapPage() {
  const [selectedEvent, setSelectedEvent] = useState<ExploreCardData | null>(null);

  // The MapCanvas component now fetches its own data.
  // The redundant data fetch that was here has been removed, as it was the
  // likely source of the SyntaxError.

  const handlePinClick = (pin: EventPin) => {
    const cardData: ExploreCardData = {
      id: pin.id,
      // Normalize possible nullable fields to match ExploreCardData types
      image_url: (pin as any).imageUrl ?? null,
      title: (pin.title ?? "") as string,
      starts_at: (pin as any).starts_at ?? null,
      address: (pin as any).address ?? "",
      latitude: (pin.lat ?? null) as number | null,
      longitude: (pin.lng ?? null) as number | null,
      description: (pin as any).description ?? null,
      // EventPin may not declare categories; fall back to an empty array
      categories: (pin as any).categories ?? [],
    };
    setSelectedEvent(cardData);
  };

  const closeModal = () => {
    setSelectedEvent(null);
  };

  return (
    <div className="fixed inset-0">
      {/* The 'events' prop is removed as MapCanvas handles its own data fetching */}
      <MapCanvas onPinClick={handlePinClick} />
      <EventDetailModal event={selectedEvent} onClose={closeModal} />
    </div>
  );
}


