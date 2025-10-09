"use client";

import { useHost } from "@/lib/contexts/HostContext";
import { useRouter } from "next/navigation";
import { ChevronDown, Building } from "lucide-react";

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
    // The dropdown wrapper should be full width to contain the button
    <div className="dropdown dropdown-end w-full">
      {/* FIX: Add w-full and remove m-1 to make the button full width */}
      <label tabIndex={0} className="btn btn-outline w-full">
        <span>Switch View</span>
        <ChevronDown size={16} />
      </label>
      <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-full">
        <li className="menu-title"><span>Your Organizations</span></li>
        {userOrgs.map(org => (
          <li key={org.id}>
            <a onClick={() => handleSwitch(org.id)}>
              <Building size={16} />
              {org.name}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}