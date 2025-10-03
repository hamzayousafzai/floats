import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { convertToUTC } from "@/lib/timezone"; // Import the new utility

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const eventId = (await params).id;

  try {
    // Auth & Admin checks
    const supabase = await createSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: admin } = await supabase.from("app_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    // Separate event_media from the rest of the data
    const { coords, category_ids, event_media, ...eventData } = body;

    if (eventData.vendor_id === "") {
      eventData.vendor_id = null;
    }

    let geomWkt: string | undefined = undefined;
    if (coords) {
      const parts = coords.replace(/[()]/g, "").split(",").map((s: string) => s.trim());
      if (parts.length === 2) {
        const lat = parseFloat(parts[0]);
        const lng = parseFloat(parts[1]);
        if (!isNaN(lat) && !isNaN(lng)) {
          geomWkt = `SRID=4326;POINT(${lng} ${lat})`;
        }
      }
    }

    // Prepare the payload for the 'events' table.
    // The primary image is the first one in the sorted array.
    const primaryImage = event_media?.find((m: any) => m.sort_index === 0);
    
    const updatePayload: any = {
      ...eventData,
      starts_at: convertToUTC(eventData.starts_at),
      ends_at: convertToUTC(eventData.ends_at),
      image_url: primaryImage?.image_url ?? null, // Set the primary image_url on the events table
    };

    if (geomWkt) {
      updatePayload.geom = geomWkt;
    }

    const supabaseAdmin = createSupabaseAdmin();

    // Transaction to update event and its media
    const { error } = await supabaseAdmin.rpc('update_event_with_media', {
      p_event_id: eventId,
      p_event_data: updatePayload,
      p_media_data: event_media || [],
      p_category_ids: category_ids || []
    });

    if (error) {
      throw new Error(`Transaction failed: ${error.message}`);
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}