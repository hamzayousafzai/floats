import { createSupabaseServer } from "@/lib/supabase/server";
import Link from "next/link";
import DeleteEventButton from "@/components/admin/DeleteEventButton";
import { ArrowLeft } from "lucide-react";

export const revalidate = 0;

export default async function AdminEventsListPage() {
  const supabase = await createSupabaseServer();
  const { data: events, error } = await supabase
    .from("events")
    .select("id, title, starts_at, status, vendor_id")
    .order("starts_at", { ascending: false });

  if (error) {
    return <p className="p-4">Error loading events: {error.message}</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">All Events</h2>
        <Link href="/admin" className="flex items-center gap-2 text-sm text-gray-600 hover:text-black">
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Title</th>
              <th className="px-4 py-2 text-left font-medium">Starts At</th>
              <th className="px-4 py-2 text-left font-medium">Status</th>
              <th className="px-4 py-2 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {events.map((event) => (
              <tr key={event.id}>
                <td className="px-4 py-2 font-medium">{event.title}</td>
                <td className="px-4 py-2 text-gray-700">
                  {new Date(event.starts_at).toLocaleString()}
                </td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
                    event.status === 'confirmed' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {event.status}
                  </span>
                </td>
                <td className="px-4 py-2 space-x-2">
                  <Link href={`/admin/events/${event.id}/edit`} className="text-blue-600 hover:underline">
                    Edit
                  </Link>
                  <DeleteEventButton eventId={event.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}