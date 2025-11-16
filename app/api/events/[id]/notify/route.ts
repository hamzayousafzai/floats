import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const eventId = await (await params).id;
  const body = await req.json().catch(() => ({}));
  const enabled = Boolean(body.enabled);

  try {
    if (enabled) {
      // --- SUBSCRIBE LOGIC ---
      // 1. Upsert the subscription record (your existing logic)
      const { data: subscription, error: subError } = await supabase
        .from("event_notifications")
        .upsert({ user_id: user.id, event_id: eventId, notify: true }, { onConflict: "user_id,event_id" })
        .select()
        .single();
      if (subError) throw subError;

      // 2. Fetch the event's start time to schedule notifications
      const { data: event } = await supabase
        .from("events")
        .select("starts_at")
        .eq("id", eventId)
        .single();
      
      if (!event?.starts_at) {
        // If event has no start time, we can't schedule anything. Just confirm the subscription.
        return NextResponse.json({ ok: true, notified: true });
      }

      // 3. Create notification jobs in the queue
      const startTime = new Date(event.starts_at);
      const now = new Date();
      const queueJobs = [];

      // Schedule a 48-hour reminder if it's in the future
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

      // Schedule a start-time reminder if it's in the future
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
        const { error: queueError } = await supabase.from("event_notification_queue").insert(queueJobs);
        if (queueError) {
          console.error("Failed to enqueue notifications:", queueError);
          // Don't throw, as the main subscription succeeded. Log and continue.
        }
      }

    } else {
      // --- UNSUBSCRIBE LOGIC ---
      // 1. Delete the subscription record (your existing logic)
      const { error: deleteError } = await supabase
        .from("event_notifications")
        .delete()
        .eq("user_id", user.id)
        .eq("event_id", eventId);
      if (deleteError) throw deleteError;

      // 2. Cancel any pending notifications for this event and user
      const { error: cancelError } = await supabase
        .from("event_notification_queue")
        .update({ status: 'canceled', updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('event_id', eventId)
        .eq('status', 'pending');
      
      if (cancelError) {
        console.error("Failed to cancel queued notifications:", cancelError);
        // Don't throw, as the main unsubscription succeeded. Log and continue.
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