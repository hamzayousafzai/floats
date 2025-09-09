import { createSupabaseServer } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

const APP_TZ = "America/New_York"; // keep in sync with DB

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const minLng = parseFloat(searchParams.get("minLng") || "");
  const minLat = parseFloat(searchParams.get("minLat") || "");
  const maxLng = parseFloat(searchParams.get("maxLng") || "");
  const maxLat = parseFloat(searchParams.get("maxLat") || "");
  const when = (searchParams.get("when") || "today").toLowerCase();

  if ([minLng, minLat, maxLng, maxLat].some(Number.isNaN)) {
    return NextResponse.json({ error: "Missing or invalid map bounds" }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.rpc("map_events_bbox_when", {
      p_min_lng: minLng,
      p_min_lat: minLat,
      p_max_lng: maxLng,
      p_max_lat: maxLat,
      p_when: when,
      p_tz: APP_TZ,
    });

    if (error) {
      console.error("Map search RPC error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const pins = (data ?? []).map((row: any) => ({
      id: row.event_id,
      title: row.title,
      description: row.description, // Add this line
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
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
