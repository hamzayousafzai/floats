"use client";

import { useState } from 'react';
import { useHost } from '@/lib/contexts/HostContext';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { Loader2, X } from 'lucide-react';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onInviteSent: () => void;
};

// FIX: Use lowercase roles that match the database enum
const assignableRoles = ['owner', 'manager', 'editor'];

export default function InviteMemberModal({ isOpen, onClose, onInviteSent }: Props) {
  const { currentOrg, role: currentUserRole } = useHost();
  const [email, setEmail] = useState('');
  const [selectedRole, setSelectedRole] = useState('editor'); // FIX: Default to lowercase
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!isOpen || !currentOrg) return null;

  // FIX: Permission checks using lowercase roles
  const availableRoles = assignableRoles.filter(role => {
    if (currentUserRole === 'owner' || currentUserRole === 'admin') return true;
    if (currentUserRole === 'manager' && role === 'editor') return true;
    return false;
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    const supabase = createSupabaseBrowserClient();
    
    const { data, error: invokeError } = await supabase.functions.invoke('invite-member', {
      body: {
        orgId: currentOrg.id,
        inviteeEmail: email,
        role: selectedRole, // Now sends lowercase
      },
    });

    if (data?.error) {
      setError(data.error);
    } else if (invokeError) {
      setError(invokeError.message);
    } else {
      setSuccess(`Invite sent successfully to ${email}!`);
      setEmail('');
      onInviteSent(); 
    }
    setLoading(false);
  };

  return (
    <div className="modal modal-open">
      <div className="modal-box">
        <button onClick={onClose} className="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"><X size={20} /></button>
        <h3 className="font-bold text-lg">Invite New Member</h3>
        <p className="py-2 text-sm text-gray-600">Invite a new member to join &lsquo;{currentOrg.name}&rsquo;.</p>
        
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="form-control">
            <label className="label"><span className="label-text">Email Address</span></label>
            <input
              type="email"
              placeholder="member@example.com"
              className="input input-bordered w-full"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="form-control">
            <label className="label"><span className="label-text">Role</span></label>
            <select
              className="select select-bordered w-full"
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              disabled={availableRoles.length === 0}
            >
              {availableRoles.length > 0 ? (
                availableRoles.map(role => (
                  <option key={role} value={role}>
                    {role.charAt(0).toUpperCase() + role.slice(1)}
                  </option>
                ))
              ) : (
                <option>You do not have permission to invite members.</option>
              )}
            </select>
          </div>

          {error && <div className="alert alert-error text-sm">{error}</div>}
          {success && <div className="alert alert-success text-sm">{success}</div>}

          <div className="modal-action">
            <button type="button" onClick={onClose} className="btn btn-ghost">Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading || availableRoles.length === 0}>
              {loading && <Loader2 className="animate-spin mr-2" size={16} />}
              Send Invite
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}