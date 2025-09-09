import { createSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Helper function to generate a URL-friendly slug from a name
function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-") // Replace spaces with -
    .replace(/[^\w-]+/g, "") // Remove all non-word chars
    .replace(/--+/g, "-"); // Replace multiple - with single -
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: admin } = await supabase.from("app_admins").select("user_id").eq("user_id", user.id).single();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const eventsPayload = await req.json();
    const eventsToProcess = Array.isArray(eventsPayload) ? eventsPayload : [eventsPayload];

    if (eventsToProcess.length === 0 || !eventsToProcess[0].vendor_name) {
      return NextResponse.json({ error: "No event data or vendor name provided" }, { status: 400 });
    }

    const vendorName = eventsToProcess[0].vendor_name;
    let vendorId: string;

    // Step 1: Find or Create the Vendor
    const { data: existingVendor, error: findError } = await supabase
      .from("vendors")
      .select("id")
      .eq("name", vendorName)
      .single();

    if (existingVendor) {
      vendorId = existingVendor.id;
    } else if (findError && findError.code === 'PGRST116') { // PGRST116 means no rows found
      // Vendor not found, so we create it
      const { data: newVendor, error: createError } = await supabase
        .from("vendors")
        .insert({
          name: vendorName,
          slug: slugify(vendorName),
          created_by: user.id,
        })
        .select("id")
        .single();

      if (createError) {
        // This could happen if the generated slug already exists, or another issue.
        throw new Error(`Could not create new vendor: ${createError.message}`);
      }
      vendorId = newVendor!.id;
    } else if (findError) {
      // A different database error occurred during the find query
      throw new Error(`Error finding vendor: ${findError.message}`);
    }

    // Step 2: Prepare events with the correct vendor_id
    const eventsToInsert = eventsToProcess.map(event => {
      const { vendor_name, ...rest } = event; // Remove vendor_name
      return {
        ...rest,
        vendor_id: vendorId!, // Add the resolved vendor_id
      };
    });

    // Step 3: Insert the events
    const { error: insertError } = await supabase.from("events").insert(eventsToInsert);

    if (insertError) {
      console.error("Supabase insert error:", insertError);
      return NextResponse.json({ error: `Database error: ${insertError.message}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("API route error:", e);
    return NextResponse.json({ error: e.message || "An internal server error occurred." }, { status: 500 });
  }
}