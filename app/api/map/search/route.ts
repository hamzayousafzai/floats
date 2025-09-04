import { type NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const minLng = searchParams.get("minLng");
  const minLat = searchParams.get("minLat");
  const maxLng = searchParams.get("maxLng");
  const maxLat = searchParams.get("maxLat");

  // Basic validation
  if (!minLng || !minLat || !maxLng || !maxLat) {
    return NextResponse.json(
      { error: "Missing bounding box parameters" },
      { status: 400 }
    );
  }

  try {
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.rpc("get_events_in_view", {
      min_lat: parseFloat(minLat),
      min_lng: parseFloat(minLng),
      max_lat: parseFloat(maxLat),
      max_lng: parseFloat(maxLng),
    });

    if (error) {
      console.error("Supabase RPC error:", error);
      throw error;
    }

    // The RPC function now returns all the data we need directly.
    return NextResponse.json(data);
  } catch (e) {
    const error = e as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
