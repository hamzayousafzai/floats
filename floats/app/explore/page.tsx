// app/explore/page.tsx
export const revalidate = 0;

import { createSupabaseServer } from "@/lib/supabase/server";
import FavoriteButton from "@/components/FavoriteButton";
import { toggleFavorite } from "@/app/actions/favorites";

export default async function ExplorePage() {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: vendors } = await supabase
    .from("vendors")
    .select("id, slug, name, category, photo_url")
    .order("name", { ascending: true })
    .limit(50);

  // Map of vendor_id -> favorited?
  let favSet = new Set<string>();
  if (user) {
    const { data: favs } = await supabase
      .from("favorites")
      .select("vendor_id")
      .eq("user_id", user.id);
    (favs ?? []).forEach((f: { vendor_id: string }) => favSet.add(f.vendor_id));
  }

  return (
    <main className="p-4 space-y-4">
      <h1 className="text-xl font-semibold">Explore</h1>
      <ul className="grid grid-cols-1 gap-3">
        {(vendors ?? []).map((v) => (
          <li key={v.id} className="border rounded-lg p-3 flex items-center justify-between">
            <div>
              <a href={`/vendor/${v.slug}`} className="font-medium underline">{v.name}</a>
              <div className="text-sm text-gray-600">{v.category ?? "—"}</div>
            </div>
            <FavoriteButton
              vendorId={v.id}
              initial={favSet.has(v.id)}
              action={toggleFavorite}
              revalidatePaths={["/explore", `/vendor/${v.slug}`]}
            />
          </li>
        ))}
      </ul>
    </main>
  );
}
