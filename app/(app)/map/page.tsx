// app/(app)/map/page.tsx
"use client";

import { useState, Suspense } from "react";
import MapCanvas from "@/components/map/MapCanvas";
import EventDetailModal from "@/components/explore/EventDetailModal";
import { type ExploreCardData } from "@/components/explore/EventCard";
import { type EventPin } from "@/lib/types";

export default function MapPage() {
  const [selectedEvent, setSelectedEvent] = useState<ExploreCardData | null>(null);

  const handlePinClick = (pin: EventPin) => {
    const cardData: ExploreCardData = {
      id: pin.id,
      image_url: (pin as any).imageUrl ?? null,
      title: (pin.title ?? "") as string,
      starts_at: (pin as any).starts_at ?? null,
      address: (pin as any).address ?? "",
      latitude: (pin.lat ?? null) as number | null,
      longitude: (pin.lng ?? null) as number | null,
      description: (pin as any).description ?? null,
      categories: (pin as any).categories ?? [],
    };
    setSelectedEvent(cardData);
  };

  const closeModal = () => {
    setSelectedEvent(null);
  };

  return (
    <div className="fixed inset-0">
      <Suspense fallback={<div className="flex items-center justify-center h-full">Loading map...</div>}>
        <MapCanvas onPinClick={handlePinClick} />
      </Suspense>

      {/* NEW: wrap the modal tree (contains useSearchParams via CheckInButton) */}
      <Suspense fallback={null}>
        <EventDetailModal event={selectedEvent} onClose={closeModal} />
      </Suspense>
    </div>
  );
}


