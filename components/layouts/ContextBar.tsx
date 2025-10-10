"use client";

import { useHost } from "@/lib/contexts/HostContext";
import { useRouter } from "next/navigation";
import { User, Building, ChevronDown } from "lucide-react";

// Helper to get a color for each role badge
const getRoleBadgeClass = (role: string | undefined) => {
  // FIX: Use standardized role names
  switch (role?.toLowerCase()) {
    case 'hostowner':
    case 'admin':
      return 'badge-primary';
    case 'manager':
      return 'badge-secondary';
    case 'editor':
      return 'badge-accent';
    default:
      return 'badge-ghost';
  }
};

export default function ContextBar() {
  // FIX: Use setCurrentOrgBySlug from the context
  const { userOrgs, currentOrg, setCurrentOrgBySlug, loading } = useHost();
  const router = useRouter();

  // Don't render if loading or if the user has no organizations to switch between.
  if (loading || userOrgs.length === 0) {
    return null;
  }

  // FIX: The handleSwitch function now uses the slug
  const handleSwitch = (slug: string | null) => {
    setCurrentOrgBySlug(slug);
  };

  const currentViewName = currentOrg ? currentOrg.name : "Personal";
  const CurrentIcon = currentOrg ? Building : User;

  return (
    <div className="bg-base-200 p-2 text-sm border-b border-base-300">
      <div className="flex items-center justify-center gap-2">
        <span className="font-medium text-gray-600">Viewing as:</span>
        
        <div className="dropdown dropdown-end">
          {/* This is the dropdown trigger, showing the current view */}
          <label tabIndex={0} className="btn btn-sm btn-ghost flex items-center gap-2">
            <CurrentIcon size={16} />
            <span className="font-semibold">{currentViewName}</span>
            <ChevronDown size={16} className="text-gray-500" />
          </label>

          {/* This is the dropdown content, inspired by your Figma design */}
          <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-80 mt-2">
            <li className="menu-title"><span>Switch View</span></li>
            {/* Personal View Option */}
            <li>
              {/* FIX: Pass null to handleSwitch for personal view */}
              <a onClick={() => handleSwitch(null)} className={!currentOrg ? 'active' : ''}>
                <User size={16} />
                Personal
              </a>
            </li>
            
            <div className="divider my-1"></div>

            {/* Organization View Options */}
            {userOrgs.map(org => (
              <li key={org.id}>
                {/* FIX: Pass the org's slug to handleSwitch */}
                <a onClick={() => handleSwitch(org.slug)} className={currentOrg?.id === org.id ? 'active' : ''}>
                  <div className="flex justify-between w-full items-center gap-2">
                    <span className="flex items-center gap-2 min-w-0">
                      <Building size={16} className="flex-shrink-0" />
                      <span className="truncate">{org.name}</span>
                    </span>
                    <span className={`badge ${getRoleBadgeClass(org.role)} badge-sm flex-shrink-0`}>{org.role}</span>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}