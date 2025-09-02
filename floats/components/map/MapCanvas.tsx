"use client";
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { EventPin, WhenFilter } from "@/lib/types";

export default function MapCanvas() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [when, setWhen] = useState<WhenFilter>("now");

  useEffect(() => {
    const map = new maplibregl.Map({
      container: "map",
      style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      center: [-80.8431, 35.2271],
      zoom: 12,
    });
    mapRef.current = map;

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
      const res = await fetch(`/api/map/search?${params.toString()}`, { cache: "no-store" });
      const data: EventPin[] = await res.json();

      // clear old markers
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];

      data.forEach((p) => {
        const marker = new maplibregl.Marker()
          .setLngLat([p.lng, p.lat])
          .setPopup(new maplibregl.Popup().setHTML(
            `<div style="font-weight:600">${p.vendorName}</div>
             <div style="font-size:12px;margin-top:2px">${p.title ?? ""}</div>
             <a href="/vendor/${p.vendorSlug}" style="display:inline-block;margin-top:6px;text-decoration:underline">View profile</a>`
          ))
          .addTo(mapRef.current!);
        markersRef.current.push(marker);
      });
    };

    let timer: any;
    const handleMoveEnd = () => {
      clearTimeout(timer);
      timer = setTimeout(fetchPins, 300); // debounce
    };

    map.on("load", fetchPins);
    map.on("moveend", handleMoveEnd);

    return () => {
      clearTimeout(timer);
      markersRef.current.forEach(m => m.remove());
      map.remove();
    };
  }, [when]);

  return (
    <div className="w-full h-full relative">
      <div className="absolute top-3 left-3 z-10 bg-white/90 rounded-xl shadow px-2 py-1 text-sm flex gap-1">
        {(["now","today","weekend"] as const).map(w => (
          <button
            key={w}
            onClick={() => setWhen(w)}
            className={`px-2 py-1 rounded ${w===when ? "bg-black text-white" : "bg-white border"}`}
          >
            {w.toUpperCase()}
          </button>
        ))}
      </div>
      <div id="map" className="w-full h-full" />
    </div>
  );
}

