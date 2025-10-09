"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { OrgMember } from '@/lib/types';

interface HostContextType {
  userOrgs: OrgMember[];
  currentOrg: OrgMember | null;
  setCurrentOrgById: (orgId: string | null) => void;
  setCurrentOrgBySlug: (slug: string | null) => void;
  loading: boolean;
}

const HostContext = createContext<HostContextType | undefined>(undefined);

export function HostProvider({ children }: { children: ReactNode }) {
  const [userOrgs, setUserOrgs] = useState<OrgMember[]>([]);
  const [currentOrg, setCurrentOrg] = useState<OrgMember | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    const fetchUserOrgs = async () => {
      console.log("--- STARTING ORG FETCH ---");
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log("DEBUG: No user found. Aborting.");
        setLoading(false);
        return;
      }
      console.log(`DEBUG: User found. ID: ${user.id}`);

      // 1. Check for admin status
      console.log("DEBUG: Step 1 - Checking admin status from 'app_admins' table...");
      const { data: adminRecord, error: adminError } = await supabase
        .from('app_admins')
        .select('user_id')
        .eq('user_id', user.id)
        .single();
      
      if (adminError && adminError.code !== 'PGRST116') { // PGRST116 = "exact one row not found", which is okay
        console.error("DEBUG: Error checking admin status:", adminError);
      }
      
      const isGlobalAdmin = !!adminRecord;
      console.log(`DEBUG: Is user a global admin? ${isGlobalAdmin}`);
      
      let orgsData: OrgMember[] = [];

      if (isGlobalAdmin) {
        // 2. If admin, fetch ALL organizations
        console.log("DEBUG: Step 2 - User is admin. Fetching all orgs from 'orgs' table...");
        const { data, error } = await supabase.from('orgs').select('id, name, slug');
        
        if (error) {
          // THIS IS THE ERROR YOU ARE SEEING
          console.error("Admin failed to fetch all orgs:", error);
        } else {
          console.log("DEBUG: Successfully fetched all orgs for admin. Count:", data?.length);
          orgsData = (data || []).map(org => ({
            ...org,
            role: 'admin' as const
          }));
        }
      } else {
        // 3. If not admin, fetch member organizations
        console.log("DEBUG: Step 2 - User is not admin. Fetching from 'org_members'...");
        const { data, error } = await supabase
          .from('org_members')
          .select('role, orgs(id, name, slug)')
          .eq('user_id', user.id);
        
        if (error) {
          console.error("Failed to fetch user organizations:", error);
        } else {
          orgsData = (data || []).map(member => ({
            role: member.role,
            ...(member.orgs as { id: string; name: string; slug: string; })
          }));
        }
      }
      
      setUserOrgs(orgsData);

      // Restore last selected org from localStorage
      const lastOrgId = localStorage.getItem('currentOrgId');
      const orgToSet = orgsData.find(org => org.id === lastOrgId) || null;
      setCurrentOrg(orgToSet);

      setLoading(false);
      console.log("--- FINISHED ORG FETCH ---");
    };

    fetchUserOrgs();
  }, []);

  const setCurrentOrgById = (orgId: string | null) => {
    if (orgId === null) {
      localStorage.removeItem('currentOrgId');
      setCurrentOrg(null);
    } else {
      const orgToSet = userOrgs.find(org => org.id === orgId) || null;
      if (orgToSet) {
        localStorage.setItem('currentOrgId', orgId);
        setCurrentOrg(orgToSet);
      }
    }
  };

  const setCurrentOrgBySlug = (slug: string | null) => {
    if (slug === null) {
      localStorage.removeItem('currentOrgId');
      setCurrentOrg(null);
    } else {
      const orgToSet = userOrgs.find(org => org.slug === slug) || null;
      if (orgToSet) {
        localStorage.setItem('currentOrgId', orgToSet.id);
        setCurrentOrg(orgToSet);
      }
    }
  };

  const value = { userOrgs, currentOrg, setCurrentOrgById, setCurrentOrgBySlug, loading };

  return <HostContext.Provider value={value}>{children}</HostContext.Provider>;
}

export function useHost() {
  const context = useContext(HostContext);
  if (context === undefined) {
    throw new Error('useHost must be used within a HostProvider');
  }
  return context;
}