"use client";

import { Search, Filter, Plus, Calendar } from "lucide-react";
import { useHost } from "@/lib/contexts/HostContext";

export default function HostEventsPage() {
  const { currentOrg } = useHost();

  if (!currentOrg) {
    return null; 
  }

  return (
    <div className="bg-gray-50 min-h-full">
      <div className="p-4 sm:p-6">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          {/* FIX: Use the h1 from the Figma design */}
          <h1 className="text-2xl font-bold">Events</h1>
          <button className="btn btn-primary">
            <Plus size={16} className="mr-1" />
            New Event
          </button>
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
        {/* FIX: Use a custom flex container to spread tabs evenly */}
        <div className="flex items-center bg-base-200 rounded-lg p-1 mb-6">
          <a className="tab tab-active flex-1">All</a>
          <a className="tab flex-1">Published</a>
          <a className="tab flex-1">Scheduled</a>
          <a className="tab flex-1">Draft</a>
          <a className="tab flex-1">Review</a>
        </div>

        {/* Empty State */}
        <div className="text-center bg-white rounded-lg p-12 shadow">
          <Calendar size={48} className="mx-auto text-gray-300" />
          <h3 className="mt-4 text-lg font-semibold">No events found</h3>
          <p className="mt-1 text-sm text-gray-500">Get started by creating your first event.</p>
        </div>
      </div>
    </div>
  );
}