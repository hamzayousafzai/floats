import { createSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { type EventPin } from "@/lib/types";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const bounds = searchParams.get("bounds");
  const areaSlugs = searchParams.get("area_slugs")?.split(',');

  try {
    const supabase = createSupabaseServer();

    let query = supabase
      .from('events')
      .select(
        `
        id,
        title,
        description,
        starts_at,
        ends_at,
        image_url,
        address,
        geom,
        org:org_id ( name, slug ),
        series:series_id ( id, title )
        `
      )
      // FIX: Use the correct 'published' status for all public-facing queries.
      .eq('status', 'published')
      .order('starts_at', { ascending: true });

    if (bounds) {
      const { ne, sw } = JSON.parse(bounds);
      query = query.filter(
        'geom',
        'st_within',
        `POLYGON((${ne.lng} ${ne.lat}, ${sw.lng} ${ne.lat}, ${sw.lng} ${sw.lat}, ${ne.lng} ${sw.lat}, ${ne.lng} ${ne.lat}))`
      );
    }

    if (areaSlugs && areaSlugs.length > 0) {
      query = query.filter('org.slug', 'in', `(${areaSlugs.join(',')})`);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Map search error:", error);
      throw new Error(error.message);
    }

    // The geom column is a PostGIS point, e.g., "POINT(-80.8431 35.2271)"
    // We need to parse it to get lat/lng for the map pins.
    const eventsWithLatLng: EventPin[] = (data || []).map((event: any) => {
      let lat = 0;
      let lng = 0;
      if (event.geom) {
        const match = event.geom.match(/POINT\(([-\d.]+) ([-\d.]+)\)/);
        if (match) {
          lng = parseFloat(match[1]);
          lat = parseFloat(match[2]);
        }
      }
      return {
        id: event.id,
        title: event.title,
        description: event.description,
        starts_at: event.starts_at,
        ends_at: event.ends_at,
        address: event.address,
        vendorName: event.org?.name,
        vendorSlug: event.org?.slug,
        lat,
        lng,
      };
    });

    return NextResponse.json(eventsWithLatLng);

  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
