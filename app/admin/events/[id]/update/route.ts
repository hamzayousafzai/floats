import { createSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(
  req: Request,
  context: { params: { id: string } }
) {
  const { params } = context;

  try {
    const supabase = await createSupabaseServer();
    const body = await req.json();
    const { coords, ...eventData } = body;

    // If vendor_id is an empty string, convert it to null for the database.
    if (eventData.vendor_id === "") {
      eventData.vendor_id = null;
    }

    let geomWkt: string | undefined = undefined;

    if (coords) {
      const parts = coords.replace(/[()]/g, "").split(",").map((s: string) => s.trim());
      if (parts.length === 2) {
        const lat = parseFloat(parts[0]);
        const lng = parseFloat(parts[1]);
        if (!isNaN(lat) && !isNaN(lng)) {
          geomWkt = `SRID=4326;POINT(${lng} ${lat})`;
        }
      }
    }

    const updatePayload: any = {
      ...eventData,
      starts_at: new Date(eventData.starts_at).toISOString(),
      ends_at: eventData.ends_at ? new Date(eventData.ends_at).toISOString() : null,
    };

    if (geomWkt) {
      updatePayload.geom = geomWkt;
    }

    const { error } = await supabase
      .from("events")
      .update(updatePayload)
      .eq("id", params.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}