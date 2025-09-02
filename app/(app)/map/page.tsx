// app/(app)/map/page.tsx
"use client";
import dynamic from "next/dynamic";
const MapCanvas = dynamic(() => import("@/components/map/MapCanvas"), { ssr: false });

export default function MapPage() {
  return <MapCanvas />; // remove the full-screen main wrapper
}


