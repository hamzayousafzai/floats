import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const seriesId = (await params).id;
  const srv = await createSupabaseServer();
  const { data: { user } } = await srv.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const following = Boolean(body.following);

  try {
    if (following) {
      // only upsert the existing columns (user_id, series_id)
      const { error } = await srv
        .from("series_follows")
        .upsert([{ user_id: user.id, series_id: seriesId }], { onConflict: "user_id,series_id" });
      if (error) throw error;
    } else {
      const { error } = await srv
        .from("series_follows")
        .delete()
        .eq("user_id", user.id)
        .eq("series_id", seriesId);
      if (error) throw error;
    }

    return NextResponse.json({ ok: true, following });
  } catch (err: any) {
    console.error("series follow error:", err);
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
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
      .select("series_id")
      .eq("user_id", user.id)
      .eq("series_id", seriesId)
      .maybeSingle();
    if (error) throw error;
    const following = Boolean(data);
    return NextResponse.json({ following });
  } catch (err: any) {
    console.error("series follow GET error:", err);
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}