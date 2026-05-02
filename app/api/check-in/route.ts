import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
const DEBUG = process.env.CHECKIN_DEBUG === "true";

// NEW: status endpoint
export async function GET(req: NextRequest) {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ checked: false }, { status: 200 }); // soft-fail for UI

  const { searchParams } = new URL(req.url);
  const event_id = searchParams.get("event_id");
  if (!event_id) return NextResponse.json({ code: "bad_request" }, { status: 400 });

  const { data, error } = await supabase
    .from("check_ins")
    .select("id, checked_at, distance_m")
    .eq("user_id", user.id)
    .eq("event_id", event_id)
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ code: "unknown_error" }, { status: 400 });

  return NextResponse.json({
    checked: !!data,
    checked_at: data?.checked_at ?? null,
    distance_m: data?.distance_m ?? null,
  });
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ code: "not_authenticated" }, { status: 401 });

  let body: { event_id?: unknown; lat?: unknown; lng?: unknown; accuracy_m?: unknown; method?: unknown; source?: unknown; debug?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ code: "bad_request" }, { status: 400 }); }

  const { event_id, lat, lng, accuracy_m, method = "web", source = "browser_geolocation", debug = false } = body ?? {};
  if (!event_id || typeof lat !== "number" || typeof lng !== "number") {
    return NextResponse.json({ code: "bad_request" }, { status: 400 });
  }

  const ua = req.headers.get("user-agent") ?? undefined;

  if (DEBUG || debug) {
    console.log("[check-in][debug] User coordinates:", {
      user_id: user.id,
      event_id,
      user_lat: lat,
      user_lng: lng,
      accuracy_m,
      method,
      source,
      ua: ua?.slice(0, 120),
    });
  }

  const { data, error } = await supabase.rpc("check_in_event", {
    p_event_id: event_id,
    p_lat: lat,
    p_lng: lng,
    p_accuracy_m: typeof accuracy_m === "number" ? accuracy_m : null,
    p_method: method,
    p_source: source,
    p_ua: ua,
  });

  if (error) {
    const msg = String(error.message || "");
    const code = ["outside_time_window","bad_accuracy","outside_geofence","event_missing_location","event_not_found","invalid_coordinates","not_authenticated"]
      .find(c => msg.includes(c)) ?? "unknown_error";

    let lastAttempt: Record<string, unknown> | null = null;
    let eventRow: Record<string, unknown> | null = null;
    if (DEBUG || debug) {
      try {
        const { data: attempt } = await supabase
          .from("check_in_attempts")
          .select("status,failure_reason,accuracy_m,distance_m,created_at")
          .eq("user_id", user.id)
          .eq("event_id", event_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();
        lastAttempt = attempt ?? null;
      } catch {}
      try {
        const { data: ev } = await supabase
          .from("events")
          .select("id, latitude, longitude, starts_at, ends_at")
          .eq("id", event_id)
          .single();
        eventRow = ev ?? null;
      } catch {}
    }

    if (DEBUG || debug) {
      console.error("[check-in][debug] RPC error:", {
        code,
        rpc_error: { message: error.message, details: error.details, hint: error.hint, code: error.code },
        lastAttempt,
        eventRow,
      });
    }

    return NextResponse.json(
      { code, debug: (DEBUG || debug) ? { lastAttempt, event: eventRow } : undefined },
      { status: 400 }
    );
  }

  if (DEBUG || debug) {
    console.log("[check-in][debug] Success:", {
      user_id: user.id,
      event_id,
      check_in_id: data?.[0]?.check_in_id,
      distance_m: data?.[0]?.distance_m,
    });
  }

  return NextResponse.json({
    ok: true,
    check_in_id: data?.[0]?.check_in_id,
    distance_m: data?.[0]?.distance_m,
  });
}