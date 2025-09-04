export const revalidate = 0;

import ExploreView from "@/components/explore/ExploreView";
import { createSupabaseServer } from "@/lib/supabase/server";

type NextEventRow = {
  vendor_id: string;
  starts_at: string;
  ends_at: string | null;
  address: string | null;
};

export default async function ExplorePage() {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: vendors, error: vErr } = await supabase
    .from("vendors")
    .select("id, slug, name, category, photo_url")
    .order("name", { ascending: true })
    .limit(100);

  if (vErr) {
    return <main className="p-4">Error loading vendors: {vErr.message}</main>;
  }

  const vendorIds = (vendors ?? []).map(v => v.id);

  let nextByVendor = new Map<string, NextEventRow>();
  if (vendorIds.length) {
    const { data: nextEvents } = await supabase
      .from("next_event_per_vendor")
      .select("vendor_id, starts_at, ends_at, address")
      .in("vendor_id", vendorIds);
    (nextEvents ?? []).forEach(r => nextByVendor.set(r.vendor_id, r as NextEventRow));
  }

  let favoriteIds: string[] = [];
  if (user) {
    const { data: favs } = await supabase
      .from("favorites")
      .select("vendor_id")
      .eq("user_id", user.id);
    favoriteIds = (favs ?? []).map(f => f.vendor_id);
  }

  const cardData = (vendors ?? []).map(v => {
    const nxt = nextByVendor.get(v.id);
    return {
      id: v.id,
      slug: v.slug,
      name: v.name,
      category: v.category,
      photo_url: v.photo_url,
      next: nxt ? {
        starts_at: nxt.starts_at,
        ends_at: nxt.ends_at,
        address: nxt.address
      } : null
    };
  });

  return (
    // wrapper ensures content doesn't sit beneath fixed nav
    <div className="h-full">
      <ExploreView
        vendors={cardData}
        favoriteIds={favoriteIds}
        typeOptions={["All", "Jewelry", "Vintage Shirts", "Food"]}
      />
    </div>
  );
}