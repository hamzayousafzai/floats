export const revalidate = 0;

import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import SignOutButton from "@/components/SignOutButton";
import Link from "next/link";

type FavoriteRecord = { id: string; vendor_id: string };

export default async function ProfilePage() {
  const supabase = await createSupabaseServer();

  // Auth
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Check for admin status in the 'app_admins' table.
  const { data: adminRecord } = await supabase
    .from("app_admins")
    .select("user_id") // We just need to check if a row exists
    .eq("user_id", user.id)
    .single();

  // If a record exists for this user in app_admins, they are an admin.
  const isAdmin = !!adminRecord;

  // Favorites (raw) - This logic remains the same
  const { data: favRows } = await supabase
    .from("favorites")
    .select("id,vendor_id")
    .eq("user_id", user.id)
    .limit(200);

  const vendorIds = (favRows ?? []).map(f => f.vendor_id);
  let vendorsById = new Map<string, { id: string; slug: string; name: string; category: string | null }>();

  if (vendorIds.length) {
    const { data: vendorRows } = await supabase
      .from("vendors")
      .select("id,slug,name,category")
      .in("id", vendorIds);

    (vendorRows ?? []).forEach(v => vendorsById.set(v.id, v));
  }

  const favorites = (favRows ?? []).map(fr => ({
    favorite_id: fr.id,
    vendor_id: fr.vendor_id,
    vendor: vendorsById.get(fr.vendor_id) || null,
  }));

  const favoriteCount = favorites.filter(f => f.vendor).length;
  const visitedCount = 12; // TODO: replace with real metric later

  const initials = (user.user_metadata?.name || user.email || "?")
    .split(/\s+/)
    .map((p: string) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <main className="px-4 pt-6">
      <div className="mx-auto w-full max-w-md space-y-8 pb-10">
        {/* Header / identity */}
        <section className="flex items-start justify-between">
          <div className="flex gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black text-white text-lg font-medium">
              {initials}
            </div>
            <div>
              <h1 className="text-lg font-semibold">
                {user.user_metadata?.name || "Your Profile"}
              </h1>
              <p className="text-sm text-gray-600">{user.email}</p>
            </div>
          </div>
          <SignOutButton />
        </section>

        {/* Stats */}
        <section className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border px-4 py-3 text-center">
              <div className="text-xl font-semibold">{favoriteCount}</div>
              <div className="text-xs text-gray-500">Favorites</div>
            </div>
            <div className="rounded-xl border px-4 py-3 text-center">
              <div className="text-xl font-semibold">{visitedCount}</div>
              <div className="text-xs text-gray-500">Visited</div>
            </div>
        </section>

        {/* Admin Panel Button (conditionally rendered) */}
        {isAdmin && (
          <section>
            <Link href="/admin" className="btn btn-outline w-full">
              Admin Panel
            </Link>
          </section>
        )}

        {/* Favorites List */}
        <section>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-rose-500">❤</span>
            <h2 className="text-sm font-medium">Your Favorites</h2>
          </div>

          {favorites.length === 0 || favoriteCount === 0 ? (
            <div className="rounded-xl border px-6 py-10 text-center">
              <div className="mb-4 flex justify-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                  <span className="text-gray-400 text-2xl">♡</span>
                </div>
              </div>
              <p className="text-sm font-medium">No favorites yet</p>
              <p className="mx-auto mt-2 max-w-xs text-xs text-gray-500">
                Start exploring vendors and tap the heart icon to save your favorites!
              </p>
              <Link
                href="/explore"
                className="mt-5 inline-block rounded-md bg-black px-4 py-2 text-xs font-medium text-white"
              >
                Explore Vendors
              </Link>
            </div>
          ) : (
            <ul className="space-y-3">
              {favorites.map(f =>
                f.vendor ? (
                  <li key={f.favorite_id} className="rounded-lg border p-4">
                    <Link
                      href={`/vendor/${f.vendor.slug}`}
                      className="font-medium hover:underline"
                    >
                      {f.vendor.name}
                    </Link>
                    <div className="text-xs text-gray-500">
                      {f.vendor.category || "—"}
                    </div>
                  </li>
                ) : (
                  <li
                    key={f.favorite_id}
                    className="rounded-lg border border-dashed p-4 text-xs text-gray-500"
                  >
                    Missing vendor (id: {f.vendor_id})
                  </li>
                )
              )}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}