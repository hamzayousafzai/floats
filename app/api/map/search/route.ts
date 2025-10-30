import { createSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type { EventPin } from "@/lib/types";

// miles → meters
const MI = 1609.344;

function bboxFromCenter(lat: number, lng: number, miles: number) {
  const meters = miles * MI;
  const dLat = (meters / 111_320); // ~ meters per deg latitude
  const dLng = meters / (111_320 * Math.cos((lat * Math.PI) / 180));
  return {
    swLat: lat - dLat,
    neLat: lat + dLat,
    swLng: lng - dLng,
    neLng: lng + dLng,
  };
}

function timeWindow(when: string) {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (when === "today") {
    const end = new Date(start);
    end.setDate(start.getDate() + 1);
    return { start, end };
  }
  if (when === "this-week" || when === "week") {
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    return { start, end };
  }
  // default: this-month (~30 days)
  const end = new Date(start);
  end.setDate(start.getDate() + 30);
  return { start, end };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const lat = Number(url.searchParams.get("lat"));
    const lng = Number(url.searchParams.get("lng"));
    const distanceMi = Number(url.searchParams.get("distance") ?? "5");
    const when = url.searchParams.get("when") ?? "this-month";

    if ([lat, lng].some((n) => Number.isNaN(n))) {
      return NextResponse.json({ error: "Missing lat/lng" }, { status: 400 });
    }

    const { swLat, neLat, swLng, neLng } = bboxFromCenter(lat, lng, distanceMi);
    const { start, end } = timeWindow(when);

    const supabase = createSupabaseServer();

    // Prefer explicit latitude/longitude columns; fall back to geom only if needed.
    const { data, error } = await supabase
      .from("events")
      .select(`
        id,
        title,
        description,
        starts_at,
        ends_at,
        image_url,
        address,
        latitude,
        longitude,
        geom,
        org:org_id ( name, slug )
      `)
      .eq("status", "published")
      .gte("starts_at", start.toISOString())
      .lt("starts_at", end.toISOString())
      .gte("latitude", swLat)
      .lte("latitude", neLat)
      .gte("longitude", swLng)
      .lte("longitude", neLng)
      .order("starts_at", { ascending: true });

    if (error) {
      console.error("Map search error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const pins: EventPin[] = (data ?? []).map((ev: any) => {
      let latVal: number | null = ev.latitude ?? null;
      let lngVal: number | null = ev.longitude ?? null;

      // Fallback: try WKT POINT(lon lat) if PostgREST returns that format
      if ((!latVal || !lngVal) && typeof ev.geom === "string" && ev.geom.startsWith("POINT(")) {
        const m = ev.geom.match(/POINT\(([-\d.]+)\s+([-\d.]+)\)/);
        if (m) {
          lngVal = parseFloat(m[1]);
          latVal = parseFloat(m[2]);
        }
      }

      if (latVal == null || lngVal == null) {
        // Skip rows without usable coordinates
        return null as unknown as EventPin;
      }

      return {
        id: ev.id,
        vendorSlug: ev.org?.slug ?? "",
        vendorName: ev.org?.name ?? "",
        title: ev.title ?? null,
        description: ev.description ?? null,
        starts_at: ev.starts_at ?? null,
        ends_at: ev.ends_at ?? null,
        address: ev.address ?? null,
        lat: latVal,
        lng: lngVal,
        imageUrl: ev.image_url ?? null,
      };
    }).filter(Boolean);

    return NextResponse.json(pins);
  } catch (e: any) {
    console.error("Map search failure:", e);
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 500 });
  }
}
