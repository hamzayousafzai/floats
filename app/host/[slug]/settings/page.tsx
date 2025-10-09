"use client";

import { useHost } from "@/lib/contexts/HostContext";

export default function OrganizationSettingsPage() {
  const { currentOrg } = useHost();

  return (
    <div className="space-y-6">
      {/* Organization Information Card */}
      <div className="bg-white p-6 rounded-lg shadow">
        <h2 className="text-lg font-semibold mb-4">Organization Information</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Organization Name
            </label>
            <input
              type="text"
              defaultValue={currentOrg?.name}
              className="input input-bordered w-full mt-1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Description
            </label>
            <textarea
              className="textarea textarea-bordered w-full mt-1"
              rows={3}
              placeholder="Premium event hosting specializing in community markets and cultural events."
            ></textarea>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Organization Slug
            </label>
            <input
              type="text"
              disabled
              defaultValue={currentOrg?.slug}
              className="input input-bordered w-full mt-1 bg-gray-100"
            />
            <p className="text-xs text-gray-500 mt-1">
              This cannot be changed after creation.
            </p>
          </div>
        </div>
      </div>

      {/* Organization Stats Card */}
      <div className="bg-white p-6 rounded-lg shadow">
        <h2 className="text-lg font-semibold mb-4">Organization Stats</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-100 p-4 rounded-lg text-center">
            <div className="text-2xl font-bold">12</div>
            <div className="text-sm text-gray-600">Total Events</div>
          </div>
          <div className="bg-gray-100 p-4 rounded-lg text-center">
            <div className="text-2xl font-bold">4</div>
            <div className="text-sm text-gray-600">Team Members</div>
          </div>
        </div>
      </div>
    </div>
  );
}