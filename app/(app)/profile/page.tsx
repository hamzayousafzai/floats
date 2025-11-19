export const revalidate = 0;

import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
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

  // NEW: Fetch all event notification statuses for the user
  const { data: notificationRows } = await supabase
    .from("event_notifications")
    .select("event_id")
    .eq("user_id", user.id)
    .eq("notify", true);

  const notifiedEventIds = new Set(notificationRows?.map(r => r.event_id) ?? []);

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
    // NEW: Check if the event ID is in our set of notified events
    is_notified: notifiedEventIds.has(ev.id),
  });

  let favoriteEvents: Array<any> = []; // Type is complex, `any` is fine here

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
    // 1. Make the <main> tag a simple container with no horizontal padding.
    <main className="pt-6">
      <div className="mx-auto w-full max-w-4xl space-y-8 pb-10 px-4 overflow-hidden">
        <ProfileHeader user={user} />

        <ProfileStats
          favoriteCount={favoriteCount}
          checkinCount={checkinCount ?? 0}
          checkedInEvents={checkedInEvents}
        />

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

        {favoriteCount === 0 ? (
          <div className="rounded-xl border px-6 py-10 text-center">
            <h3 className="text-lg font-semibold">No Favorites Yet</h3>
            <p className="mt-2 text-sm text-base-content/70">
              Tap the star on an event to save it here.
            </p>
          </div>
        ) : (
          <FavoriteEventsSection events={favoriteEvents} />
        )}
      </div>
    </main>
  );
}
