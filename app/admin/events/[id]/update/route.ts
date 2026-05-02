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
    const supabase = await createSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    
    // Extract the specific parts we need
    const { coords, category_ids, event_media, org_id: newOrgId } = body;

    const supabaseAdmin = createSupabaseAdmin();

    // 1. Fetch current event so we can auth-check org membership.
    const { data: currentEvent, error: fetchError } = await supabaseAdmin
      .from('events')
      .select('org_id, series_id')
      .eq('id', eventId)
      .single();

    if (fetchError) throw new Error(`Could not fetch current event: ${fetchError.message}`);

    // 2. Auth: platform admin OR member of the event's org.
    const { data: adminRow } = await supabase.from("app_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!adminRow) {
      const { data: membership } = await supabase
        .from("org_members")
        .select("role")
        .eq("org_id", currentEvent.org_id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // 3. If the org_id has changed, call the specific RPC for it.
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

    type MediaItem = { image_url?: string; sort_index: number };
    // Build ONLY the fields that belong in the events table for the general update
    const updatePayload: Record<string, unknown> = {
      title: body.title,
      description: body.description,
      starts_at: convertToUTC(body.starts_at),
      ends_at: convertToUTC(body.ends_at),
      address: body.address,
      is_market: body.is_market ?? false,
      is_featured: body.is_featured ?? false,
      status: body.status ?? 'confirmed',
      vendor_id: body.vendor_id === "" ? null : body.vendor_id,
      event_url: body.event_url || null,
    };

    // Set the primary image
    const primaryImage = (event_media as MediaItem[] | undefined)?.find((m) => m.sort_index === 0);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      p_event_data: updatePayload as any,
      p_media_data: event_media || [],
      p_category_ids: category_ids || []
    });

    if (updateError) {
      console.error("RPC error details:", updateError);
      throw new Error(`Transaction failed: ${updateError.message}`);
    }

    // Propagate event_url across the entire series if one exists.
    if (currentEvent.series_id) {
      const { error: seriesError } = await supabaseAdmin
        .from('events')
        .update({ event_url: body.event_url || null })
        .eq('series_id', currentEvent.series_id);
      if (seriesError) {
        console.error("Series event_url propagation error:", seriesError);
        // Non-fatal: the primary event was updated; log but don't fail the request.
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    console.error("Update route error:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Update failed" }, { status: 500 });
  }
}