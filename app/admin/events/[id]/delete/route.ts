import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Define roles that are allowed to perform deletions
const ALLOWED_ROLES = ["owner", "manager", "admin"];

// Main handler for both DELETE and POST methods
async function handler(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: eventId } = await params;

    // Auth check
    const supabase = await createSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createSupabaseAdmin();

    // Fetch the event to get its org_id for the role check
    const { data: evt, error: evtErr } = await admin
      .from("events")
      .select("id, org_id, series_id")
      .eq("id", eventId)
      .single();

    if (evtErr || !evt) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Check if user is a global admin first
    const { data: adminRecord } = await admin
      .from("app_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!adminRecord) {
      // Not a global admin — fall back to org membership check
      const { data: mem, error: memErr } = await supabase
        .from("org_members")
        .select("role")
        .eq("org_id", evt.org_id)
        .eq("user_id", user.id)
        .single();

      if (memErr || !mem || !ALLOWED_ROLES.includes(mem.role)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    // Cleanup all related child tables
    await Promise.all([
      admin.from("event_notifications").delete().eq("event_id", eventId),
      admin.from("event_stars").delete().eq("event_id", eventId),
      admin.from("event_categories").delete().eq("event_id", eventId),
      admin.from("event_media").delete().eq("event_id", eventId),
    ]);

    // Delete the event itself
    const { error: delErr } = await admin.from("events").delete().eq("id", eventId);
    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    // If the event was part of a series, check if the series is now empty
    if (evt.series_id) {
      const { data: remaining, error: remErr } = await admin
        .from("events")
        .select("id")
        .eq("series_id", evt.series_id)
        .limit(1);

      // If no events are left in the series, delete the series
      if (!remErr && (!remaining || remaining.length === 0)) {
        await admin.from("series").delete().eq("id", evt.series_id);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("Delete event error:", e);
    return NextResponse.json({ error: e?.message || "Failed to delete event" }, { status: 500 });
  }
}

// Export the handler for both DELETE and POST HTTP methods
export { handler as DELETE, handler as POST };