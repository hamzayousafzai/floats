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
    const { coords, category_ids, ...eventData } = body;

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

    // Prepare the payload using the safe conversion utility
    const updatePayload: any = {
      ...eventData,
      starts_at: convertToUTC(eventData.starts_at),
      ends_at: convertToUTC(eventData.ends_at),
    };

    if (geomWkt) {
      updatePayload.geom = geomWkt;
    }

    // Use the admin client for all database modifications
    const supabaseAdmin = createSupabaseAdmin();

    // 1. Update the main event
    const { error: eventUpdateError } = await supabaseAdmin
      .from("events")
      .update(updatePayload)
      .eq("id", eventId);

    if (eventUpdateError) throw new Error(`Event update failed: ${eventUpdateError.message}`);

    // 2. Sync categories
    await supabaseAdmin.from("event_categories").delete().eq("event_id", eventId);

    if (category_ids && category_ids.length > 0) {
      const newLinks = category_ids.map((catId: number) => ({
        event_id: eventId,
        category_id: catId,
      }));
      const { error: insertError } = await supabaseAdmin.from("event_categories").insert(newLinks);
      if (insertError) throw new Error(`Failed to link new categories: ${insertError.message}`);
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}