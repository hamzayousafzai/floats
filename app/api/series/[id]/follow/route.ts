import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const seriesId = params.id;
  try {
    const supabase = await createSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const supabaseAdmin = createSupabaseAdmin();

    // Check existing follow
    const { data: existing } = await supabase.from("series_follows").select("*").eq("series_id", seriesId).eq("user_id", user.id).maybeSingle();
    if (existing) {
      const { error: delError } = await supabaseAdmin.from("series_follows").delete().match({ series_id: seriesId, user_id: user.id });
      if (delError) throw new Error(delError.message);
      return NextResponse.json({ following: false });
    } else {
      const { error: insertError } = await supabaseAdmin.from("series_follows").insert([{ series_id: seriesId, user_id: user.id }]);
      if (insertError) throw new Error(insertError.message);
      return NextResponse.json({ following: true });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}