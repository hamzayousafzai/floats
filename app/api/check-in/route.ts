import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const DEBUG = process.env.CHECKIN_DEBUG === "true";

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ code: "not_authenticated" }, { status: 401 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ code: "bad_request" }, { status: 400 }); }

  const { event_id, lat, lng, accuracy_m, method = "web", source = "browser_geolocation" } = body ?? {};
  if (!event_id || typeof lat !== "number" || typeof lng !== "number") {
    return NextResponse.json({ code: "bad_request" }, { status: 400 });
  }

  const ua = req.headers.get("user-agent") ?? undefined;
  const fwd = req.headers.get("x-forwarded-for") ?? undefined;

  if (DEBUG) {
    console.log("[check-in] request", {
      user_id: user.id,
      event_id,
      lat: Number(lat?.toFixed?.(6) ?? lat),
      lng: Number(lng?.toFixed?.(6) ?? lng),
      accuracy_m,
      method,
      source,
      ua: ua?.slice(0, 120),
      forwarded_for: fwd,
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
    const code =
      ["outside_time_window","bad_accuracy","outside_geofence","event_missing_location","event_not_found","invalid_coordinates","not_authenticated"]
        .find(c => msg.includes(c)) ?? "unknown_error";

    // Fetch the latest attempt for more context and log it
    let lastAttempt: any = null;
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
    } catch {
      // ignore
    }

    if (DEBUG) {
      console.error("[check-in] rpc error", {
        code,
        rpc_error: { message: error.message, details: (error as any).details, hint: (error as any).hint, code: (error as any).code },
        lastAttempt,
      });
    }

    return NextResponse.json({ code }, { status: 400 });
  }

  if (DEBUG) {
    console.log("[check-in] success", {
      user_id: user.id,
      event_id,
      check_in_id: data?.[0]?.check_in_id,
      distance_m: data?.[0]?.distance_m,
    });
  }

  return NextResponse.json({ ok: true, check_in_id: data?.[0]?.check_in_id, distance_m: data?.[0]?.distance_m });
}