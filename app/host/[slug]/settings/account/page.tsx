"use client";

import { useHost } from "@/lib/contexts/HostContext";
import { AlertTriangle } from "lucide-react";

export default function AccountSettingsPage() {
  const { currentOrg } = useHost();

  const handleLeave = () => {
    // In a real app, this would open a confirmation modal.
    // For example: document.getElementById('leave_org_modal').showModal();
    alert("This would trigger a confirmation to leave the organization.");
  };

  // Construct a placeholder email using the org's slug
  const orgEmail = `contact@${currentOrg?.slug}.com`;

  return (
    <div className="space-y-8">
      {/* Account Information Card */}
      <div className="bg-white p-6 rounded-lg shadow">
        <h2 className="text-lg font-semibold mb-4">Account Information</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Email Address</label>
            <input 
              type="email" 
              readOnly 
              value={orgEmail} 
              className="input input-bordered w-full mt-1 bg-gray-100 cursor-not-allowed" 
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Display Name</label>
            <input 
              type="text" 
              readOnly 
              value={currentOrg?.name || ''} 
              className="input input-bordered w-full mt-1 bg-gray-100 cursor-not-allowed" 
            />
          </div>
        </div>
      </div>

      {/* Danger Zone Card */}
      <div className="bg-white p-6 rounded-lg shadow border border-red-200">
        <h2 className="text-lg font-semibold text-red-700 mb-4">Danger Zone</h2>
        <div className="space-y-4">
          {/* FIX: Override vertical alignment to fix mobile view */}
          <div role="alert" className="alert items-start bg-yellow-50 text-yellow-800">
            {/* Make icon non-shrinkable and add top margin to align with text */}
            <AlertTriangle size={20} className="flex-shrink-0 mt-0.5" />
            {/* Allow text to wrap naturally */}
            <span className="text-sm">These actions cannot be undone. Please proceed with caution.</span>
          </div>
          <button onClick={handleLeave} className="btn btn-error w-full">
            Leave Organization
          </button>
        </div>
      </div>
    </div>
  );
}