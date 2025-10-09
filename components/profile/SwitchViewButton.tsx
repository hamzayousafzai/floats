"use client";

import { useHost } from "@/lib/contexts/HostContext";
import { useRouter } from "next/navigation";
import { ChevronDown, Building } from "lucide-react";

// Helper to get a color for each role badge
const getRoleBadgeClass = (role: string | undefined) => {
  switch (role?.toLowerCase()) {
    case 'owner':
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
  const { userOrgs, setCurrentOrgById, loading } = useHost();
  const router = useRouter();

  if (loading || userOrgs.length === 0) {
    return null;
  }

  const handleSwitch = (orgId: string) => {
    const org = userOrgs.find(o => o.id === orgId);
    if (org) {
      setCurrentOrgById(org.id);
      router.push(`/host/${org.slug}`);
    }
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
            <a onClick={() => handleSwitch(org.id)}>
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