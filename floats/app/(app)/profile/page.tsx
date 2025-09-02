export const revalidate = 0;

import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import SignOutButton from "@/components/SignOutButton";

type FavoriteRow = {
  vendor_id: string;
  vendor: { slug: string; name: string; category: string | null } | null;
};

export default async function ProfilePage() {
  const supabase = await createSupabaseServer();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // NOTE: we filter by user_id even though RLS protects it—good hygiene.
  const { data, error } = await supabase
  .from("favorites")
  .select("vendor_id, vendors!favorites_vendor_id_fkey (slug, name, category)")
  .eq("user_id", user.id)
  .order("created_at", { ascending: false });

  if (error) {
    return <main className="p-4">Error: {error.message}</main>;
  }

  const favorites = (data ?? []) as FavoriteRow[];

  return (
    <main className="p-4 space-y-3">
      <SignOutButton next="/login" />
      <h1 className="text-xl font-semibold">Your Favorites</h1>
      <ul className="space-y-2">
        {favorites.length ? favorites.map((f, i) => (
          <li key={i} className="border rounded p-2">
            {f.vendor ? (
              <>
                <a className="underline" href={`/vendor/${f.vendor.slug}`}>{f.vendor.name}</a>
                <div className="text-xs text-gray-600">{f.vendor.category ?? "—"}</div>
              </>
            ) : (
              <div className="text-sm text-gray-500">Missing vendor</div>
            )}
          </li>
        )) : (
          <li className="text-gray-500 text-sm">No favorites yet.</li>
        )}
      </ul>
    </main>
  );
}
