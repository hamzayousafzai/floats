import { createSupabaseServer } from "@/lib/supabase/server";
import EditEventForm from "@/components/admin/EditEventForm";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const revalidate = 0;

export default async function EditEventPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = await createSupabaseServer();
  const { data: event, error } = await supabase
    .from("events")
    .select("*")
    .eq("id", params.id)
    .single();

  if (error || !event) {
    return <p>Event not found or error loading: {error?.message}</p>;
  }

  return (
    <div>
      <div className="mb-4">
        <Link href="/admin/events" className="flex items-center gap-2 text-sm text-gray-600 hover:text-black">
          <ArrowLeft className="h-4 w-4" />
          Back to Events List
        </Link>
      </div>
      <EditEventForm event={event} />
    </div>
  );
}