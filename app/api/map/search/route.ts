import { createSupabaseServer } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

function computeRange(when: string): { start: Date; end: Date } {
  const now = new Date();
  let start = new Date(now);
  let end = new Date(now);

  switch (when) {
    case "today":
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;
    case "week":
      // rest of current week (Mon–Sun assumption? using ISO? We'll use calendar week Sun–Sat)
      start = new Date(now);
      const day = now.getDay(); // 0 Sun .. 6 Sat
      end = new Date(now);
      end.setDate(now.getDate() + (6 - day));
      end.setHours(23, 59, 59, 999);
      break;
    case "month":
      start = new Date(now);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
      break;
    case "weekend":
      // Upcoming (or current) Saturday/Sunday window
      const temp = new Date(now);
      const dow = temp.getDay(); // 0 Sun .. 6 Sat
      let sat = new Date(temp);
      let sun = new Date(temp);
      if (dow === 6) {
        // Saturday now
        sat.setHours(0, 0, 0, 0);
        sun.setDate(sat.getDate() + 1);
      } else if (dow === 0) {
        // Sunday now
        sat.setDate(sun.getDate() - 1);
        sat.setHours(0, 0, 0, 0);
      } else {
        // Weekday: find next Saturday
        const daysToSat = 6 - dow;
        sat.setDate(sat.getDate() + daysToSat);
        sat.setHours(0, 0, 0, 0);
        sun = new Date(sat);
        sun.setDate(sat.getDate() + 1);
      }
      sun.setHours(23, 59, 59, 999);
      start = sat;
      end = sun;
      break;
    default:
      start = new Date(now);
      end = new Date("2099-12-31T23:59:59Z");
  }
  return { start, end };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const minLng = parseFloat(searchParams.get("minLng") || "");
  const minLat = parseFloat(searchParams.get("minLat") || "");
  const maxLng = parseFloat(searchParams.get("maxLng") || "");
  const maxLat = parseFloat(searchParams.get("maxLat") || "");
  const when = searchParams.get("when") || "today";

  if (
    Number.isNaN(minLng) ||
    Number.isNaN(minLat) ||
    Number.isNaN(maxLng) ||
    Number.isNaN(maxLat)
  ) {
    return NextResponse.json({ error: "Missing or invalid map bounds" }, { status: 400 });
  }

  try {
    const { start, end } = computeRange(when);
    const supabase = await createSupabaseServer();

    const { data, error } = await supabase.rpc("map_events_bbox", {
      p_min_lng: minLng,
      p_min_lat: minLat,
      p_max_lng: maxLng,
      p_max_lat: maxLat,
      p_start: start.toISOString(),
      p_end: end.toISOString(),
    });

    if (error) {
      console.error("Map search RPC error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const pins = (data ?? []).map((row: any) => ({
      id: row.event_id,
      title: row.title,
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
