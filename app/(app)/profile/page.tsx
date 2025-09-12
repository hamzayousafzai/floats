// app/profile/page.tsx
export const revalidate = 0;

import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import SignOutButton from "@/components/SignOutButton";
import Link from "next/link";
import FavoriteEventsSection from "@/components/profile/FavoriteEventsSection"; // NEW

export default async function ProfilePage() {
  const supabase = await createSupabaseServer();

  // Auth
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Admin flag
  const { data: adminRecord } = await supabase
    .from("app_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .single();
  const isAdmin = !!adminRecord;

  // Load starred events (two-step for clarity/RLS-friendliness)
  const { data: starRows } = await supabase
    .from("event_stars")
    .select("event_id")
    .eq("user_id", user.id)
    .limit(200);

  const eventIds = (starRows ?? []).map(r => r.event_id);
  let favoriteEvents: Array<{
    id: string;
    title: string;
    description: string | null;
    starts_at: string;
    ends_at: string | null;
    address: string | null;
    image_url: string | null;
    latitude: number | null;
    longitude: number | null;
    series_id: string | null;
    vendor: { id: string; name: string; slug: string | null } | null;
  }> = [];

  if (eventIds.length) {
    const { data: rows } = await supabase
      .from("events")
      .select(`
        id, title, description, starts_at, ends_at, address, image_url,
        latitude, longitude, series_id, vendor_id,
        vendors!events_vendor_id_fkey ( id, name, slug )
      `)
      .in("id", eventIds);

    favoriteEvents = (rows ?? []).map((e: any) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      starts_at: e.starts_at,
      ends_at: e.ends_at,
      address: e.address,
      image_url: e.image_url,
      latitude: e.latitude,
      longitude: e.longitude,
      series_id: e.series_id,
      vendor: e.vendors ? { id: e.vendors.id, name: e.vendors.name, slug: e.vendors.slug } : null,
    }));
  }

  const normalize = (ev: any) => ({
    id: ev.id,
    title: ev.title,
    starts_at: ev.starts_at,
    ends_at: ev.ends_at,
    description: ev.description ?? null,
    image_url: ev.image_url ?? null,
    address: ev.address ?? "",
    latitude: ev.latitude ?? null,
    longitude: ev.longitude ?? null,
    series_id: ev.series_id ?? null,
    categories: ev.categories ?? [],
    is_starred: true,
  });

  const now = Date.now();
  const upcoming = favoriteEvents.filter(e => Date.parse(String(e.starts_at)) > now)
    .sort((a, b) => Date.parse(String(a.starts_at)) - Date.parse(String(b.starts_at)));
  const past = favoriteEvents.filter(e => Date.parse(String(e.starts_at)) <= now)
    .sort((a, b) => Date.parse(String(b.starts_at)) - Date.parse(String(a.starts_at)));

  const orderedFavorites = [...upcoming, ...past];

  const favoriteCount = orderedFavorites.length;
  const visitedCount = 12; // TODO

  const initials = (user.user_metadata?.name || user.email || "?")
    .split(/\s+/).map((p: string) => p[0]).join("").slice(0, 2).toUpperCase();

  return (
    <main className="px-4 pt-6">
      <div className="mx-auto w-full max-w-md space-y-8 pb-10">
        {/* Header */}
        <section className="flex items-start justify-between">
          <div className="flex gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black text-white text-lg font-medium">
              {initials}
            </div>
            <div>
              <h1 className="text-lg font-semibold">{user.user_metadata?.name || "Your Profile"}</h1>
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

        {/* Admin Panel */}
        {isAdmin && (
          <section>
            <Link href="/admin" className="btn btn-outline w-full">Admin Panel</Link>
          </section>
        )}

        {/* Favorites */}
          {favoriteCount === 0 ? (
            <div className="rounded-xl border px-6 py-10 text-center">
              <div className="mb-4 flex justify-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                  <span className="text-gray-400 text-2xl">♡</span>
                </div>
              </div>
              <p className="text-sm font-medium">No favorites yet</p>
              <p className="mx-auto mt-2 max-w-xs text-xs text-gray-500">
                Start exploring events and tap the Favorite button to save them!
              </p>
              <Link href="/explore" className="mt-5 inline-block rounded-md bg-black px-4 py-2 text-xs font-medium text-white">
                Explore Events
              </Link>
            </div>
          ) : (
            <FavoriteEventsSection events={orderedFavorites} />
          )}
      </div>
    </main>
  );
}
