import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: eventId } = await params;

    // 1. Authenticate and authorize the user as an admin
    const supabase = await createSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // You should also add a check here to ensure the user has an admin role.

    // 2. Use the admin client for elevated privileges
    const supabaseAdmin = createSupabaseAdmin();

    // 3. Delete dependent records from child tables first
    // It's best to do these in parallel for performance.
    await Promise.all([
      supabaseAdmin.from("event_notifications").delete().eq("event_id", eventId),
      supabaseAdmin.from("event_stars").delete().eq("event_id", eventId),
      supabaseAdmin.from("event_categories").delete().eq("event_id", eventId),
    ]);

    // 4. Now, delete the main event record
    const { error: deleteEventError } = await supabaseAdmin
      .from("events")
      .delete()
      .eq("id", eventId);

    if (deleteEventError) {
      // If the event deletion itself fails after cleaning up, throw an error
      throw new Error(`Failed to delete event: ${deleteEventError.message}`);
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("Delete event error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}