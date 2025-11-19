"use client";

import { useHost } from "@/lib/contexts/HostContext";
import { useRouter } from "next/navigation";
import { ChevronDown, Building } from "lucide-react";

const getRoleBadgeClass = (role: string | undefined) => {
  switch (role) {
    case 'owner': return 'badge-primary';
    case 'manager': return 'badge-secondary';
    case 'editor': return 'badge-accent';
    case 'admin': return 'badge-neutral';
    default: return 'badge-ghost';
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
      {/* FIX: Updated style to match Admin Panel button (Ghost + Justified) */}
      <label 
        tabIndex={0} 
        className="btn btn-ghost bg-base-200/50 w-full justify-between font-medium hover:bg-base-200"
      >
        <span>Switch View</span>
        <ChevronDown size={16} className="opacity-50" />
      </label>
      
      <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-full max-h-72 overflow-y-auto mt-1">
        <li className="menu-title"><span>Your Organizations</span></li>
        {userOrgs.map(org => (
          <li key={org.id}>
            <a onClick={() => handleSwitch(org.slug)}>
              <div className="flex justify-between w-full items-center">
                <span className="flex items-center gap-2">
                  <Building size={16} />
                  {org.name}
                </span>
                <span className={`badge ${getRoleBadgeClass(org.role)} badge-sm ml-4`}>{org.role}</span>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}