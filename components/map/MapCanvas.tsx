"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type { EventPin } from "@/lib/types";
import MapFilters, { type WhenFilter } from "./MapFilters";
import { createPinPopupContent } from "./PinPopup";

export default function MapCanvas() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [when, setWhen] = useState<WhenFilter>("today");

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
        when,
      });

      let payload: unknown = [];
      try {
        const res = await fetch(`/api/map/search?${params.toString()}`, { cache: "no-store" });
        payload = await res.json();
      } catch (e) {
        console.error("Failed to fetch /api/map/search", e);
      }

      const data = Array.isArray(payload) ? (payload as EventPin[]) : [];

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

        const marker = new maplibregl.Marker()
          .setLngLat([p.lng, p.lat])
          .setPopup(new maplibregl.Popup().setDOMContent(popupNode))
          .addTo(mapRef.current!);

        markersRef.current.push(marker);
      });
    };

    // Debounce moveend
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handleMoveEnd = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(fetchPins, 300);
    };

    map.on("load", fetchPins);
    map.on("moveend", handleMoveEnd);

    // Optional: fetch again on style load changes (if you ever swap styles)
    map.on("styledata", () => {
      // no-op now, but kept for future extensibility
    });

    return () => {
      if (timer) clearTimeout(timer);
      clearMarkers();
      map.remove();
    };
  }, [when]);

  return (
    <div className="relative w-full">
      <div className="absolute top-3 left-3 z-10">
        <MapFilters value={when} onChange={setWhen} />
      </div>
      <div id="map" className="h-[calc(100dvh-64px)] w-full" />
    </div>
  );
}
