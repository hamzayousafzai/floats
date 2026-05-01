import { createSupabaseServer } from "@/lib/supabase/server";
import ModalPresenter from "./presenter";
import { notFound } from "next/navigation";

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
  if (user) {
    const [starRes, notificationRes] = await Promise.all([
      supabase.from("event_stars").select("event_id").eq("user_id", user.id).eq("event_id", id).maybeSingle(),
      supabase.from("event_notifications").select("notify").eq("user_id", user.id).eq("event_id", id).maybeSingle()
    ]);

    // 4. Augment the public event object with the user's data.
    (event as any).is_starred = !!starRes.data;
    (event as any).is_notified = notificationRes.data?.notify ?? false;
  }
  return <ModalPresenter event={event as any} />;
}