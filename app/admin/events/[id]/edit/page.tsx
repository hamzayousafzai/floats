import { createSupabaseServer } from "@/lib/supabase/server";
import EditEventForm from "@/components/admin/EditEventForm";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

export const revalidate = 0;

export default async function EditEventPage({ params }: { params: { id: string } }) {
  const supabase = createSupabaseServer();
  const { id: eventId } = await params;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return notFound();

  // Fetch event, categories, and all orgs in parallel
  const [eventRes, categoriesRes, orgsRes] = await Promise.all([
    supabase.from("events").select(`*, event_media(*)`).eq("id", eventId).single(),
    supabase.from("categories").select("id, name"),
    // FIX: Select all columns to match the type expected by EditEventForm
    supabase.from("orgs").select("*").order("name"),
  ]);

  if (eventRes.error || !eventRes.data) {
    return <p className="p-4">Event not found or error loading: {eventRes.error?.message}</p>;
  }

  const { data: eventCategories } = await supabase
    .from("event_categories")
    .select("category_id")
    .eq("event_id", eventRes.data.id);

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
      <EditEventForm
        event={eventRes.data}
        allCategories={categoriesRes.data ?? []}
        currentCategoryIds={currentCategoryIds}
        orgs={orgsRes.data ?? []} // Pass the list of orgs
        role="admin" // Pass the platform admin role
      />
    </div>
  );
}