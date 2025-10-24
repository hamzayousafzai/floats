"use client";

// FIX: Import the RefreshCw icon
import { Plus, Loader2, Trash2, RefreshCw } from "lucide-react";
import { useHost } from "@/lib/contexts/HostContext";
import { useEffect, useState, useCallback } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import InviteMemberModal from "@/components/admin/InviteMemberModal";

// Define more specific types for our data
type Member = {
  user_id: string;
  name: string | null;
  email: string | null;
  role: string;
  status: 'active';
  initials: string;
};

type Invite = {
  id: string;
  email: string;
  role: string;
  status: 'pending';
};

// A combined type for the list
type TeamPerson = Member | Invite;

export default function MembersSettingsPage() {
  const { currentOrg, role: currentUserRole, isGlobalAdmin } = useHost();
  const [team, setTeam] = useState<TeamPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [personToRemove, setPersonToRemove] = useState<TeamPerson | null>(null);

  // FIX: Use correct lowercase roles for permission checks
  const canInvite = currentUserRole === 'owner' || currentUserRole === 'manager' || isGlobalAdmin;
  const canRemove = currentUserRole === 'owner' || isGlobalAdmin;

  const fetchData = useCallback(async () => {
    console.log('Fetching data at:', new Date().toLocaleTimeString()); // Add this
    if (!currentOrg) return;
    setLoading(true);
    const supabase = createSupabaseBrowserClient();

    const [membersRes, invitesRes] = await Promise.all([
      supabase.from('org_member_details').select('user_id, role, display_name, email').eq('org_id', currentOrg.id),
      // FIX: Only fetch invites that are still pending (accepted_at is null)
      supabase.from('org_invites').select('id, invitee_email, role').eq('org_id', currentOrg.id).is('accepted_at', null)
    ]);

    const activeMembers: Member[] = (membersRes.data || [])
      // FIX: Also filter out any records where user_id is null to satisfy the 'Member' type.
      .filter(m => m.role && m.user_id)
      .map(m => ({
        user_id: m.user_id as string, // We can now safely cast this as a string
        name: m.display_name || 'Unknown User',
        email: m.email || 'No email',
        role: m.role as string,
        status: 'active' as const,
        initials: (m.display_name || 'U').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase(),
      }));

    const pendingInvites: Invite[] = (invitesRes.data || []).map(i => ({
      id: i.id,
      email: i.invitee_email,
      role: i.role,
      status: 'pending' as const
    }));

    console.log('Fetched invites:', pendingInvites); // And this

    setTeam([...activeMembers, ...pendingInvites]);
    setLoading(false);
  }, [currentOrg]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ADD: Handler function to remove a member or an invite
  const handleRemove = async () => {
    if (!personToRemove || !currentOrg) return;

    const supabase = createSupabaseBrowserClient();
    let error = null;

    if (personToRemove.status === 'active') {
      // Remove an active member from the org_members table
      const { error: deleteMemberError } = await supabase
        .from('org_members')
        .delete()
        .eq('org_id', currentOrg.id)
        .eq('user_id', (personToRemove as Member).user_id);
      error = deleteMemberError;
    } else {
      // Remove a pending invite from the org_invites table
      const { error: deleteInviteError } = await supabase
        .from('org_invites')
        .delete()
        .eq('id', (personToRemove as Invite).id);
      error = deleteInviteError;
    }

    if (error) {
      alert(`Failed to remove: ${error.message}`);
    } else {
      setPersonToRemove(null); // Close the modal
      fetchData(); // Refresh the list
    }
  };

  return (
    <>
      <div className="bg-base-100 p-4 sm:p-6 rounded-lg shadow">
        <div className="flex justify-between items-center mb-4">
          {/* FIX: Group the title and the new refresh button */}
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Team Members</h2>
            <button
              onClick={() => fetchData()}
              className="btn btn-ghost btn-sm btn-square"
              aria-label="Refresh list"
            >
              {/* Show a spinner when loading, otherwise show the refresh icon */}
              {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            </button>
          </div>
          {canInvite && (
            <button onClick={() => setIsModalOpen(true)} className="btn btn-primary btn-sm">
              <Plus size={16} className="mr-1" />
              Invite Member
            </button>
          )}
        </div>
        
        {loading ? (
          <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
        ) : (
          <div className="divide-y divide-base-200">
            {team.map((person) => (
              <div key={person.email} className="flex items-center justify-between py-3 group">
                <div className="flex items-center gap-3">
                  <div className={`avatar placeholder ${person.status === 'pending' ? 'opacity-50' : ''}`}>
                    <div className="bg-neutral-focus text-neutral-content rounded-full w-10">
                      <span>{person.status === 'active' ? (person as Member).initials : '?'}</span>
                    </div>
                  </div>
                  <div>
                    <div className="font-medium">{person.status === 'active' ? (person as Member).name : person.email}</div>
                    <div className="text-sm text-base-content/60">{person.status === 'active' ? person.email : 'Invitation sent'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex flex-col items-end gap-1 text-right">
                    <span className="text-sm text-base-content/80 capitalize">{person.role}</span>
                    {person.status === 'active' ? (
                      <div className="badge badge-success badge-outline">Active</div>
                    ) : (
                      <div className="badge badge-warning badge-outline">Pending</div>
                    )}
                  </div>
                  {/* ADD: Show remove button if user has permission AND the target is not an owner */}
                  {canRemove && person.role !== 'owner' && (
                    <button 
                      onClick={() => setPersonToRemove(person)} 
                      // FIX: Removed "opacity-0" and "group-hover:opacity-100" to make the button always visible.
                      className="btn btn-ghost btn-sm btn-square text-error transition-opacity"
                      aria-label="Remove member"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <InviteMemberModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)}
        onInviteSent={() => {
          setIsModalOpen(false);
          fetchData();
        }}
      />
      {/* ADD: Confirmation Modal for Removing a Member */}
      {personToRemove && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Confirm Removal</h3>
            <p className="py-4">Are you sure you want to remove <span className="font-semibold">{personToRemove.email}</span> from this organization?</p>
            <div className="modal-action">
              <button onClick={() => setPersonToRemove(null)} className="btn btn-ghost">Cancel</button>
              <button onClick={handleRemove} className="btn btn-error">Remove</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}