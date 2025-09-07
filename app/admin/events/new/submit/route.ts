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
  status?: string;
};

export async function POST(req: Request) {
  try {
    const supabase = await createSupabaseServer();
    const body = (await req.json()) as Partial<Body>;
    const { title, starts_at, address } = body;

    // Basic validation
    if (!title || !starts_at || !address) {
      return NextResponse.json({ error: "Missing required fields: title, starts_at, address" }, { status: 400 });
    }

    // The database trigger will handle geocoding the address automatically.
    // We no longer need to handle 'coords' or 'geom' here.
    const { data, error } = await supabase.from("events").insert({
      title: body.title,
      description: body.description || null,
      starts_at: new Date(body.starts_at).toISOString(),
      ends_at: body.ends_at ? new Date(body.ends_at).toISOString() : null,
      address: body.address,
      image_url: body.image_url || null,
      is_market: !!body.is_market,
      vendor_id: body.vendor_id || null,
      status: body.status || "confirmed",
      // latitude and longitude are left null; the trigger will fill them in.
    }).select().single();

    if (error) {
      console.error("Supabase insert error:", error);
      return NextResponse.json({ error: `Database error: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true, eventId: data.id });
  } catch (e: any) {
    console.error("API route error:", e);
    return NextResponse.json({ error: "An internal server error occurred." }, { status: 500 });
  }
}