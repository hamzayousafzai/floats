// app/explore/page.tsx
export const revalidate = 0; // always fresh while iterating

import { createSupabaseServer } from "@/lib/supabase/server";

export default async function ExplorePage() {
  const supabase = await createSupabaseServer();

  // 1) Fetch vendors
  const { data: vendors, error: vErr } = await supabase
    .from("vendors")
    .select("id, slug, name, category, photo_url")
    .order("name", { ascending: true })
    .limit(50);

  if (vErr) {
    // Basic error state
    return <main className="p-4">Error loading vendors: {vErr.message}</main>;
  }

  const vendorIds = (vendors ?? []).map(v => v.id);
  let nextEventsByVendor = new Map<string, any>();

  if (vendorIds.length) {
    const { data: nextEvents } = await supabase
      .from("next_event_per_vendor")
      .select("vendor_id, event_id, starts_at, ends_at, address")
      .in("vendor_id", vendorIds);

    (nextEvents ?? []).forEach((row) => nextEventsByVendor.set(row.vendor_id, row));
  }

  return (
    <main className="p-4 space-y-4">
      <h1 className="text-xl font-semibold">Explore</h1>
      <ul className="grid grid-cols-1 gap-3">
        {(vendors ?? []).map((v) => {
          const nxt = nextEventsByVendor.get(v.id);
          return (
            <li key={v.id} className="border rounded-lg p-3">
              <a href={`/vendor/${v.slug}`} className="font-medium underline">{v.name}</a>
              <div className="text-sm text-gray-600">{v.category}</div>
              {nxt ? (
                <div className="text-xs mt-1">
                  Next: {new Date(nxt.starts_at).toLocaleString()} @ {nxt.address ?? "TBA"}
                </div>
              ) : (
                <div className="text-xs mt-1 text-gray-500">No upcoming event</div>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
