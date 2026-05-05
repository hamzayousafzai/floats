"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import maplibregl, { type Map } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Supercluster from "supercluster";
import { useSearchParams, useRouter } from "next/navigation";

import type { EventPin } from "@/lib/types";
import MapFilters, { type TimeFilter, type DistanceFilter } from "./MapFilters";
import MapFilterSheet from "./MapFilterSheet";
import MapBottomSheet from "./MapBottomSheet";
import { getEventTimeCategory } from "./PinPopup";
import type { Area } from "@/components/filters/AreaFilters";

// ─── Marker element factories ────────────────────────────────────────────────

const createMarkerElement = (starts_at?: string): HTMLElement => {
  const category = getEventTimeCategory(starts_at ? new Date(starts_at) : undefined);

  let fill = "#64748b"; // Slate-500 — future/default
  if (category === "today") fill = "#22c55e";   // Green-500
  else if (category === "weekend") fill = "#f59e0b"; // Amber-500

  const el = document.createElement("div");
  el.innerHTML = `
    <svg width="36" height="46" viewBox="-2 -2 36 46" xmlns="http://www.w3.org/2000/svg"
      style="filter: drop-shadow(0 2px 6px rgba(0,0,0,0.28))">
      <path d="M16 0C7.163 0 0 7.163 0 16C0 24.837 16 42 16 42C16 42 32 24.837 32 16C32 7.163 24.837 0 16 0Z"
        fill="${fill}" stroke="white" stroke-width="2"/>
      <circle cx="16" cy="15" r="5" fill="white" opacity="0.9"/>
    </svg>`;
  el.style.cursor = "pointer";
  return el;
};

/** Circle badge marker for clusters. Size scales slightly with count. */
const createClusterElement = (count: number): HTMLElement => {
  const size = count < 10 ? 40 : count < 50 ? 48 : 56;
  const el = document.createElement("div");
  el.innerHTML = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg"
      style="filter: drop-shadow(0 2px 6px rgba(0,0,0,0.28))">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 2}" fill="#6366f1" stroke="white" stroke-width="2.5"/>
      <text
        x="${size / 2}" y="${size / 2}"
        text-anchor="middle" dominant-baseline="central"
        font-family="system-ui, sans-serif"
        font-size="${count < 10 ? 14 : 12}"
        font-weight="700"
        fill="white"
      >${count}</text>
    </svg>`;
  el.style.cursor = "pointer";
  return el;
};

// ─── Types ───────────────────────────────────────────────────────────────────

type PinFeature = GeoJSON.Feature<GeoJSON.Point, EventPin>;

type Props = {
  onPinClick: (event: EventPin) => void;
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function MapCanvas({ onPinClick }: Props) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  // Supercluster instance + raw pin store, both stable refs (never cause re-renders)
  const clusterRef = useRef<Supercluster<EventPin>>(
    new Supercluster<EventPin>({ radius: 40, maxZoom: 16 })
  );
  const allPinsRef = useRef<EventPin[]>([]);

  const [time, setTime] = useState<TimeFilter>("this-month");
  const [distance, setDistance] = useState<DistanceFilter>("5");
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [selectedPins, setSelectedPins] = useState<EventPin[]>([]);
  const [pinCount, setPinCount] = useState(0);
  const [availableAreas, setAvailableAreas] = useState<Area[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const reqIdRef = useRef(0);
  const router = useRouter();
  const searchParams = useSearchParams();

  const selectedAreas = new Set(searchParams.get("areas")?.split(",").filter(Boolean) ?? []);
  const hasActiveFilters = distance !== "5" || selectedAreas.size > 0;

  // ── Helpers ────────────────────────────────────────────────────────────────

  const clearMarkers = () => {
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
  };

  /**
   * Reads current map viewport, calls supercluster.getClusters(), and renders
   * cluster + single-pin markers. Called after every fetch and on zoom changes.
   */
  const renderClusters = useCallback((currentMap: Map) => {
    clearMarkers();

    const bounds = currentMap.getBounds();
    const zoom = Math.round(currentMap.getZoom());

    const clusters = clusterRef.current.getClusters(
      [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
      zoom
    );

    clusters.forEach((feature) => {
      const [lng, lat] = feature.geometry.coordinates;
      // Narrow cluster vs. point via a local cast — supercluster's union type
      // doesn't expose `cluster` on non-cluster side, so we discriminate manually.
      const clusterProps = feature.properties as {
        cluster?: true;
        cluster_id?: number;
        point_count?: number;
      };

      if (clusterProps.cluster) {
        // ── Cluster marker ──────────────────────────────────────────────────
        const count = clusterProps.point_count ?? 0;
        const clusterId = clusterProps.cluster_id!;
        const clusterEl = createClusterElement(count);

        clusterEl.addEventListener("click", () => {
          // Gather all leaf EventPins for this cluster
          const leaves = clusterRef.current.getLeaves(
            clusterId,
            Infinity
          ) as PinFeature[];
          const pins = leaves.map((l) => l.properties);
          setSelectedPins(pins);
        });

        const marker = new maplibregl.Marker({ element: clusterEl, anchor: "center" })
          .setLngLat([lng, lat])
          .addTo(currentMap);
        markersRef.current.push(marker);
      } else {
        // ── Single-pin marker ───────────────────────────────────────────────
        const pin = feature.properties as unknown as EventPin;
        const markerEl = createMarkerElement(pin.starts_at ?? undefined);
        markerEl.addEventListener("click", () => setSelectedPins([pin]));

        const marker = new maplibregl.Marker({ element: markerEl, anchor: "bottom" })
          .setLngLat([lng, lat])
          .addTo(currentMap);
        markersRef.current.push(marker);
      }
    });
  }, []);

  // ── Data fetching ──────────────────────────────────────────────────────────

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
      const areas = searchParams.get("areas");
      if (areas) params.set("area_slugs", areas);

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

        allPinsRef.current = data;
        setPinCount(data.length);

        // Load all pins into supercluster as GeoJSON point features
        const features: PinFeature[] = data.map((p) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [p.lng, p.lat] },
          properties: p,
        }));
        clusterRef.current.load(features);

        renderClusters(currentMap);
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") return;
        console.error("Failed to fetch map pins:", e);
      }
    },
    [time, distance, searchParams, renderClusters]
  );

  // ── Effects ────────────────────────────────────────────────────────────────

  // Effect 1: Initialize the map ONCE
  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;

    const maxBounds: [number, number, number, number] = [-81.2, 35.0, -80.5, 35.5];
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      center: [-80.8431, 35.2271],
      zoom: 12,
      minZoom: 10,
      maxBounds: maxBounds,
    });
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Effect 2: Attach map listeners
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handleMoveEnd = () => fetchAndPlacePins(map);
    // Re-render clusters on zoom without re-fetching data
    const handleZoom = () => {
      if (allPinsRef.current.length > 0) renderClusters(map);
    };

    map.on("load", handleMoveEnd);
    map.on("moveend", handleMoveEnd);
    map.on("zoom", handleZoom);

    return () => {
      map.off("load", handleMoveEnd);
      map.off("moveend", handleMoveEnd);
      map.off("zoom", handleZoom);
    };
  }, [fetchAndPlacePins, renderClusters]);

  // Effect 3: Zoom on distance change
  useEffect(() => {
    if (!mapRef.current) return;
    const zoomLevels: Record<DistanceFilter, number> = {
      "5": 12,
      "10": 11,
      "20": 10,
    };
    mapRef.current.flyTo({ zoom: zoomLevels[distance], duration: 1200 });
  }, [distance]);

  // Effect 4: Re-fetch pins when filters change (time, distance, or areas)
  useEffect(() => {
    if (!mapRef.current) return;
    fetchAndPlacePins(mapRef.current);
  }, [fetchAndPlacePins]);

  // Fetch available areas once (hardcoded for Charlotte MVP)
  useEffect(() => {
    setAvailableAreas([
      { name: "Uptown", slug: "uptown" },
      { name: "South End", slug: "south-end" },
      { name: "NoDa", slug: "noda" },
      { name: "Plaza Midwood", slug: "plaza-midwood" },
    ]);
  }, []);

  const handleAreaChange = (newSelected: Set<string>) => {
    const params = new URLSearchParams(searchParams);
    if (newSelected.size > 0) {
      params.set("areas", Array.from(newSelected).join(","));
    } else {
      params.delete("areas");
    }
    router.push(`?${params.toString()}`, { scroll: false });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="w-full h-full relative">
      {/* Map tile */}
      <div ref={mapContainerRef} className="absolute inset-0 w-full h-full" />

      {/* Control bar — top left */}
      <div className="absolute top-3 left-3 z-10">
        <MapFilters
          time={time}
          onTimeChange={setTime}
          hasActiveFilters={hasActiveFilters}
          onFiltersOpen={() => setFilterSheetOpen(true)}
        />
      </div>

      {/* Event count badge — above bottom nav */}
      {pinCount > 0 && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <div className="bg-base-100/90 backdrop-blur-sm border border-base-200 rounded-full px-4 py-1.5 shadow-md text-xs font-medium text-base-content/70 whitespace-nowrap">
            {pinCount} event{pinCount !== 1 ? "s" : ""} in search area
          </div>
        </div>
      )}

      {/* Filter sheet */}
      <MapFilterSheet
        open={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        distance={distance}
        onDistanceChange={setDistance}
        areas={availableAreas}
        selectedAreas={selectedAreas}
        onAreaChange={handleAreaChange}
      />

      {/* Bottom sheet event preview */}
      <MapBottomSheet
        pins={selectedPins}
        onClose={() => setSelectedPins([])}
        onViewEvent={(pin) => {
          onPinClick(pin);
          setSelectedPins([]);
        }}
      />
    </div>
  );
}
