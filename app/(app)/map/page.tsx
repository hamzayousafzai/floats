// app/(app)/map/page.tsx
"use client";
import dynamic from "next/dynamic";
const MapCanvas = dynamic(() => import("@/components/map/MapCanvas"), { ssr: false });

export default function MapPage() {
  return (
    // Fixed to viewport; no scrolling; Dock will overlay
    <div className="fixed inset-0">
      <MapCanvas />
    </div>
  );
}


