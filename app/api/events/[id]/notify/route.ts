import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { TablesInsert } from "@/lib/database.types";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabaseUserClient = await createSupabaseServer();
  const { data: { user } } = await supabaseUserClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const eventId = await (await params).id;
  const body = await req.json().catch(() => ({}));
  const enabled = Boolean(body.enabled);

  try {
    const supabaseAdmin = await createSupabaseAdmin();

    if (enabled) {
      // --- SUBSCRIBE LOGIC ---
      // 1. Upsert the user-owned subscription record (use user client)
      const { data: subscription, error: subError } = await supabaseUserClient
        .from("event_notifications")
        .upsert({ user_id: user.id, event_id: eventId, notify: true }, { onConflict: "user_id,event_id" })
        .select()
        .single();
      if (subError) throw subError;

      // 2. Fetch event details (can use user client)
      const { data: event } = await supabaseUserClient
        .from("events")
        .select("starts_at")
        .eq("id", eventId)
        .single();
      
      if (!event?.starts_at) {
        return NextResponse.json({ ok: true, notified: true });
      }

      // 3. Create notification jobs in memory
      const startTime = new Date(event.starts_at);
      const now = new Date();
      
      const queueJobs: TablesInsert<"event_notification_queue">[] = [];

      const fortyEightHoursBefore = new Date(startTime.getTime() - 48 * 60 * 60 * 1000);
      if (fortyEightHoursBefore > now) {
        queueJobs.push({
          user_id: user.id,
          event_id: eventId,
          subscription_id: subscription.id,
          notification_kind: 'reminder_48hr',
          scheduled_at: fortyEightHoursBefore.toISOString(),
        });
      }

      if (startTime > now) {
        queueJobs.push({
          user_id: user.id,
          event_id: eventId,
          subscription_id: subscription.id,
          notification_kind: 'reminder_start',
          scheduled_at: startTime.toISOString(),
        });
      }

      if (queueJobs.length > 0) {
        // 4. Insert into the queue (use admin client)
        const { error: queueError } = await supabaseAdmin.from("event_notification_queue").insert(queueJobs);
        if (queueError) {
          console.error("Failed to enqueue notifications:", queueError);
        }
      }

    } else {
      // --- UNSUBSCRIBE LOGIC ---
      // 1. Delete the user-owned subscription record (use user client)
      const { error: deleteError } = await supabaseUserClient
        .from("event_notifications")
        .delete()
        .eq("user_id", user.id)
        .eq("event_id", eventId);
      if (deleteError) throw deleteError;

      // Use admin client to bypass RLS for cancellation
      const { error: cancelError } = await supabaseAdmin
        .from("event_notification_queue")
        .update({ status: 'canceled', updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('event_id', eventId)
        .eq('status', 'pending');

      if (cancelError) {
        // Log the error but don't block the user response
        console.error("Failed to cancel queued notifications:", cancelError);
      }
    }

    return NextResponse.json({ ok: true, notified: enabled });

  } catch (err: any) {
    console.error("event notify error:", err);
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}

// The GET route can be removed as it's no longer necessary.
// The initial state should be loaded with the event data itself.
// export async function GET(...) { ... }