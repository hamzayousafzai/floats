import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const seriesId = (await params).id;
  const srv = await createSupabaseServer();
  const { data: { user } } = await srv.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const following = Boolean(body.following);

  try {
    // Upsert the follow status. This will create the row or update the 'following' flag.
    const { error: upsertError } = await srv
      .from("series_follows")
      .upsert({ user_id: user.id, series_id: seriesId, following: following }, { onConflict: "user_id,series_id" });
    if (upsertError) throw upsertError;

    // If unfollowing, we must cancel pending notifications.
    if (!following) {
      const supabaseAdmin = await createSupabaseAdmin();
      
      // Get all future event IDs for this series
      const { data: futureEvents, error: eventsError } = await supabaseAdmin
        .from('events')
        .select('id')
        .eq('series_id', seriesId)
        .gt('starts_at', new Date().toISOString());
      
      if (eventsError) throw eventsError;

      if (futureEvents && futureEvents.length > 0) {
        const eventIds = futureEvents.map(e => e.id);

        // Cancel all pending jobs for this user for those future events
        const { error: cancelError } = await supabaseAdmin
          .from('event_notification_queue')
          .update({ status: 'canceled', updated_at: new Date().toISOString() })
          .eq('user_id', user.id)
          .in('event_id', eventIds)
          .eq('status', 'pending');
        
        if (cancelError) {
          console.error("Failed to cancel series notifications:", cancelError);
        }
      }
    }

    return NextResponse.json({ ok: true, following });
  } catch (err: unknown) {
    console.error("series follow error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Internal error" }, { status: 500 });
  }
}

// GET returns whether the requesting user follows this series
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const srv = await createSupabaseServer();
  const { data: { user } } = await srv.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const seriesId = (await params).id;
  try {
    const { data, error } = await srv
      .from("series_follows")
      .select("following") // Select the new 'following' column
      .eq("user_id", user.id)
      .eq("series_id", seriesId)
      .maybeSingle();
    if (error) throw error;
    
    // If data exists and 'following' is true, then they are following.
    const following = data?.following ?? false;
    return NextResponse.json({ following });
  } catch (err: unknown) {
    console.error("series follow GET error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Internal error" }, { status: 500 });
  }
}