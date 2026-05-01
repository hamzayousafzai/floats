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

  // Get count of user check-ins
  const { count: checkinCount } = await supabase
    .from("check_ins")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);

  // Two-step fetch: check_ins → events
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
          checked_in_at: checkedAtMap.get(String(e.id)) as string,
        }))
        .sort((a, b) => new Date(b.checked_in_at).getTime() - new Date(a.checked_in_at).getTime());
  }

  // Load starred events
  const { data: starRows } = await supabase
    .from("event_stars")
    .select("event_id")
    .eq("user_id", user.id)
    .limit(200);

  const eventIds = (starRows ?? []).map(r => r.event_id);

  // Fetch all event notification statuses for the user
  const { data: notificationRows } = await supabase
    .from("event_notifications")
    .select("event_id")
    .eq("user_id", user.id)
    .eq("notify", true);

  const notifiedEventIds = new Set(notificationRows?.map(r => r.event_id) ?? []);

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
    event_media: ev.event_media ?? null,
    is_notified: notifiedEventIds.has(ev.id),
  });

  let favoriteEvents: Array<any> = [];

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

  // Fetch badge progress
  const { data: badgeRows } = await supabase
    .from("v_user_badges")
    .select("*")
    .eq("user_id", user.id)
    .order("badge_id", { ascending: true })
    .limit(3);

  const favoriteCount = favoriteEvents.length;

  return (
    // VISUAL UPDATE: Changed bg-base-300 to bg-base-200 for the main page background
    <main className="min-h-screen pt-6 bg-base-200">
      <div className="mx-auto w-full max-w-4xl space-y-6 pb-24 px-4 overflow-hidden">
        <ProfileHeader user={user} />

        <ProfileStats
          favoriteCount={favoriteCount}
          checkinCount={checkinCount ?? 0}
        />

        {/* Progress / Badges card — always visible */}
        <div className="rounded-2xl bg-base-100 p-5 shadow-sm">
          <BadgeRow badges={badgeRows ?? []} />
        </div>

        {/* Account actions card */}
        <div className="rounded-2xl bg-base-100 p-5 space-y-3 shadow-sm">
          {/* Admin Panel — admins only */}
          {isAdmin && (
            <Link
              href="/admin"
              className="btn btn-ghost bg-base-200/50 w-full justify-between font-medium hover:bg-base-200"
            >
              <span className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50"><rect width="3" height="11" x="2" y="12"/><rect width="3" height="7" x="9" y="8"/><rect width="3" height="15" x="16" y="4"/></svg>
                Admin Panel
              </span>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50"><path d="m9 18 6-6-6-6"/></svg>
            </Link>
          )}

          <SwitchViewButton />
        </div>

        <div className="divider opacity-50"></div>

        {favoriteCount === 0 && checkedInEvents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-base-content/20 px-6 py-10 text-center bg-base-100">
            <h3 className="text-lg font-semibold">No Activity Yet</h3>
            <p className="mt-2 text-sm text-base-content/70">
              Tap the star on an event to save it here.
            </p>
          </div>
        ) : (
          <FavoriteEventsSection events={favoriteEvents} checkedInEvents={checkedInEvents} />
        )}
      </div>
    </main>
  );
}
