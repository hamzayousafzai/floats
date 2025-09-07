"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import maplibregl, { type Map } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type { EventPin } from "@/lib/types";
import MapFilters, { type TimeFilter, type DistanceFilter } from "./MapFilters";
import { createPinPopupContent, getEventTimeCategory } from "./PinPopup";

const createMarkerElement = (starts_at?: string): HTMLElement => {
  const category = getEventTimeCategory(starts_at ? new Date(starts_at) : undefined);
  let color = "#9ca3af"; // Default: gray-400
  if (category === "today") color = "#22c55e"; // Green-500
  else if (category === "weekend") color = "#f59e0b"; // Amber-500

  const el = document.createElement("div");
  el.innerHTML = `
    <svg width="28" height="36" viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 0C6.268 0 0 6.268 0 14C0 24.5 14 36 14 36S28 24.5 28 14C28 6.268 21.732 0 14 0Z" fill="${color}"/>
      <circle cx="14" cy="14" r="5" fill="white"/>
    </svg>`;
  el.style.cursor = "pointer";
  return el;
};

type Props = {
  onPinClick: (event: EventPin) => void;
};

export default function MapCanvas({ onPinClick }: Props) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [time, setTime] = useState<TimeFilter>("today");
  const [distance, setDistance] = useState<DistanceFilter>("5");

  const clearMarkers = () => {
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
  };

  const fetchAndPlacePins = useCallback(async () => {
    if (!mapRef.current) return; // Guard 1: Check before fetch

    const b = mapRef.current.getBounds();
    const params = new URLSearchParams({
      minLng: b.getWest().toString(),
      minLat: b.getSouth().toString(),
      maxLng: b.getEast().toString(),
      maxLat: b.getNorth().toString(),
      when: time,
      distance,
    });

    try {
      const res = await fetch(`/api/map/search?${params.toString()}`);
      const data = (await res.json()) as EventPin[];

      // Guard 2: Check again after await, in case component unmounted
      if (!mapRef.current) return;

      clearMarkers();

      data.forEach((p) => {
        const popupNode = createPinPopupContent({
          vendorSlug: p.vendorSlug,
          vendorName: p.vendorName,
          title: p.title,
          starts_at: p.starts_at,
          ends_at: p.ends_at,
          address: p.address ?? undefined,
        });

        popupNode.addEventListener("click", () => {
          onPinClick(p);
        });

        const markerEl = createMarkerElement(p.starts_at);
        const marker = new maplibregl.Marker({ element: markerEl, anchor: 'bottom' })
          .setLngLat([p.lng, p.lat])
          .setPopup(new maplibregl.Popup({ offset: 25, closeButton: false }).setDOMContent(popupNode))
          .addTo(mapRef.current!);

        // We no longer need a direct click listener on the pin itself.
        markersRef.current.push(marker);
      });
    } catch (e) {
      console.error("Failed to fetch map pins:", e);
    }
  }, [time, distance, onPinClick]);

  // Effect to initialize the map (runs only once)
  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;

    // Define the bounding box for the Charlotte area.
    // Format: [Southwest longitude, Southwest latitude, Northeast longitude, Northeast latitude]
    const maxBounds: [number, number, number, number] = [
      -81.2, // West boundary
      35.0,  // South boundary
      -80.5, // East boundary
      35.5   // North boundary
    ];

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      center: [-80.8431, 35.2271], // Charlotte
      zoom: 12,
      minZoom: 10,
      maxBounds: maxBounds,
    });
    mapRef.current = map;

    map.on("load", fetchAndPlacePins);
    map.on("moveend", fetchAndPlacePins);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [fetchAndPlacePins]);

  // Effect to re-fetch pins when filters change
  useEffect(() => {
    if (mapRef.current?.isStyleLoaded()) {
      fetchAndPlacePins();
    }
  }, [fetchAndPlacePins]);

  return (
    <div className="w-full h-full relative">
      <div className="absolute top-3 left-3 z-10 space-y-2">
        <MapFilters
          time={time}
          onTimeChange={setTime}
          distance={distance}
          onDistanceChange={setDistance}
        />
      </div>
      <div ref={mapContainerRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
}
