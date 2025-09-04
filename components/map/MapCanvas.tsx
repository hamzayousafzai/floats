"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type { EventPin } from "@/lib/types";
import MapFilters, { type TimeFilter, type DistanceFilter } from "./MapFilters";
import { createPinPopupContent, getEventTimeCategory } from "./PinPopup";

// Helper to create a colored HTML element for the marker
const createMarkerElement = (starts_at?: string): HTMLElement => {
  const category = getEventTimeCategory(
    starts_at ? new Date(starts_at) : undefined
  );

  // Define hex colors for each category
  let color = "#9ca3af"; // Default: gray-400
  if (category === "today") {
    color = "#22c55e"; // Green-500 for Today
  } else if (category === "weekend") {
    color = "#f59e0b"; // Amber-500 for Weekend
  }

  const el = document.createElement("div");
  const width = 28;
  const height = 36;

  // A simple, modern SVG for the drop pin shape
  const svgPin = `
    <svg width="${width}" height="${height}" viewBox="0 0 28 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 0C6.268 0 0 6.268 0 14C0 24.5 14 36 14 36S28 24.5 28 14C28 6.268 21.732 0 14 0Z" fill="${color}"/>
      <circle cx="14" cy="14" r="5" fill="white"/>
    </svg>
  `;
  el.innerHTML = svgPin;
  // Apply styles directly to the element
  el.style.cursor = "pointer";
  el.style.transition = "transform 0.1s ease-in-out";

  el.addEventListener("mousedown", (e) => {
    e.stopPropagation();
  });

  return el;
};

export default function MapCanvas() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [time, setTime] = useState<TimeFilter>("today");
  const [distance, setDistance] = useState<DistanceFilter>("5");

  useEffect(() => {
    const map = new maplibregl.Map({
      container: "map",
      style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      center: [-80.8431, 35.2271], // Charlotte
      zoom: 12,
    });
    mapRef.current = map;

    const clearMarkers = () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
    };

    const fetchPins = async () => {
      if (!mapRef.current) return;

      const b = mapRef.current.getBounds();
      const params = new URLSearchParams({
        minLng: b.getWest().toString(),
        minLat: b.getSouth().toString(),
        maxLng: b.getEast().toString(),
        maxLat: b.getNorth().toString(),
        // Note: The RPC function doesn't use these yet, but we keep them for future filtering
        when: time,
        distance,
      });

      let payload: unknown = [];
      try {
        const res = await fetch(`/api/map/search?${params.toString()}`, {
          cache: "no-store",
        });
        payload = await res.json();
      } catch (e) {
        console.error("Failed to fetch /api/map/search", e);
      }

      const data = Array.isArray(payload) ? (payload as EventPin[]) : [];

      clearMarkers();

      data.forEach((p) => {
        // *** ADD THIS LINE FOR DEBUGGING ***
        console.log("Data for pin:", p);

        const popupNode = createPinPopupContent({
          vendorSlug: p.vendorSlug,
          vendorName: p.vendorName,
          title: p.title,
          starts_at: p.starts_at,
          ends_at: p.ends_at,
          address: p.address ?? undefined,
        });

        const markerEl = createMarkerElement(p.starts_at);

        const marker = new maplibregl.Marker({ element: markerEl, anchor: 'center' })
          .setLngLat([p.lng, p.lat])
          .setPopup(new maplibregl.Popup({ offset: 15 }).setDOMContent(popupNode))
          .addTo(mapRef.current!);

        markersRef.current.push(marker);
      });
    };

    let timer: ReturnType<typeof setTimeout> | null = null;
    const handleMoveEnd = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(fetchPins, 300);
    };

    map.on("load", fetchPins);
    map.on("moveend", handleMoveEnd);

    return () => {
      if (timer) clearTimeout(timer);
      clearMarkers();
      map.remove();
    };
  }, [time, distance]);

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
      <div id="map" className="absolute inset-0 w-full h-full" />
    </div>
  );
}
