import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

// Local helper to normalize to UTC ISO
const toUtcIso = (v: string) => new Date(v).toISOString();

export async function POST(req: Request) {
  // Auth check (hosts are allowed; RLS handles perms)
  const srv = await createSupabaseServer();
  const { data: { user } } = await srv.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // New model: org_id + events[]
  const {
    org_id,
    events,
    event_media = [],
    category_ids = [],
    is_recurring = false,
    ...rest
  } = body;

  if (!org_id || !Array.isArray(events) || events.length === 0) {
    return NextResponse.json(
      {
        error: "Invalid payload: org_id and events[] are required",
        received: Object.keys(body ?? {}),
      },
      { status: 400 }
    );
  }

  // Normalize event dates to UTC and pass through fields
  const eventsNormalized = events.map((e: any) => ({
    ...e,
    starts_at: toUtcIso(e.starts_at),
    ends_at: toUtcIso(e.ends_at),
  }));

  const p = {
    ...rest,
    org_id,
    events: eventsNormalized,
    event_media,
    category_ids,
    is_recurring: is_recurring || eventsNormalized.length > 1,
  };

  try {
    const admin = createSupabaseAdmin();
    // Reuse your RPC that creates single or series events
    const { data, error } = await admin.rpc("admin_create_events_with_series", { p });

    if (error) {
      console.error("RPC error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const event_ids = (data ?? []).map((r: any) => r.event_id);
    const series_id = (data ?? [])[0]?.series_id ?? null;

    return NextResponse.json({
      ok: true,
      series_id,
      event_ids,
      count: event_ids.length,
    });
  } catch (e: any) {
    console.error("create events route error:", e);
    return NextResponse.json({ error: e?.message ?? "Internal error" }, { status: 500 });
  }
}