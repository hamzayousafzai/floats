// app/(app)/map/page.tsx
"use client";

import { Suspense } from "react";
import MapCanvas from "@/components/map/MapCanvas";
import type { EventPin } from "@/lib/types";
import { useRouter, usePathname } from "next/navigation";

export default function MapPage() {
  const router = useRouter();
  const pathname = usePathname(); // Get the current path, e.g., "/map"

  const handlePinClick = (pin: EventPin) => {
    // Navigate to the event page, passing the current path as the 'from' parameter
    // The intercepted route will handle showing the modal.
    router.push(`/events/${pin.id}?from=${pathname}`);
  };

  return (
    <div className="fixed inset-0">
      <Suspense fallback={<div className="flex items-center justify-center h-full">Loading map...</div>}>
        <MapCanvas onPinClick={handlePinClick} />
      </Suspense>
      {/* The EventDetailModal is no longer rendered here. It's handled by the @modal intercepted route. */}
    </div>
  );
}


