export const revalidate = 0;

import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import SignOutButton from "@/components/SignOutButton";
import Link from "next/link";
import FavoriteEventsSection from "@/components/profile/FavoriteEventsSection";
import ProfileHeader from "@/components/profile/ProfileHeader";
import SwitchViewButton from "@/components/profile/SwitchViewButton";
import ProfileStats from "@/components/profile/ProfileStats";
import BadgeRow from "@/components/profile/BadgeRow";

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

  // Get count of events with notifications enabled
  const { count: remindedCount } = await supabase
    .from("event_notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("notify", true);

  // Get count of user check-ins
  const { count: checkinCount } = await supabase
    .from("check_ins")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);

  // Two-step fetch: check_ins → events (normalize keys to strings to avoid Map miss)
  const { data: checkinRows } = await supabase
    .from("check_ins")
    .select("event_id, checked_at")
    .eq("user_id", user.id)
    .order("checked_at", { ascending: false })
    .limit(200);

  const checkedAtMap = new Map<string, string>(
    (checkinRows ?? []).map(r => [String(r.event_id), String(r.checked_at)])
  );

  const checkinEventIds = Array.from(
    new Set((checkinRows ?? []).map(r => String(r.event_id)))
  );

  let checkedInEvents: Array<any> = [];

  if (checkinEventIds.length) {
    const { data: rows } = await supabase
      .from("events")
      .select(`
        id, title, description, starts_at, ends_at, address, image_url,
        latitude, longitude, series_id,
        event_media ( image_url, sort_index )
      `)
      .in("id", checkinEventIds);

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
      is_starred: false,
      event_media: ev.event_media ?? null,
    });

    checkedInEvents =
      (rows ?? [])
        .map((e: any) => ({
          ...normalize(e),
          checked_in_at: checkedAtMap.get(String(e.id)) as string, // keys normalized above
        }))
        .sort((a, b) => new Date(b.checked_in_at).getTime() - new Date(a.checked_in_at).getTime());
  }

  // Load starred events (two-step for clarity/RLS-friendliness)
  const { data: starRows } = await supabase
    .from("event_stars")
    .select("event_id")
    .eq("user_id", user.id)
    .limit(200);

  const eventIds = (starRows ?? []).map(r => r.event_id);

  // move/define normalize here so we use it when mapping rows -> favoriteEvents
  const normalize2 = (ev: any) => ({
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
    // Add event_media to the normalized object
    event_media: ev.event_media ?? null,
  });

  let favoriteEvents: Array<{
    id: string;
    title: string;
    description: string | null;
    starts_at: string;
    ends_at: string | null;
    address: string | null;
    image_url: string | null;
    // Add the event_media type here
    event_media: { image_url: string; sort_index: number }[] | null;
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
        vendors!events_vendor_id_fkey ( id, name, slug ),
        event_media ( image_url, sort_index )
      `)
      .in("id", eventIds);

    // use normalize so is_starred and other normalized fields are present
    favoriteEvents = (rows ?? []).map((e: any) => {
      const base = normalize2(e);
      return {
        ...base,
        vendor: e.vendors ? { id: e.vendors.id, name: e.vendors.name, slug: e.vendors.slug } : null,
      };
    });
  }

  // Fetch badge progress (3 rows expected)
  const { data: badgeRows } = await supabase
    .from("v_user_badges")
    .select("*")
    .eq("user_id", user.id)
    .order("badge_id", { ascending: true })
    .limit(3);

  const favoriteCount = favoriteEvents.length;
  const initials = (user.user_metadata?.name || user.email || "?")
    .split(/\s+/).map((p: string) => p[0]).join("").slice(0, 2).toUpperCase();

  return (
    <main className="px-4 pt-6">
      <div className="mx-auto w-full max-w-4xl space-y-8 pb-10">
        <ProfileHeader user={user} />

        <ProfileStats
          favoriteCount={favoriteCount}
          checkinCount={checkinCount ?? 0}
          checkedInEvents={checkedInEvents}
        />

        {/* Badges row: replace controls for non-admin; below controls for admin */}
        {isAdmin ? (
          <>
            <section className="space-y-4">
              <section>
                <Link href="/admin" className="btn btn-outline w-full">Admin Panel</Link>
              </section>
              <SwitchViewButton />
            </section>
            <BadgeRow badges={badgeRows ?? []} />
          </>
        ) : (
          <BadgeRow badges={badgeRows ?? []} />
        )}

        <div className="divider"></div>

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
          <FavoriteEventsSection events={favoriteEvents} />
        )}
      </div>
    </main>
  );
}
