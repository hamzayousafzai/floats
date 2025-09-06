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
      href: `/events/${pin.id}`,
      imageUrl: pin.imageUrl ?? pin.vendorPhotoUrl ?? null,
      title: pin.title,
      description: pin.description,
      category: pin.vendorCategory ?? (pin.isMarket ? "Market" : "Event"),
      starts_at: pin.starts_at,
      address: pin.address,
      vendor: pin.vendorId
        ? {
            id: pin.vendorId,
            name: pin.vendorName!,
            slug: pin.vendorSlug!,
          }
        : null,
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


