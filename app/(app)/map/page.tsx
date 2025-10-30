// app/(app)/map/page.tsx
"use client";

import { useState, Suspense } from "react";
import MapCanvas from "@/components/map/MapCanvas";
import EventDetailModal from "@/components/explore/EventDetailModal";
import { type ExploreCardData } from "@/components/explore/EventCard";
import { type EventPin } from "@/lib/types";
import { useRouter } from "next/navigation";

export default function MapPage() {
  const router = useRouter();
  const [selectedEvent, setSelectedEvent] = useState<ExploreCardData | null>(null);

  const handlePinClick = (pin: EventPin) => {
    router.push(`/events/${pin.id}`);
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


