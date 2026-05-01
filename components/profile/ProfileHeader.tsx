"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Settings } from "lucide-react";
import SignOutButton from "@/components/SignOutButton";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Props = {
  user: {
    id: string;
    email?: string;
    user_metadata?: {
      name?: string;
      avatar_url?: string;
    };
  };
};

export default function ProfileHeader({ user }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isSettingsOpen = searchParams.get('settings') === '1';

  // State for form inputs
  const [displayName, setDisplayName] = useState(user.user_metadata?.name || "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const openSettings = () => {
    const params = new URLSearchParams(searchParams);
    params.set('settings', '1');
    router.push(`/profile?${params.toString()}`);
  };

  const closeSettings = () => {
    const params = new URLSearchParams(searchParams);
    params.delete('settings');
    const newUrl = params.toString() ? `/profile?${params.toString()}` : '/profile';
    router.push(newUrl);
  };

  const handleSave = async () => {
    setError(null);
    startTransition(async () => {
      const supabase = createSupabaseBrowserClient();
      const { error: updateError } = await supabase.auth.updateUser({
        data: { name: displayName },
      });

      if (updateError) {
        setError(updateError.message);
      } else {
        closeSettings();
        // Refresh the page to show the updated name in the header
        router.refresh();
      }
    });
  };

  const initials = (user.user_metadata?.name || user.email || "?")
    .split(/\s+/).map((p: string) => p[0]).join("").slice(0, 2).toUpperCase();

  return (
    <>
      <section className="flex items-start justify-between">
        <div className="flex gap-4">
          {/* Static avatar — no longer opens settings */}
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black text-white text-lg font-medium flex-shrink-0">
            {initials}
          </div>
          <div>
            <h1 className="text-lg font-semibold">{user.user_metadata?.name || "Your Profile"}</h1>
            <p className="text-sm text-gray-600">{user.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openSettings}
            className="btn btn-ghost btn-sm btn-circle"
            title="Manage Account"
            aria-label="Manage Account"
          >
            <Settings size={18} className="text-gray-500" />
          </button>
          <SignOutButton />
        </div>
      </section>

      {/* Settings Panel with animation */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          {/* Backdrop with fade-in animation */}
          <div 
            className="absolute inset-0 bg-black/60 transition-opacity duration-300 ease-in-out"
            onClick={closeSettings}
          />
          
          {/* Panel with slide-in animation */}
          <div 
            className="absolute right-0 top-0 bottom-0 w-full max-w-sm bg-white shadow-xl transform transition-transform duration-300 ease-in-out"
            style={{ transform: isSettingsOpen ? 'translateX(0)' : 'translateX(100%)' }}
          >
            <div className="flex h-full flex-col pb-10"> {/* Add bottom padding for nav */}
              {/* Header */}
              <div className="flex items-center justify-between border-b px-4 py-3">
                <h2 className="text-lg font-semibold">Manage Account</h2>
                <button
                  onClick={closeSettings}
                  className="btn btn-ghost btn-sm btn-circle"
                >
                  ✕
                </button>
              </div>

              {/* Content - make scrollable */}
              <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {/* Account Section */}
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <svg className="h-4 w-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    <h3 className="font-medium">Account</h3>
                  </div>
                  
                  <div className="space-y-4">
                    {/* Avatar */}
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black text-white font-medium">
                      {initials}
                    </div>

                    {/* Display Name */}
                    <div>
                      <label className="block text-sm font-medium mb-2">Display Name</label>
                      <input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className="input input-bordered w-full"
                        placeholder="Your name"
                      />
                    </div>

                    {/* Email (read-only) */}
                    <div>
                      <label className="block text-sm font-medium mb-2">Email</label>
                      <input
                        type="email"
                        value={user.email || ""}
                        className="input input-bordered w-full"
                        disabled
                      />
                      <p className="text-xs text-gray-500 mt-1">Email cannot be changed</p>
                    </div>
                  </div>
                </section>

                {/* Notifications Section */}
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <svg className="h-4 w-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-5 5v-5zM9 7a3 3 0 11-6 0 3 3 0 016 0zM13 7a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <h3 className="font-medium">Notifications</h3>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">Event Reminders</p>
                        <p className="text-sm text-gray-500">Get notified about upcoming events</p>
                      </div>
                      <input type="checkbox" defaultChecked className="toggle toggle-primary" />
                    </div>
                  </div>
                </section>

                {/* Profile Mode Section */}
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <svg className="h-4 w-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                    </svg>
                    <h3 className="font-medium">Profile Mode</h3>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="rounded-lg border border-gray-200 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-gray-400">Switch to Host/Vendor View</p>
                          <p className="text-sm text-gray-400">Manage your events and vendors</p>
                        </div>
                        <button className="btn btn-outline btn-sm" disabled title="Coming soon">
                          Switch View
                        </button>
                      </div>
                      <p className="text-xs text-gray-400 mt-2">Coming soon</p>
                    </div>
                  </div>
                </section>

                {error && <p className="text-sm text-red-600">{error}</p>}

                {/* Add some extra space at bottom for comfortable scrolling */}
                <div className="h-4" />
              </div>

              {/* Footer - positioned at bottom but above nav */}
              <div className="border-t p-4 bg-white">
                <div className="flex gap-3">
                  <button onClick={closeSettings} className="btn btn-outline flex-1" disabled={isPending}>
                    Cancel
                  </button>
                  <button onClick={handleSave} className="btn btn-primary flex-1" disabled={isPending}>
                    {isPending ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}