import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function AdminHome() {
  return (
    <main className="p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Admin Dashboard</h2>
        <Link href="/map" className="flex items-center gap-2 text-sm text-gray-600 hover:text-black">
          <ArrowLeft className="h-4 w-4" />
          Back to Map
        </Link>
      </div>
      <div className="border rounded-lg p-4">
        <h3 className="font-medium">Event Management</h3>
        <p className="text-sm text-gray-500 mt-1">
          View, create, edit, or delete events.
        </p>
        <div className="mt-4 space-x-2">
          <Link href="/admin/events" className="rounded bg-gray-100 px-4 py-2 text-sm font-medium hover:bg-gray-200">
            List All Events
          </Link>
          <Link href="/admin/events/new" className="rounded bg-black text-white px-4 py-2 text-sm font-medium hover:bg-gray-800">
            Create New Event
          </Link>
        </div>
      </div>
    </main>
  );
}