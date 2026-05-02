"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { OrgMember } from '@/lib/types';
import { usePathname, useRouter } from 'next/navigation';

export interface HostContextType {
  userOrgs: OrgMember[];
  currentOrg: OrgMember | null;
  role: OrgMember['role'] | null;
  setCurrentOrgBySlug: (slug: string | null) => void;
  loading: boolean;
  isGlobalAdmin: boolean;
}

const HostContext = createContext<HostContextType | undefined>(undefined);

export function HostProvider({ children }: { children: ReactNode }) {
  const [userOrgs, setUserOrgs] = useState<OrgMember[]>([]);
  const [currentOrg, setCurrentOrg] = useState<OrgMember | null>(null);
  const [isGlobalAdmin, setIsGlobalAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    const fetchAndSetContext = async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setUserOrgs([]);
        setCurrentOrg(null);
        setIsGlobalAdmin(false);
        setLoading(false);
        return;
      }

      // This call is correct. It will now invoke the new, secure function.
      await supabase.rpc('accept_invites');

      const { data: adminRecord } = await supabase.from('app_admins').select('user_id').eq('user_id', user.id).single();
      const isAdmin = !!adminRecord;
      setIsGlobalAdmin(isAdmin);
      
      let fetchedOrgs: OrgMember[] = [];
      if (isAdmin) {
        const { data } = await supabase.from('orgs').select('id, name, slug');
        fetchedOrgs = (data || []).map(org => ({ ...org, role: 'admin' as const }));
      } else {
        // Query the new, authoritative view to get all user orgs and roles
        const { data } = await supabase
          .from('user_org_roles')
          .select('org_id, name, slug, role')
          .eq('user_id', user.id);
        
        // FIX: You MUST add .filter() here to remove nulls before mapping.
        // This resolves the TypeScript error by ensuring all data matches the OrgMember type.
        fetchedOrgs = (data || [])
          .filter(org => org.org_id !== null && org.name !== null && org.slug !== null && org.role !== null)
          .map(org => ({
            id: org.org_id as string,
            name: org.name as string,
            slug: org.slug as string,
            role: org.role as OrgMember['role'],
          }));
      }
      setUserOrgs(fetchedOrgs);

      // This is now the single source of truth for setting the current org
      const slugFromPath = pathname.startsWith('/host/') ? pathname.split('/')[2] : null;
      const orgFromPath = fetchedOrgs.find(org => org.slug === slugFromPath) || null;
      
      setCurrentOrg(orgFromPath);
      if (orgFromPath) {
        localStorage.setItem('currentOrgId', orgFromPath.id);
      } else {
        localStorage.removeItem('currentOrgId');
      }

      setLoading(false);
    };

    fetchAndSetContext();
  }, [pathname]); // The effect correctly depends only on the URL path

  // FIX: Simplify the function to only handle navigation.
  const setCurrentOrgBySlug = (slug: string | null) => {
    if (slug) {
      router.push(`/host/${slug}`);
    } else {
      router.push('/profile');
    }
  };

  const role = currentOrg?.role || null;
  const value = { userOrgs, currentOrg, role, setCurrentOrgBySlug, loading, isGlobalAdmin };

  return <HostContext.Provider value={value}>{children}</HostContext.Provider>;
}

export function useHost() {
  const context = useContext(HostContext);
  if (context === undefined) {
    throw new Error('useHost must be used within a HostProvider');
  }
  return context;
}