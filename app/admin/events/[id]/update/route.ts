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
    const supabase = await createSupabaseServer(); // This is the user-scoped client
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: admin } = await supabase.from("app_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    
    // Extract the specific parts we need
    const { coords, category_ids, event_media, org_id: newOrgId } = body;

    const supabaseAdmin = createSupabaseAdmin(); // This is the admin (service_role) client

    // --- START OF LOGIC ---
    // 1. Get the current org_id to see if it has changed.
    const { data: currentEvent, error: fetchError } = await supabaseAdmin
      .from('events')
      .select('org_id')
      .eq('id', eventId)
      .single();

    if (fetchError) throw new Error(`Could not fetch current event: ${fetchError.message}`);

    // 2. If the org_id has changed, call the specific RPC for it.
    if (newOrgId && currentEvent.org_id !== newOrgId) {
      // --- THE FIX: Use the user-scoped client for this RPC call ---
      // This passes the user's auth context to the function so auth.uid() works.
      const { error: transferError } = await supabase.rpc('admin_reassign_event_org', {
        p_event_id: eventId,
        p_new_org_id: newOrgId,
      });
      if (transferError) {
        console.error("Org transfer RPC error:", transferError);
        throw new Error(`Failed to transfer event organization: ${transferError.message}`);
      }
    }
    // --- END OF LOGIC ---

    // Build ONLY the fields that belong in the events table for the general update
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

    // 3. Call the general update RPC for all other fields using the admin client.
    const { error: updateError } = await supabaseAdmin.rpc('update_event_with_media', {
      p_event_id: eventId,
      p_event_data: updatePayload,
      p_media_data: event_media || [],
      p_category_ids: category_ids || []
    });

    if (updateError) {
      console.error("RPC error details:", updateError);
      throw new Error(`Transaction failed: ${updateError.message}`);
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("Update route error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}