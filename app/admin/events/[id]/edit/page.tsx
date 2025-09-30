import { createSupabaseServer } from "@/lib/supabase/server";
import EditEventForm from "@/components/admin/EditEventForm";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const revalidate = 0;

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = createSupabaseServer();
  const { id: eventId } = await params;
  
  const { data: event, error } = await supabase
    .from("events")
    .select("*")
    .eq("id", eventId)
    .single();

  if (error || !event) {
    return <p className="p-4">Event not found or error loading: {error?.message}</p>;
  }

  const { data: allCategories } = await supabase.from("categories").select("id, name");
  const { data: eventCategories } = await supabase
    .from("event_categories")
    .select("category_id")
    .eq("event_id", event.id);

  const currentCategoryIds = new Set(eventCategories?.map(ec => ec.category_id) ?? []);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Edit Event</h2>
        <Link href="/admin/events" className="flex items-center gap-2 text-sm text-gray-600 hover:text-black">
          <ArrowLeft className="h-4 w-4" />
          Back to Events
        </Link>
      </div>
      {/* Pass the ORIGINAL event object directly to the form */}
      <EditEventForm
        event={event}
        allCategories={allCategories ?? []}
        currentCategoryIds={currentCategoryIds}
      />
    </div>
  );
}