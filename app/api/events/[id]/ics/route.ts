import { createSupabaseServer } from "@/lib/supabase/server";
import { type NextRequest, NextResponse } from "next/server";
import * as ics from "ics";

// Helper to convert a JS Date object into the array format required by the 'ics' package.
function toDateArray(date: Date): ics.DateArray {
  return [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
  ];
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // This line forces the route to be dynamic and ensures `params` is populated.
  const { searchParams } = new URL(req.url);

  const supabase = await createSupabaseServer();
  const eventId = params.id; // This will now work correctly.
  const reminderDays = parseInt(searchParams.get("reminderDays") || "1", 10);

  // 1. Fetch the specific event from Supabase
  const { data: event, error: dbError } = await supabase
    .from("events")
    // Use PostGIS functions ST_Y and ST_X to extract lat/lon from the 'geom' column
    .select("id, title, description, starts_at, ends_at, address, latitude, longitude")
    .eq("id", eventId)
    .single();

  if (dbError || !event) {
    console.error("ICS generation failed for event ID:", eventId, "DB Error:", dbError?.message);
    return new NextResponse("Event not found", { status: 404 });
  }

  // 2. Construct the event object for the 'ics' package
  const icsEvent: ics.EventAttributes = {
    title: event.title,
    description: `${event.description || ''}\n\nView event details: ${req.nextUrl.origin}/events/${event.id}`,
    location: event.address || undefined,
    start: toDateArray(new Date(event.starts_at)),
    ...(event.ends_at && { end: toDateArray(new Date(event.ends_at)) }),
    url: `${req.nextUrl.origin}/events/${event.id}`,
    geo: event.latitude && event.longitude ? { lat: event.latitude, lon: event.longitude } : undefined,
    alarms: [
      {
        action: 'display',
        description: 'Reminder',
        trigger: { days: reminderDays, before: true },
      },
    ],
  };

  // 3. Generate the .ics file content
  const { error, value } = ics.createEvent(icsEvent);

  if (error) {
    console.error("Failed to create ICS file:", error);
    return new NextResponse("Could not generate calendar file.", { status: 500 });
  }

  // 4. Return the file as a download, suggesting 'inline' for better mobile UX
  return new Response(value, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${event.title.replace(/[^a-z0-9]/gi, '_')}.ics"`,
    },
  });
}