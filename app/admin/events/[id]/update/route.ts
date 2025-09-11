import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const eventId = params.id;

  try {
    // Auth check
    const supabase = await createSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // It's good practice to also check if the user has an 'admin' role here.

    const body = await req.json();
    
    // Separate special fields from the main event data
    const { coords, category_ids, ...eventData } = body;

    // If vendor_id is an empty string, convert it to null for the database.
    if (eventData.vendor_id === "") {
      eventData.vendor_id = null;
    }

    // Handle coordinates to create geomWkt
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

    // Prepare the payload for the 'events' table update
    const updatePayload: any = {
      ...eventData,
      starts_at: new Date(eventData.starts_at).toISOString(),
      ends_at: eventData.ends_at ? new Date(eventData.ends_at).toISOString() : null,
    };

    if (geomWkt) {
      updatePayload.geom = geomWkt;
    }

    // Use the admin client for all database modifications
    const supabaseAdmin = createSupabaseAdmin();

    // 1. Update the main event details in the 'events' table
    const { error: eventUpdateError } = await supabaseAdmin
      .from("events")
      .update(updatePayload)
      .eq("id", eventId);

    if (eventUpdateError) {
      throw new Error(`Event update failed: ${eventUpdateError.message}`);
    }

    // 2. Sync categories: Delete all existing category associations for this event
    const { error: deleteError } = await supabaseAdmin
      .from("event_categories")
      .delete()
      .eq("event_id", eventId);

    if (deleteError) {
      throw new Error(`Failed to clear old categories: ${deleteError.message}`);
    }

    // 3. Sync categories: Insert the new category associations if any were selected
    if (category_ids && category_ids.length > 0) {
      const newLinks = category_ids.map((catId: number) => ({
        event_id: eventId,
        category_id: catId,
      }));

      const { error: insertError } = await supabaseAdmin
        .from("event_categories")
        .insert(newLinks);

      if (insertError) {
        throw new Error(`Failed to link new categories: ${insertError.message}`);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}