"use client";

import { Search, Filter, Plus, Calendar, Loader2 } from "lucide-react";
import { useHost } from "@/lib/contexts/HostContext";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Tables } from "@/lib/database.types";
import Link from "next/link";

type Event = Tables<'events'>;

export default function HostEventsPage() {
  const { currentOrg, role, loading: hostLoading } = useHost();
  const [events, setEvents] = useState<Event[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);

  useEffect(() => {
    if (currentOrg) {
      const supabase = createSupabaseBrowserClient();
      const fetchEvents = async () => {
        setLoadingEvents(true);
        const { data, error } = await supabase
          .from('events')
          .select('*')
          .eq('org_id', currentOrg.id)
          .order('starts_at', { ascending: false });

        if (error) {
          console.error("Error fetching host events:", error);
        } else {
          setEvents(data || []);
        }
        setLoadingEvents(false);
      };
      fetchEvents();
    }
  }, [currentOrg]);

  const isLoading = hostLoading || loadingEvents;

  // FIX: Use correct lowercase roles from the useHost context.
  const canCreateEvents = role === 'owner' || role === 'manager' || role === 'admin';
  const canEditEvents = role === 'owner' || role === 'manager' || role === 'editor' || role === 'admin';

  return (
    <div className="bg-gray-50 min-h-full">
      <div className="p-4 sm:p-6">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">Events</h1>
          {/* This check now correctly includes admins */}
          {currentOrg && canCreateEvents && (
            <Link href={`/host/${currentOrg.slug}/events/new`} className="btn btn-primary">
              <Plus size={16} className="mr-1" />
              New Event
            </Link>
          )}
        </div>

        {/* Search and Filters */}
        <div className="flex gap-2 mb-4">
          <div className="relative flex-grow">
            <Search size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Search events..." className="input input-bordered w-full pl-10" />
          </div>
          <button className="btn btn-outline">
            <Filter size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center bg-base-200 rounded-lg p-1 mb-6">
          <a className="tab tab-active flex-1">All</a>
          <a className="tab flex-1">Published</a>
          <a className="tab flex-1">Scheduled</a>
          <a className="tab flex-1">Draft</a>
          <a className="tab flex-1">Review</a>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex justify-center items-center p-12">
            <Loader2 className="animate-spin" />
          </div>
        ) : events.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Title</th>
                  <th className="px-4 py-2 text-left font-medium">Starts At</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
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
                      {/* FIX: Implement conditional Edit Link */}
                      {canEditEvents && currentOrg && (
                        <Link href={`/host/${currentOrg.slug}/events/${event.id}/edit`} className="text-blue-600 hover:underline">
                          Edit
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center bg-white rounded-lg p-12 shadow">
            <Calendar size={48} className="mx-auto text-gray-300" />
            <h3 className="mt-4 text-lg font-semibold">No events found</h3>
            <p className="mt-1 text-sm text-gray-500">Get started by creating your first event.</p>
          </div>
        )}
      </div>
    </div>
  );
}