"use client";

import { useHost } from "@/lib/contexts/HostContext";
import { useRouter } from "next/navigation";
import { ChevronDown, Building } from "lucide-react";

// Helper to get a color for each role badge
const getRoleBadgeClass = (role: string | undefined) => {
  // FIX: Use standardized role names
  switch (role?.toLowerCase()) {
    case 'hostowner':
      return 'badge-primary';
    case 'manager':
      return 'badge-secondary';
    case 'editor':
      return 'badge-accent';
    default:
      return 'badge-ghost';
  }
};

export default function SwitchViewButton() {
  // FIX: Use setCurrentOrgBySlug from the updated context
  const { userOrgs, setCurrentOrgBySlug, loading } = useHost();
  const router = useRouter();

  // This check is now reliable because userOrgs will be empty for non-members
  if (loading || userOrgs.length === 0) {
    return null;
  }

  const handleSwitch = (slug: string) => {
    setCurrentOrgBySlug(slug);
  };

  return (
    <div className="dropdown dropdown-end w-full">
      <label tabIndex={0} className="btn btn-outline w-full m-1">
        <span>Switch View</span>
        <ChevronDown size={16} />
      </label>
      <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-full">
        <li className="menu-title"><span>Your Organizations</span></li>
        {userOrgs.map(org => (
          <li key={org.id}>
            <a onClick={() => handleSwitch(org.slug)}>
              <div className="flex justify-between w-full items-center">
                <span className="flex items-center gap-2">
                  <Building size={16} />
                  {org.name}
                </span>
                <span className={`badge ${getRoleBadgeClass(org.role)} badge-sm`}>{org.role}</span>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}