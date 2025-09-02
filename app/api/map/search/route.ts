import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const minLng = parseFloat(searchParams.get("minLng") || "");
  const minLat = parseFloat(searchParams.get("minLat") || "");
  const maxLng = parseFloat(searchParams.get("maxLng") || "");
  const maxLat = parseFloat(searchParams.get("maxLat") || "");
  const when = (searchParams.get("when") || "today") as "today" | "weekend" | "month";

  if ([minLng, minLat, maxLng, maxLat].some(Number.isNaN)) {
    return NextResponse.json({ error: "Invalid bbox" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name) => cookieStore.get(name)?.value } }
  );

  // Query via RPC to keep SQL clean (recommended), but inline SQL via a view also works.
  // Here we use a SQL string in a single call with filters.
  const { data, error } = await supabase.rpc("map_search_events", {
    p_min_lng: minLng, p_min_lat: minLat, p_max_lng: maxLng, p_max_lat: maxLat, p_time_filter: when
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}
