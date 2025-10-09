"use client";

import { useHost } from "@/lib/contexts/HostContext";
import { useRouter } from "next/navigation";
import { User, Building } from "lucide-react";

export default function ContextBar() {
  const { userOrgs, currentOrg, setCurrentOrgById, loading } = useHost();
  const router = useRouter();

  if (loading || userOrgs.length === 0) {
    return null; // Don't render if loading or user has no orgs
  }

  const handleSwitch = (orgId: string | null) => {
    setCurrentOrgById(orgId);
    if (orgId) {
      const org = userOrgs.find(o => o.id === orgId);
      if (org) {
        router.push(`/host/${org.slug}`);
      }
    } else {
      router.push('/profile');
    }
  };

  return (
    <div className="bg-base-200 p-2 text-center text-sm">
      <div className="flex items-center justify-center gap-4">
        <span className="font-semibold">Viewing as:</span>
        <div className="tabs tabs-boxed">
          <a
            onClick={() => handleSwitch(null)}
            className={`tab tab-sm ${!currentOrg ? 'tab-active' : ''}`}
          >
            <User size={16} className="mr-2" />
            Personal
          </a>
          {userOrgs.map(org => (
            <a
              key={org.id}
              onClick={() => handleSwitch(org.id)}
              className={`tab tab-sm ${currentOrg?.id === org.id ? 'tab-active' : ''}`}
            >
              <Building size={16} className="mr-2" />
              {org.name}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}