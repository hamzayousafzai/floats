"use client";
import dynamic from "next/dynamic";
const MapCanvas = dynamic(() => import("../../../components/map/MapCanvas"), { ssr: false });

export default function MapPage() {
  return <main className="w-screen h-screen"><MapCanvas /></main>;
}

