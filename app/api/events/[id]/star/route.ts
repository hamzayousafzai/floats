import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import type { Database } from "@/lib/database.types";

type EventStarsInsert = Database["public"]["Tables"]["event_stars"]["Insert"];
type SeriesFollowsInsert = Database["public"]["Tables"]["series_follows"]["Insert"];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const eventId = (await params).id;
  try {
    const supabase = await createSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const supabaseAdmin = createSupabaseAdmin();

    // Check if already starred
    const { data: existing } = await supabase.from("event_stars").select("event_id").eq("event_id", eventId).eq("user_id", user.id).maybeSingle();
    if (existing) {
      // Unstar
      const { error: delError } = await supabaseAdmin.from("event_stars").delete().match({ event_id: eventId, user_id: user.id });
      if (delError) throw new Error(delError.message);
      return NextResponse.json({ starred: false });
    } else {
      // typed payload and insert
      const starPayload: EventStarsInsert = { event_id: eventId, user_id: user.id };
      const { error: insertError } = await supabaseAdmin
        .from("event_stars")
        .insert([starPayload as any]);
      if (insertError) throw new Error(insertError.message);

      // If event has a series, auto-follow series (upsert) but only for future/ongoing occurrences
      const { data: ev } = await supabase
        .from("events")
        .select("series_id, ends_at, starts_at")
        .eq("id", eventId)
        .maybeSingle();

      if (ev?.series_id) {
        const endsAt = ev.ends_at ?? ev.starts_at;
        if (endsAt && new Date(endsAt) >= new Date()) {
          const followPayload: SeriesFollowsInsert = { user_id: user.id, series_id: ev.series_id };
          await supabaseAdmin
            .from("series_follows")
            .upsert([followPayload], { onConflict: "user_id,series_id" });
        }
      }

      return NextResponse.json({ starred: true });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}