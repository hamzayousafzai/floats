export const revalidate = 0;

import { createSupabaseServer } from "@/lib/supabase/server";
import ExploreView from "@/components/explore/ExploreView";
import { type ExploreCardData } from "@/components/explore/EventCard"; // We will create this next

export default async function ExplorePage() {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 1. Fetch all upcoming/ongoing events and join their vendor data in one query.
  const { data: events, error } = await supabase
    .from("events")
    .select(`
      id, title, starts_at, ends_at, address, image_url, is_market,
      vendor:vendors ( id, slug, name, photo_url, category )
    `)
    .eq("status", "confirmed")
    .gte("starts_at", new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()) // Include events that started in the last 6 hours
    .order("starts_at", { ascending: true });

  if (error) {
    return <main className="p-4">Error loading events: {error.message}</main>;
  }

  // 2. Map the raw data to our new, unified card shape.
  const cards: ExploreCardData[] = (events ?? [])
    .filter((event) => {
      // Ensure ongoing events without an end date don't disappear immediately
      const start = new Date(event.starts_at).getTime();
      const end = event.ends_at ? new Date(event.ends_at).getTime() : null;
      if (end) return end > Date.now(); // If it has an end date, show it until it's over
      return start > Date.now() - 2 * 60 * 60 * 1000; // If no end date, show for 2 hours past start
    })
    .map((e) => ({
      id: e.id,
      href: `/events/${e.id}`, // Future event detail page
      imageUrl: e.image_url ?? e.vendor?.photo_url ?? null,
      title: e.title,
      // Use vendor category if it exists, otherwise determine from event type
      category: e.vendor?.category ?? (e.is_market ? "Market" : "Event"),
      starts_at: e.starts_at,
      address: e.address,
      // Attach vendor info if it exists
      vendor: e.vendor
        ? { id: e.vendor.id, name: e.vendor.name, slug: e.vendor.slug }
        : null,
    }));

  // 3. Fetch user's favorite VENDORS (event favorites can be added later)
  let favoriteVendorIds: string[] = [];
  if (user) {
    const { data: favs } = await supabase
      .from("favorites")
      .select("vendor_id")
      .eq("user_id", user.id);
    favoriteVendorIds = (favs ?? []).map((f) => f.vendor_id);
  }

  // 4. Get all unique category types for the filter chips
  const typeOptions = [
    "All",
    ...new Set(cards.map((c) => c.category).filter(Boolean)),
  ];

  return (
    <div className="fixed inset-0">
      <ExploreView
        cards={cards}
        favoriteVendorIds={favoriteVendorIds}
        typeOptions={typeOptions}
      />
    </div>
  );
}