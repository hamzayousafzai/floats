"use client";

import ContextBar from "@/components/layouts/ContextBar";
import HostBottomNav from "@/components/nav/HostBottomNav";
import { useHost } from "@/lib/contexts/HostContext";
import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function HostLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Destructure the new function and userOrgs
  const { currentOrg, setCurrentOrgBySlug, loading, userOrgs } = useHost();
  const params = useParams();
  const router = useRouter();

  useEffect(() => {
    // This effect ensures the context is in sync with the URL.
    if (!loading && userOrgs.length > 0 && params.slug && currentOrg?.slug !== params.slug) {
      // FIX: Use the new function to sync context from the URL slug
      setCurrentOrgBySlug(params.slug as string);
    }
    
    // If the user is in host view but the context is cleared, redirect to profile.
    if (!loading && !currentOrg && userOrgs.length === 0) {
        router.replace('/profile');
    }
  }, [loading, currentOrg, params.slug, setCurrentOrgBySlug, router, userOrgs]);

  // Don't render children until context is loaded and matches the URL
  if (loading || !currentOrg || currentOrg.slug !== params.slug) {
    return (
      <div className="flex h-screen items-center justify-center">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  return (
    <div data-theme="corporate" className="flex flex-col h-screen">
      <ContextBar />
      <main className="flex-grow overflow-y-auto pb-16">
        {children}
      </main>
      <HostBottomNav />
    </div>
  );
}