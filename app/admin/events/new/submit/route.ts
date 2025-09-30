import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { toDate } from 'date-fns-tz';

/**
 * Convert a datetime string from EST to UTC
 * The input is a local time string like "2025-09-30T13:00" that represents EST time
 * We need to convert it to UTC by ADDING the offset (4-5 hours)
 */
function convertESTtoUTC(dateTimeString: string): string {
  if (!dateTimeString) return dateTimeString;
  
  // Parse the string and treat it as America/New_York timezone
  // toDate interprets the string in the given timezone
  const estDate = toDate(dateTimeString, { timeZone: 'America/New_York' });
  
  return estDate.toISOString();
}

export async function POST(req: Request) {
  const srv = await createSupabaseServer();
  const { data: { user } } = await srv.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Admin check
  const { data: admin } = await srv.from("app_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // parse + normalize payload
  const raw = await req.json().catch(() => null);
  console.log("admin create payload (before timezone conversion):", raw);

  let vendorName: string | undefined;
  let events: any[] | undefined;

  if (Array.isArray(raw)) {
    events = raw;
    vendorName = raw[0]?.vendor_name;
  } else if (raw && Array.isArray(raw.events)) {
    events = raw.events;
    vendorName = raw.vendor_name ?? raw.events[0]?.vendor_name;
  } else if (raw && Array.isArray(raw.items)) {
    events = raw.items;
    vendorName = raw.vendor_name ?? raw.items[0]?.vendor_name;
  } else {
    return NextResponse.json({
      error: "Invalid payload: vendor_name and events[] required",
      received: Array.isArray(raw) ? "<array>" : Object.keys(raw ?? {}),
    }, { status: 400 });
  }

  if (!vendorName || !events || events.length === 0) {
    return NextResponse.json({
      error: "Invalid payload: vendor_name and events[] required",
      vendor_name_present: Boolean(vendorName),
      events_count: events?.length ?? 0
    }, { status: 400 });
  }

  try {
    const adminClient = createSupabaseAdmin();

    // Convert all event times from EST to UTC
    const convertedEvents = events.map(event => {
      const converted = { ...event };
      
      if (event.starts_at) {
        converted.starts_at = convertESTtoUTC(event.starts_at);
        console.log(`Converted start: ${event.starts_at} (EST) -> ${converted.starts_at} (UTC)`);
      }
      
      if (event.ends_at) {
        converted.ends_at = convertESTtoUTC(event.ends_at);
        console.log(`Converted end: ${event.ends_at} (EST) -> ${converted.ends_at} (UTC)`);
      }
      
      return converted;
    });

    // Build RPC payload with converted times
    const rpcPayload: any = { vendor_name: vendorName, events: convertedEvents };

    // If multiple dates provided, mark recurring so the function will create/upsert a series
    if (convertedEvents.length > 1) {
      rpcPayload.is_recurring = true;
      // optionally set a default series_title from the first event title
      if (!rpcPayload.series_title && convertedEvents[0]?.title) {
        rpcPayload.series_title = convertedEvents[0].title;
      }
    }

    // If the first event carries explicit series fields, pass them through
    const first = convertedEvents[0] ?? {};
    if (first.series_title) rpcPayload.series_title = first.series_title;
    if (first.series_notes) rpcPayload.series_notes = first.series_notes;
    if (first.series_id) rpcPayload.series_id = first.series_id;

    console.log("Final RPC payload with UTC times:", rpcPayload);

    // Best practice: Directly call RPC with strongly-typed handling of the response
    const result = await adminClient.rpc(
      "admin_create_events_with_series", 
      { p: rpcPayload }
    );
    
    // Handle errors from the RPC call
    if (result.error) {
      console.error("RPC error:", result.error);
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }
    
    // Apply strong typing to the response data
    interface EventCreationResult {
      event_id: string;
      series_id: string | null;
    }
    
    // Type assertion is applied after validating the response
    const data = result.data as EventCreationResult[] | null;
    
    // Now use the strongly-typed data
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