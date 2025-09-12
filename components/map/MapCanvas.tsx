"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import maplibregl, { type Map } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useSearchParams, useRouter } from "next/navigation";

import type { EventPin } from "@/lib/types";
import MapFilters, { type TimeFilter, type DistanceFilter } from "./MapFilters";
import AreaFilters, { type Area } from "../filters/AreaFilters";
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
  const [time, setTime] = useState<TimeFilter>("this-month");
  const [distance, setDistance] = useState<DistanceFilter>("5");
  const abortRef = useRef<AbortController | null>(null);
  const reqIdRef = useRef(0);
  const router = useRouter();
  const searchParams = useSearchParams();

  // State for the new area filter
  const [availableAreas, setAvailableAreas] = useState<Area[]>([]);
  const selectedAreas = new Set(searchParams.get("areas")?.split(",") ?? []);

  const clearMarkers = () => {
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
  };

  // This function now only depends on what's needed to build the API call.
  const fetchAndPlacePins = useCallback(
    async (currentMap: Map) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const center = currentMap.getCenter();
      const params = new URLSearchParams({
        lat: String(center.lat),
        lng: String(center.lng),
        distance: distance,
        when: time,
      });
      // Add selected areas to the API call
      const areas = searchParams.get("areas");
      if (areas) {
        params.set("area_slugs", areas);
      }

      const myReqId = ++reqIdRef.current;

      try {
        const res = await fetch(`/api/map/search?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`HTTP ${res.status}: ${body}`);
        }

        const data = (await res.json()) as EventPin[];
        if (myReqId !== reqIdRef.current) return;

        clearMarkers();

        data.forEach((p) => {
          const popupNode = createPinPopupContent({
            vendorSlug: p.vendorSlug,
            vendorName: p.vendorName,
            title: p.title,
            description: p.description,
            starts_at: p.starts_at,
            ends_at: p.ends_at,
            address: p.address ?? undefined,
          });
          popupNode.addEventListener("click", () => onPinClick(p));

          const markerEl = createMarkerElement(p.starts_at);
          const marker = new maplibregl.Marker({ element: markerEl, anchor: "bottom" })
            .setLngLat([p.lng, p.lat])
            .setPopup(new maplibregl.Popup({ offset: 25, closeButton: false }).setDOMContent(popupNode))
            .addTo(currentMap);
          markersRef.current.push(marker);
        });
      } catch (e: any) {
        if (e.name === "AbortError") return;
        console.error("Failed to fetch map pins:", e);
      }
    },
    [time, distance, onPinClick, searchParams] // Add searchParams to dependency array
  );

  // Effect 1: Initialize the map ONCE on component mount.
  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return; // Initialize only once

    const maxBounds: [number, number, number, number] = [-81.2, 35.0, -80.5, 35.5];
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      center: [-80.8431, 35.2271],
      zoom: 12, // Initial zoom, will be adjusted by the zoom effect
      minZoom: 10,
      maxBounds: maxBounds,
    });
    mapRef.current = map;

    // Cleanup function to run when the component unmounts
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []); // Empty dependency array ensures this runs only once.

  // Effect 2: Manage map event listeners.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return; // Don't do anything if the map isn't ready

    // This is the single source of truth for fetching data.
    const handleMoveEnd = () => fetchAndPlacePins(map);

    // Attach listeners
    map.on("load", handleMoveEnd);
    map.on("moveend", handleMoveEnd);

    // Cleanup function to remove listeners when the handler changes or component unmounts
    return () => {
      map.off("load", handleMoveEnd);
      map.off("moveend", handleMoveEnd);
    };
  }, [fetchAndPlacePins]); // This re-attaches the listener when the fetch logic changes.

  // Effect 3: This effect is ONLY for zooming. It remains the same.
  useEffect(() => {
    if (!mapRef.current) return;

    const zoomLevels: Record<DistanceFilter, number> = {
      "5": 12, // Corrected zoom levels
      "10": 11,
      "20": 10,
    };

    mapRef.current.flyTo({
      zoom: zoomLevels[distance],
      duration: 1200,
    });
  }, [distance]);

  // Fetch available areas once
  useEffect(() => {
    const fetchAreas = async () => {
      // In a real app, you'd fetch this from your DB
      const areas: Area[] = [
        { name: "Uptown", slug: "uptown" },
        { name: "South End", slug: "south-end" },
        { name: "NoDa", slug: "noda" },
        { name: "Plaza Midwood", slug: "plaza-midwood" },
      ];
      setAvailableAreas(areas);
    };
    fetchAreas();
  }, []);

  const handleAreaChange = (newSelected: Set<string>) => {
    const params = new URLSearchParams(searchParams);
    if (newSelected.size > 0) {
      params.set("areas", Array.from(newSelected).join(","));
    } else {
      params.delete("areas");
    }
    // Use router.push to update URL without reloading page
    router.push(`?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="w-full h-full relative">
      <div className="absolute top-3 left-3 z-10 space-y-2">
        <MapFilters
          time={time}
          onTimeChange={setTime}
          distance={distance}
          onDistanceChange={setDistance}
        />
        <AreaFilters
          areas={availableAreas}
          selected={selectedAreas}
          onChange={handleAreaChange}
        />
      </div>
      <div ref={mapContainerRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
}
