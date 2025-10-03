import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { convertToUTC } from "@/lib/timezone";

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
    
    // Extract the specific parts we need
    const { coords, category_ids, event_media } = body;

    // Build ONLY the fields that belong in the events table
    const updatePayload: any = {
      title: body.title,
      description: body.description,
      starts_at: convertToUTC(body.starts_at),
      ends_at: convertToUTC(body.ends_at),
      address: body.address,
      is_market: body.is_market ?? false,
      is_featured: body.is_featured ?? false,
      status: body.status ?? 'confirmed',
      vendor_id: body.vendor_id === "" ? null : body.vendor_id,
    };

    // Set the primary image
    const primaryImage = event_media?.find((m: any) => m.sort_index === 0);
    updatePayload.image_url = primaryImage?.image_url ?? body.image_url ?? null;

    // Add geometry if provided
    if (coords) {
      const [lng, lat] = coords.split(",").map(parseFloat);
      if (!isNaN(lng) && !isNaN(lat)) {
        updatePayload.geom = `POINT(${lng} ${lat})`;
      }
    }

    const supabaseAdmin = createSupabaseAdmin();

    const { error } = await supabaseAdmin.rpc('update_event_with_media', {
      p_event_id: eventId,
      p_event_data: updatePayload,
      p_media_data: event_media || [],
      p_category_ids: category_ids || []
    });

    if (error) {
      console.error("RPC error details:", error);
      throw new Error(`Transaction failed: ${error.message}`);
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("Update route error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}