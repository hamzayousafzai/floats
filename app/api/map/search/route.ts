import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const params = {
      lat: Number(url.searchParams.get("lat")),
      lng: Number(url.searchParams.get("lng")),
      distance: Number(url.searchParams.get("distance")), // in miles
      when: url.searchParams.get("when") ?? "today",
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };

    // Validate required parameters
    if (isNaN(params.lat) || isNaN(params.lng) || isNaN(params.distance)) {
      return NextResponse.json({ error: "Invalid lat, lng, or distance parameters" }, { status: 400 });
    }

    const supabase = createSupabaseServer();
    // Call the new radius search function
    const { data, error } = await supabase.rpc("map_events_radius", {
      p_lat: params.lat,
      p_lng: params.lng,
      p_distance_miles: params.distance,
      p_when: params.when,
      p_tz: params.tz,
    });

    if (error) {
      console.error("Map search RPC error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const pins = (data ?? []).map((row: any) => ({
      id: row.event_id,
      title: row.title,
      description: row.description,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      address: row.address,
      lat: row.latitude,
      lng: row.longitude,
      vendorId: row.vendor_id,
      vendorName: row.vendor_name,
      vendorSlug: row.vendor_slug,
    }));

    return NextResponse.json(pins);
  } catch (e: any) {
    const message = e instanceof Error ? e.message : "An unknown error occurred.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
