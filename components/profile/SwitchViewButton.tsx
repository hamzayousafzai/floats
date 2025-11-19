"use client";

import { useHost } from "@/lib/contexts/HostContext";
import { useRouter } from "next/navigation";
import { ChevronDown, Building } from "lucide-react";

// Helper to get a color for each role badge
const getRoleBadgeClass = (role: string | undefined) => {
  // FIX: Use the lowercase roles from your database schema
  switch (role) {
    case 'owner':
      return 'badge-primary';
    case 'manager':
      return 'badge-secondary';
    case 'editor':
      return 'badge-accent';
    case 'admin':
      return 'badge-neutral';
    default:
      return 'badge-ghost';
  }
};

export default function SwitchViewButton() {
  const { userOrgs, setCurrentOrgBySlug, loading } = useHost();
  const router = useRouter();

  if (loading || userOrgs.length === 0) {
    return null;
  }

  const handleSwitch = (slug: string) => {
    setCurrentOrgBySlug(slug);
  };

  return (
    <div className="dropdown dropdown-end w-full">
      {/* FIX: Removed the "m-1" class to prevent horizontal overflow */}
      <label tabIndex={0} className="btn btn-outline w-full">
        <span>Switch View</span>
        <ChevronDown size={16} />
      </label>
      {/* FIX: Add max-height and overflow-y-auto to make the dropdown scrollable */}
      <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-full max-h-72 overflow-y-auto">
        <li className="menu-title"><span>Your Organizations</span></li>
        {userOrgs.map(org => (
          // The key error is resolved because the data from the view is now deduplicated
          <li key={org.id}>
            <a onClick={() => handleSwitch(org.slug)}>
              <div className="flex justify-between w-full items-center">
                <span className="flex items-center gap-2">
                  <Building size={16} />
                  {org.name}
                </span>
                {/* FIX: Add a left margin (ml-4) to create space */}
                <span className={`badge ${getRoleBadgeClass(org.role)} badge-sm ml-4`}>{org.role}</span>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}