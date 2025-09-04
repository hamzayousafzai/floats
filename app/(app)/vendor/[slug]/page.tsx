export const revalidate = 0;

import { notFound } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import FavoriteButton from "@/components/FavoriteButton";
import { toggleFavorite } from "@/app/actions/favorites";

type Params = Promise<{ slug: string }>;
type EventRow = {
  id: string;
  title: string | null;
  address: string | null;
  starts_at: string;
};

export default async function VendorPage({ params }: { params: Params }) {
  const { slug } = await params; 
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: vendor } = await supabase
    .from("vendors")
    .select("id, slug, name, description, category, photo_url")
    .eq("slug", slug)
    .maybeSingle();
  if (!vendor) return notFound();

  // initial favorite state
  let initFav = false;
  if (user) {
    const { data: fav } = await supabase
      .from("favorites")
      .select("vendor_id")
      .eq("user_id", user.id)
      .eq("vendor_id", vendor.id)
      .maybeSingle();
    initFav = !!fav;
  }

  const { data: events } = await supabase
    .from("events")
    .select("id, title, address, starts_at")
    .eq("vendor_id", vendor.id)
    .gt("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true });
  const upcoming = (events ?? []) as EventRow[];

  return (
    <main className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold">{vendor.name}</h1>
        <FavoriteButton
          vendorId={vendor.id}
          initial={initFav}
          action={toggleFavorite}
          revalidatePaths={[`/vendor/${vendor.slug}`, "/explore", "/profile"]}
        />
      </div>

      {vendor.description && <p className="text-gray-700">{vendor.description}</p>}
      <div className="text-sm text-gray-600">Category: {vendor.category ?? "—"}</div>
      <div>
        <h2 className="text-xl font-semibold">Upcoming Events</h2>
        <ul className="space-y-2 mt-2">
          {upcoming.length ? (
            upcoming.map((e) => (
              <li key={e.id} className="border rounded p-2">
                {e.title && <div className="font-medium">{e.title}</div>}
                <div className="text-sm">{new Date(e.starts_at).toLocaleString()}</div>
                {e.address && <div className="text-sm text-gray-600">{e.address}</div>}
              </li>
            ))
          ) : (
            <li className="text-sm text-gray-500">No upcoming events.</li>
          )}
        </ul>
      </div>
    </main>
  );
}
