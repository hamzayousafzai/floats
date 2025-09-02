export const revalidate = 0;

import { notFound } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import FavoriteButton from "@/components/FavoriteButton";
import { toggleFavorite } from "@/app/actions/favorites";

type Params = Promise<{ slug: string }>;

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
      {/* ... upcoming events list ... */}
    </main>
  );
}
