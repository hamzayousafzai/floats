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
  const { data, error } = await supabase
    .from("events")
    .select(`
      id, 
      title, 
      description, 
      starts_at, 
      ends_at, 
      address, 
      latitude, 
      longitude, 
      image_url,
      series_id,
      event_media ( image_url, sort_index )
    `)
    .eq("id", id)
    .single();

  if (error || !data) {
    notFound();
  }
  
  return <ModalPresenter event={data as any} />;
}