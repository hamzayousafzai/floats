import { createSupabaseServer } from "@/lib/supabase/server";
import { notFound } from "next/navigation";

type Props = {
  params: {
    id: string;
  };
};

// This is a Server Component that fetches data for a single event
export default async function EventDetailPage({ params }: Props) {
  const supabase = createSupabaseServer();

  const { data: event, error } = await supabase
    .from("events")
    .select(`
      *,
      vendor:vendors(*)
    `)
    .eq("id", params.id)
    .single();

  if (error || !event) {
    // If no event is found, show the standard 404 page
    notFound();
  }

  return (
    <div className="p-4 md:p-8">
      <h1 className="text-3xl font-bold">{event.title}</h1>
      <p className="text-lg text-gray-600 mt-2">Hosted by {event.vendor?.name}</p>
      <div className="mt-6">
        <h2 className="text-xl font-semibold">Details</h2>
        <p className="mt-2 whitespace-pre-wrap">{event.description}</p>
      </div>
      {/* You can add more details like a map, images, etc. here */}
    </div>
  );
}