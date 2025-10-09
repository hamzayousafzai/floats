"use client";

import { Plus } from "lucide-react";

const members = [
    { name: "Sarah Johnson", email: "sarah@estherelsa.com", role: "HostOwner", status: "active", initials: "SJ" },
    { name: "Michael Chen", email: "michael@estherelsa.com", role: "Manager", status: "active", initials: "MC" },
    { name: "Emily Rodriguez", email: "emily@estherelsa.com", role: "Editor", status: "active", initials: "ER" },
    { name: "David Thompson", email: "david@estherelsa.com", role: "Editor", status: "pending", initials: "DT" },
];

export default function MembersSettingsPage() {
  return (
    <div className="bg-white p-4 sm:p-6 rounded-lg shadow">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Team Members</h2>
        <button className="btn btn-primary btn-sm">
          <Plus size={16} className="mr-1" />
          Invite Member
        </button>
      </div>
      {/* FIX: Changed from space-y-3 to a dividing line for better control */}
      <div className="divide-y divide-gray-200">
        {members.map((member) => (
          <div key={member.email} className="flex items-center justify-between py-3">
            {/* Left side: User Info */}
            <div className="flex items-center gap-3">
              <div className={`avatar placeholder ${member.status === 'pending' ? 'opacity-50' : ''}`}>
                <div className="bg-neutral-focus text-neutral-content rounded-full w-10">
                  <span>{member.initials}</span>
                </div>
              </div>
              <div>
                <div className="font-medium">{member.name}</div>
                <div className="text-sm text-gray-500">{member.email}</div>
              </div>
            </div>
            {/* Right side: Role and Status */}
            {/* FIX: Stack role and status vertically and align to the right */}
            <div className="flex flex-col items-end gap-1 text-right">
              <span className="text-sm text-gray-600">{member.role}</span>
              {member.status === 'active' ? (
                <div className="badge badge-success badge-outline">active</div>
              ) : (
                <div className="badge badge-warning badge-outline">pending</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}