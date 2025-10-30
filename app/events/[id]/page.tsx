import { createSupabaseServer } from "@/lib/supabase/server";
import ModalPresenter from "@/app/(app)/@modal/(..)/events/[id]/presenter";
import { notFound } from "next/navigation";

type Params = { id: string };

export const revalidate = 0;

async function loadEvent(id: string) {
  const supabase = await createSupabaseServer();
  
  // Get user to hydrate status, but don't require it
  const { data: { user } } = await supabase.auth.getUser();

  const { data: event, error } = await supabase
    .from("events")
    .select(`
      id, title, description, starts_at, ends_at, address, latitude, longitude, image_url, series_id,
      event_media ( image_url, sort_index )
    `)
    .eq("id", id)
    .single();

  if (error || !event) {
    return null;
  }

  // If user is logged in, hydrate their specific statuses
  if (user) {
    const [starRes, notificationRes] = await Promise.all([
      supabase.from("event_stars").select("event_id").eq("user_id", user.id).eq("event_id", id).maybeSingle(),
      supabase.from("event_notifications").select("notify").eq("user_id", user.id).eq("event_id", id).maybeSingle()
    ]);
    (event as any).is_starred = !!starRes.data;
    (event as any).is_notified = notificationRes.data?.notify ?? false;
  }

  return event;
}

export default async function EventPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const event = await loadEvent(id);

  if (!event) {
    notFound();
  }

  // This wrapper provides the dark background overlay, fixing the white text issue.
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4">
      <ModalPresenter event={event as any} />
    </div>
  );
}