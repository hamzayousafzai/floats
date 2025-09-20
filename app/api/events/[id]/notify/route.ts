import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const srv = await createSupabaseServer();
  const { data: { user } } = await srv.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const eventId = (await params).id;
  const body = await req.json().catch(() => ({}));
  const enabled = Boolean(body.enabled);
  const notify_before = body.notify_before ?? "24 hours";

  try {
    if (enabled) {
      const { error } = await srv
        .from("event_notifications")
        .upsert([{ user_id: user.id, event_id: eventId, notify: true, notify_before }], { onConflict: "user_id,event_id" });
      if (error) throw error;
    } else {
      const { error } = await srv
        .from("event_notifications")
        .delete()
        .eq("user_id", user.id)
        .eq("event_id", eventId);
      if (error) throw error;
    }
    return NextResponse.json({ ok: true, notified: enabled });
  } catch (err: any) {
    console.error("event notify error:", err);
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}

// GET returns current per-event notify state for the requesting user
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const srv = await createSupabaseServer();
  const { data: { user } } = await srv.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const eventId = (await params).id;
  try {
    const { data, error } = await srv
      .from("event_notifications")
      .select("notify")
      .eq("user_id", user.id)
      .eq("event_id", eventId)
      .maybeSingle();
    if (error) throw error;
    const notified = Boolean(data?.notify);
    return NextResponse.json({ notified });
  } catch (err: any) {
    console.error("event notify GET error:", err);
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}