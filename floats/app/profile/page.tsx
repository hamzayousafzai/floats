// app/profile/page.tsx
export const revalidate = 0;

import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";

export default async function ProfilePage() {
  const supabase = await createSupabaseServer();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login"); // or render a sign-in page

  // Join favorites -> vendors for display
  const { data: favorites, error } = await supabase
    .from("favorites")
    .select("vendor_id, vendors:vendor_id (slug, name, category)")
    .order("created_at", { ascending: false });

  if (error) {
    return <main className="p-4">Error: {error.message}</main>;
  }

  return (
    <main className="p-4 space-y-3">
      <h1 className="text-xl font-semibold">Your Favorites</h1>
      <ul className="space-y-2">
        {(favorites ?? []).map((f, i) => (
          <li key={i} className="border rounded p-2">
            <a className="underline" href={`/vendor/${f.vendors.slug}`}>{f.vendors.name}</a>
            <div className="text-xs text-gray-600">{f.vendors.category ?? "—"}</div>
          </li>
        ))}
        {(!favorites || favorites.length === 0) && (
          <li className="text-gray-500 text-sm">No favorites yet.</li>
        )}
      </ul>
    </main>
  );
}
