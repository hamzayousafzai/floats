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
    const areaSlugsParam = url.searchParams.get("area_slugs");
    const areaSlugs = areaSlugsParam
      ? areaSlugsParam.split(",").filter(Boolean)
      : [];

    if ([lat, lng].some((n) => Number.isNaN(n))) {
      return NextResponse.json({ error: "Missing lat/lng" }, { status: 400 });
    }

    const { swLat, neLat, swLng, neLng } = bboxFromCenter(lat, lng, distanceMi);
    const { start, end } = timeWindow(when);

    const supabase = createSupabaseServer();

    // Resolve area slugs → area UUIDs (areas table uses area_id FK on events)
    let areaIds: string[] = [];
    if (areaSlugs.length > 0) {
      const { data: areaRows, error: areaErr } = await supabase
        .from("areas")
        .select("id")
        .in("slug", areaSlugs);
      if (areaErr) {
        console.error("Area lookup error:", areaErr);
        return NextResponse.json({ error: areaErr.message }, { status: 500 });
      }
      areaIds = (areaRows ?? []).map((r) => r.id);
      // If none matched, return empty immediately — no point querying events
      if (areaIds.length === 0) {
        return NextResponse.json([]);
      }
    }

    // Prefer explicit latitude/longitude columns; fall back to geom only if needed.
    const baseQuery = supabase
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

    // Filter by area_id if slugs were specified
    const query = areaIds.length > 0
      ? baseQuery.in("area_id", areaIds)
      : baseQuery;

    const { data, error } = await query;

    if (error) {
      console.error("Map search error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    type MapEventRow = {
      id: string;
      title: string | null;
      description: string | null;
      starts_at: string | null;
      ends_at: string | null;
      image_url: string | null;
      address: string | null;
      latitude: number | null;
      longitude: number | null;
      geom: unknown;
      org: { name: string | null; slug: string | null } | null;
    };
    const pins: EventPin[] = (data as MapEventRow[] ?? []).map((ev) => {
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
  } catch (e: unknown) {
    console.error("Map search failure:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
