import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

type Body = {
  title: string;
  description?: string;
  starts_at: string;
  ends_at?: string;
  address: string;
  image_url?: string;
  is_market?: boolean;
  vendor_id?: string;
  coords?: string;
  status?: string;
};

export async function POST(req: Request) {
  try {
    const supabase = await createSupabaseServer();

    const body = (await req.json()) as Partial<Body>;
    const { title, starts_at, address, vendor_id, coords } = body;

    if (!title || !starts_at || !address) {
      return NextResponse.json({ error: "Missing required fields: title, starts_at, address" }, { status: 400 });
    }

    let geomWkt: string | null = null;

    // If a vendor_id is provided, use its location for the event pin
    if (vendor_id) {
      const { data: vendor } = await supabase.from("vendors").select("geom").eq("id", vendor_id).single();
      if (vendor?.geom) {
        geomWkt = vendor.geom as unknown as string;
      }
    }

    // If no vendor location, use the manually entered lat/lng
    if (!geomWkt) {
      if (coords) {
        // Parse the "lat, lng" string, now robustly handling parentheses
        const parts = coords.replace(/[()]/g, '').split(',').map(s => s.trim());
        
        if (parts.length === 2) {
          const lat = parseFloat(parts[0]);
          const lng = parseFloat(parts[1]);

          if (!isNaN(lat) && !isNaN(lng)) {
            geomWkt = `SRID=4326;POINT(${lng} ${lat})`;
          } else {
            return NextResponse.json({ error: "Invalid coordinates format. Could not parse numbers." }, { status: 400 });
          }
        } else {
          return NextResponse.json({ error: "Invalid coordinates format. Expected 'latitude, longitude'." }, { status: 400 });
        }
      } else {
        return NextResponse.json({ error: "An event must have a location, either from a vendor or manual coordinates." }, { status: 400 });
      }
    }

    const { error } = await supabase.from("events").insert({
      title: body.title,
      description: body.description || null,
      starts_at: new Date(body.starts_at).toISOString(),
      ends_at: body.ends_at ? new Date(body.ends_at).toISOString() : null,
      address: body.address,
      image_url: body.image_url || null,
      is_market: !!body.is_market,
      vendor_id: body.vendor_id || null,
      status: body.status || "confirmed",
      geom: geomWkt,
    });

    if (error) {
      console.error("Supabase insert error:", error);
      return NextResponse.json({ error: `Database error: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("API route error:", e);
    return NextResponse.json({ error: "An internal server error occurred." }, { status: 500 });
  }
}