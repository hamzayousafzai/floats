import { createSupabaseServer } from "@/lib/supabase/server";
import ModalPresenter from "@/app/(app)/@modal/(..)/events/[id]/presenter";

type Params = { id: string };

export const revalidate = 0;

async function loadEvent(id: string) {
  const supabase = await createSupabaseServer();
  const { data } = await supabase
    .from("events")
    .select(`
      id, title, description, starts_at, ends_at, address, latitude, longitude, image_url, series_id,
      event_media ( image_url, sort_index )
    `)
    .eq("id", id)
    .single();
  return data ?? null;
}

export default async function EventPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const event = await loadEvent(id);
  // Presenter will handle null by navigating away if opened directly.
  return <ModalPresenter event={event as any} />;
}