// app/(app)/map/page.tsx
"use client";
import dynamic from "next/dynamic";
const MapCanvas = dynamic(() => import("@/components/map/MapCanvas"), { ssr: false });

export default function MapPage() {
  return (
    <div
      className="relative"
      style={{
        height:
          "calc(100dvh - var(--floats-header-total) - var(--floats-nav-total))",
      }}
    >
      <MapCanvas />
    </div>
  );
}


