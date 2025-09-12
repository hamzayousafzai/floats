import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  const srv = await createSupabaseServer();
  const { data: { user } } = await srv.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Admin check
  const { data: admin } = await srv.from("app_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // parse + normalize payload
  const raw = await req.json().catch(() => null);
  console.log("admin create payload:", raw);

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

    // Build RPC payload and ensure the function sees recurring intent:
    const rpcPayload: any = { vendor_name: vendorName, events };

    // If multiple dates provided, mark recurring so the function will create/upsert a series
    if (events.length > 1) {
      rpcPayload.is_recurring = true;
      // optionally set a default series_title from the first event title
      if (!rpcPayload.series_title && events[0]?.title) {
        rpcPayload.series_title = events[0].title;
      }
    }

    // If the first event carries explicit series fields, pass them through
    const first = events[0] ?? {};
    if (first.series_title) rpcPayload.series_title = first.series_title;
    if (first.series_notes) rpcPayload.series_notes = first.series_notes;
    if (first.series_id) rpcPayload.series_id = first.series_id;

    // Call RPC: function expects single jsonb param named "p"
    const { data, error } = await adminClient.rpc("admin_create_events_with_series", { p: rpcPayload });

    if (error) {
      console.error("RPC error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const series_id = data?.[0]?.series_id ?? null;
    const event_ids = (data ?? []).map((r: any) => r.event_id);
    return NextResponse.json({ ok: true, series_id, event_ids, count: event_ids.length });
  } catch (e: any) {
    console.error("admin create route error:", e);
    return NextResponse.json({ error: e?.message ?? "Internal error" }, { status: 500 });
  }
}