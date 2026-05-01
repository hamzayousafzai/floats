"use client";

import { Search, Filter, Plus, Calendar, Loader2 } from "lucide-react";
import { useHost } from "@/lib/contexts/HostContext";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Tables } from "@/lib/database.types";
import Link from "next/link";
import EventDetailModal from "@/components/explore/EventDetailModal"; // Import the modal
import { ExploreCardData } from "@/lib/types"; // Import the card data type

type Event = Tables<'events'>;
type StatusTab = 'all' | 'published' | 'draft' | 'archived';
type DateFilter = 'all' | 'upcoming' | 'past7' | 'past30';

// The type `Event` from Tables<'events'> will not include related tables by default.
// We can define a more specific type for our component's state.
type EventWithMedia = Tables<'events'> & {
  event_media: { image_url: string; sort_index: number }[] | null;
};

export default function HostEventsPage() {
  const { currentOrg, role, loading: hostLoading } = useHost();
  const [events, setEvents] = useState<EventWithMedia[]>([]); // Use the new type
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [activeTab, setActiveTab] = useState<StatusTab>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewingEvent, setViewingEvent] = useState<ExploreCardData | null>(null); // State for the preview modal

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 500);

    return () => {
      clearTimeout(timer);
    };
  }, [searchTerm]);

  useEffect(() => {
    if (currentOrg) {
      const supabase = createSupabaseBrowserClient();
      const fetchEvents = async () => {
        setLoadingEvents(true);
        
        let query = supabase
          .from('events')
          // FIX: Explicitly select all event columns AND the related event_media
          .select('*, event_media ( image_url, sort_index )')
          .eq('org_id', currentOrg.id);

        if (activeTab !== 'all') {
          query = query.eq('status', activeTab);
        }

        if (debouncedSearchTerm) {
          query = query.ilike('title', `%${debouncedSearchTerm}%`);
        }

        const now = new Date();
        if (dateFilter === 'upcoming') {
          query = query.gte('starts_at', now.toISOString());
        } else if (dateFilter === 'past7') {
          const sevenDaysAgo = new Date(now.setDate(now.getDate() - 7));
          query = query.gte('starts_at', sevenDaysAgo.toISOString());
        } else if (dateFilter === 'past30') {
          const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30));
          query = query.gte('starts_at', thirtyDaysAgo.toISOString());
        }

        const { data, error } = await query.order('starts_at', { ascending: false });

        if (error) {
          console.error("Error fetching host events:", error);
        } else {
          setEvents(data || []);
        }
        setLoadingEvents(false);
      };
      fetchEvents();
    }
  }, [currentOrg, activeTab, debouncedSearchTerm, dateFilter]);

  const isLoading = hostLoading || loadingEvents;

  const canCreateEvents = role === 'owner' || role === 'manager' || role === 'admin';
  const canEditEvents = role === 'owner' || role === 'manager' || role === 'editor' || role === 'admin';
  const canDeleteEvents = role === 'owner' || role === 'manager' || role === 'admin';

  const getTabClassName = (tabName: StatusTab) => {
    return `tab flex-1 ${activeTab === tabName ? 'tab-active font-semibold' : ''}`;
  };

  // NEW: Delete handler (calls existing delete route)
  async function handleDelete(id: string, title: string) {
    const ok = window.confirm(`Delete event "${title}"? This cannot be undone.`);
    if (!ok) return;

    try {
      setDeletingId(id);
      const res = await fetch(`/admin/events/${id}/delete`, { method: 'DELETE' }); // CHANGED
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to delete event');

      setEvents((prev) => prev.filter((e) => e.id !== id));
    } catch (err: any) {
      alert(`Error deleting event: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  }

  // Helper to map Supabase event to the format the modal expects
  const mapToCardData = (event: EventWithMedia): ExploreCardData => ({
    id: event.id,
    title: event.title ?? "",
    description: event.description ?? null,
    starts_at: event.starts_at,
    ends_at: event.ends_at,
    image_url: event.image_url ?? null,
    address: event.address ?? null,
    latitude: event.latitude ?? null,
    longitude: event.longitude ?? null,
    series_id: event.series_id ?? null,
    // These are not relevant for a host preview, so we can use defaults
    is_starred: false,
    is_notified: false,
    categories: [],
    // FIX: Pass the fetched event_media data to the modal
    event_media: event.event_media ?? null,
    event_url: (event as any).event_url ?? null,
  });

  return (
    <div className="bg-gray-50 min-h-full">
      <div className="p-4 sm:p-6">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">Events</h1>
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
            {/* FIX: Wire up search input */}
            <input
              type="text"
              placeholder="Search events..."
              className="input input-bordered w-full pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          {/* FIX: Implement filter dropdown */}
          <div className="dropdown dropdown-end">
            <button tabIndex={0} className="btn btn-outline">
              <Filter size={16} />
            </button>
            <ul tabIndex={0} className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-52">
              <li><a onClick={() => setDateFilter('all')} className={dateFilter === 'all' ? 'font-bold' : ''}>All Time</a></li>
              <li><a onClick={() => setDateFilter('upcoming')} className={dateFilter === 'upcoming' ? 'font-bold' : ''}>Upcoming</a></li>
              <li><a onClick={() => setDateFilter('past7')} className={dateFilter === 'past7' ? 'font-bold' : ''}>Past 7 Days</a></li>
              <li><a onClick={() => setDateFilter('past30')} className={dateFilter === 'past30' ? 'font-bold' : ''}>Past 30 Days</a></li>
            </ul>
          </div>
        </div>

        {/* Tabs */}
        <div className="tabs tabs-boxed bg-base-200 mb-6">
          <a onClick={() => setActiveTab('all')} className={getTabClassName('all')}>All</a>
          <a onClick={() => setActiveTab('published')} className={getTabClassName('published')}>Published</a>
          <a onClick={() => setActiveTab('draft')} className={getTabClassName('draft')}>Draft</a>
          <a onClick={() => setActiveTab('archived')} className={getTabClassName('archived')}>Archived</a>
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
                      {/* FIX: Update status badge styling for new values */}
                      <span className={`rounded-full capitalize px-2 py-1 text-xs font-semibold ${
                        event.status === 'published' ? 'bg-green-100 text-green-800' :
                        event.status === 'draft' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {event.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 space-x-3">
                      <button
                        type="button"
                        className="text-gray-600 hover:underline"
                        onClick={() => setViewingEvent(mapToCardData(event))}
                      >
                        View
                      </button>
                      {canEditEvents && currentOrg && (
                        <Link
                          href={`/host/${currentOrg.slug}/events/${event.id}/edit`}
                          className="text-blue-600 hover:underline"
                        >
                          Edit
                        </Link>
                      )}
                      {canDeleteEvents && (
                        <button
                          type="button"
                          className="text-red-600 hover:underline disabled:opacity-50 cursor-pointer"
                          onClick={() => handleDelete(event.id as string, event.title ?? 'Event')}
                          disabled={deletingId === event.id}
                          aria-disabled={deletingId === event.id}
                        >
                          {deletingId === event.id ? 'Deleting…' : 'Delete'}
                        </button>
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
      {/* Render the modal when an event is selected for viewing */}
      {viewingEvent && (
        <EventDetailModal
          event={viewingEvent}
          onClose={() => setViewingEvent(null)}
          isPreview={true}
        />
      )}
    </div>
  );
}