import { createSupabaseServer } from "@/lib/supabase/server";
import ModalPresenter from "./presenter";
import { notFound } from "next/navigation";
import type { ExploreCardData } from "@/lib/types";

export const revalidate = 0;

export default async function InterceptedEventModal({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServer();

  // 1. Get the current user. This is safe; `user` will be null if not logged in.
  const { data: { user } } = await supabase.auth.getUser();

  // 2. Fetch the public event data. This query does not depend on the user.
  const { data: event, error } = await supabase
    .from("events")
    .select(`
      id, title, description, starts_at, ends_at, address, 
      latitude, longitude, image_url, series_id, event_url,
      event_media ( image_url, sort_index )
    `)
    .eq("id", id)
    .single();

  if (error || !event) {
    notFound();
  }

  // 3. If a user is logged in, fetch their specific statuses for this event.
  let isStarred = false;
  let isNotified = false;
  if (user) {
    const [starRes, notificationRes] = await Promise.all([
      supabase.from("event_stars").select("event_id").eq("user_id", user.id).eq("event_id", id).maybeSingle(),
      supabase.from("event_notifications").select("notify").eq("user_id", user.id).eq("event_id", id).maybeSingle()
    ]);
    isStarred = !!starRes.data;
    isNotified = notificationRes.data?.notify ?? false;
  }

  const cardData: ExploreCardData = {
    id: event.id,
    title: event.title,
    description: event.description ?? null,
    starts_at: event.starts_at,
    ends_at: event.ends_at,
    address: event.address ?? null,
    latitude: event.latitude,
    longitude: event.longitude,
    image_url: event.image_url,
    event_url: event.event_url,
    event_media: event.event_media ?? null,
    series_id: event.series_id,
    categories: [],
    is_starred: isStarred,
    is_notified: isNotified,
  };
  return <ModalPresenter event={cardData} />;
}