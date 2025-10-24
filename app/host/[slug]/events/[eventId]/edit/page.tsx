"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import EditEventForm from "@/components/admin/EditEventForm";
import { Loader2, ArrowLeft } from "lucide-react"; // Import ArrowLeft
import type { Database } from "@/lib/database.types";
import { useHost } from "@/lib/contexts/HostContext"; // Import useHost
import Link from "next/link"; // Import Link

type EventRow = Database["public"]["Tables"]["events"]["Row"];
type MediaRow = Database["public"]["Tables"]["event_media"]["Row"];
// FIX: Change category id type to string
type Category = { id: string; name: string; };

type EventWithMedia = EventRow & { event_media: MediaRow[] | null };

export default function EditHostEventPage() {
  const params = useParams();
  const eventId = Array.isArray(params.eventId) ? params.eventId[0] : params.eventId;
  
  // FIX: Get role and currentOrg from useHost
  const { role, currentOrg } = useHost();

  const [event, setEvent] = useState<EventWithMedia | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  // FIX: Change state to hold a Set of strings
  const [currentCategoryIds, setCurrentCategoryIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) return;

    const supabase = createSupabaseBrowserClient();

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      // Fetch event data, all categories, and this event's categories in parallel
      const [eventRes, categoriesRes, eventCategoriesRes] = await Promise.all([
        supabase
          .from("events")
          .select("*, event_media(*)")
          .eq("id", eventId)
          .single(),
        supabase.from("categories").select("id, name"),
        // FIX 2: Fetch the category IDs for the current event
        supabase
          .from("event_categories")
          .select("category_id")
          .eq("event_id", eventId),
      ]);

      if (eventRes.error) {
        setError(`Failed to fetch event: ${eventRes.error.message}`);
        console.error(eventRes.error);
      } else {
        setEvent(eventRes.data as EventWithMedia);
      }

      if (categoriesRes.error) {
        console.error(`Failed to fetch categories: ${categoriesRes.error.message}`);
      } else {
        // FIX: Remove the faulty map and filter. Use the data directly.
        setCategories(categoriesRes.data || []);
      }

      if (eventCategoriesRes.error) {
        console.error(`Failed to fetch event categories: ${eventCategoriesRes.error.message}`);
      } else {
        // FIX: Remove Number() conversion and create a Set of strings
        const ids = new Set((eventCategoriesRes.data || []).map(ec => ec.category_id));
        setCurrentCategoryIds(ids);
      }

      setLoading(false);
    };

    fetchData();
  }, [eventId]);

  if (loading) {
    return (
      <div className="flex justify-center items-center p-12">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="p-6 text-red-500">{error}</p>;
  }

  if (!event) {
    return <p className="p-6">Event not found.</p>;
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Edit Event</h1>
        {/* FIX: Add Cancel button */}
        {currentOrg && (
          <Link href={`/host/${currentOrg.slug}`} className="btn btn-ghost">
            <ArrowLeft size={16} className="mr-2" />
            Cancel
          </Link>
        )}
      </div>
      <EditEventForm
        event={event}
        allCategories={categories}
        currentCategoryIds={currentCategoryIds}
        role={role} // Pass role to the form
      />
    </div>
  );
}