import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { convertToUTC } from "@/lib/timezone"; // Import the new utility

export async function POST(req: Request) {
  // Auth & Admin checks
  const srv = await createSupabaseServer();
  const { data: { user } } = await srv.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: admin } = await srv.from("app_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const raw = await req.json().catch(() => null);

  // MODIFIED: Destructure to get event_media directly from the payload
  const { events, vendor_name, event_media, ...rest } = raw || {};

  if (!vendor_name || !events || !Array.isArray(events) || events.length === 0) {
    return NextResponse.json({
      error: "Invalid payload: vendor_name and events[] are required",
      received: Array.isArray(raw) ? "<array>" : Object.keys(raw ?? {}),
    }, { status: 400 });
  }

  try {
    const adminClient = createSupabaseAdmin();

    const convertedEvents = events.map(event => ({
      ...event,
      starts_at: convertToUTC(event.starts_at),
      ends_at: convertToUTC(event.ends_at),
    }));

    // MODIFIED: Build the complete RPC payload including event_media
    const rpcPayload: any = {
      ...rest, // Pass through other top-level properties like is_recurring
      vendor_name: vendor_name,
      events: convertedEvents,
      event_media: event_media || [], // Add the media array here
    };

    // If multiple dates provided, ensure is_recurring is set
    if (convertedEvents.length > 1) {
      rpcPayload.is_recurring = true;
    }

    console.log("Final RPC payload with UTC times:", rpcPayload);

    const result = await adminClient.rpc(
      "admin_create_events_with_series", 
      { p: rpcPayload }
    );
    
    if (result.error) {
      console.error("RPC error:", result.error);
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }
    
    interface EventCreationResult {
      event_id: string;
      series_id: string | null;
    }
    
    const data = result.data as EventCreationResult[] | null;
    
    const series_id = data?.[0]?.series_id ?? null;
    const event_ids = (data ?? []).map(r => r.event_id);
    
    return NextResponse.json({ 
      ok: true, 
      series_id, 
      event_ids, 
      count: event_ids.length 
    });
  } catch (e: any) {
    console.error("admin create route error:", e);
    return NextResponse.json({ error: e?.message ?? "Internal error" }, { status: 500 });
  }
}