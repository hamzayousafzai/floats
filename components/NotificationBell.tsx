"use client";

import { Bell, BellOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export type NotificationBellProps = {
  eventId: string;
  seriesId?: string | null;
  /** visible controls whether bell is shown at all (e.g. only after favorite) */
  visible?: boolean;
  initialNotified?: boolean;
  initialFollowing?: boolean;
  className?: string;
  // callbacks to notify parent
  onNotifyChange?: (val: boolean) => void;
  onFollowChange?: (val: boolean) => void;
};

export default function NotificationBell({
  eventId,
  seriesId = null,
  visible = false,
  initialNotified = false,
  initialFollowing = false,
  className = "",
  onNotifyChange,
  onFollowChange,
}: NotificationBellProps) {
  const [notified, setNotified] = useState<boolean>(initialNotified);
  const [following, setFollowing] = useState<boolean>(initialFollowing);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setNotified(initialNotified);
    setFollowing(initialFollowing);
  }, [initialNotified, initialFollowing]);

  const toggleEventNotify = useCallback(
    async (next: boolean) => {
      setLoading(true);
      setNotified(next); // optimistic
      try {
        const res = await fetch(`/api/events/${eventId}/notify`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: next }),
        });
        const json = await res.json();
        if (!res.ok) {
          setNotified(!next);
          console.error(json);
        } else {
          const final = Boolean(json.notified ?? next);
          setNotified(final);
          onNotifyChange?.(final);
        }
      } catch (e) {
        setNotified(!next);
        console.error(e);
      } finally {
        setLoading(false);
      }
    },
    [eventId, onNotifyChange]
  );

  const toggleSeriesFollow = useCallback(
    async (next: boolean) => {
      if (!seriesId) return;
      setLoading(true);
      setFollowing(next); // optimistic
      try {
        const res = await fetch(`/api/series/${seriesId}/follow`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ following: next }),
        });
        const json = await res.json();
        if (!res.ok) {
          setFollowing(!next);
          console.error(json);
        } else {
          const final = Boolean(json.following ?? next);
          setFollowing(final);
          onFollowChange?.(final);
        }
      } catch (e) {
        setFollowing(!next);
        console.error(e);
      } finally {
        setLoading(false);
      }
    },
    [seriesId, onFollowChange]
  );

  // remove the extra combined action button and instead handle series follow + ensure event notify when enabling
  const handleToggleSeries = useCallback(
    async (next: boolean) => {
      // toggle series follow, and when turning on ensure event notify is on as well
      await toggleSeriesFollow(next);
      if (next && !notified) {
        await toggleEventNotify(true);
      }
    },
    [notified, toggleEventNotify, toggleSeriesFollow]
  );

  // FIX: This function should not query the database.
  // It should just call toggleEventNotify with the opposite of the current state.
  const toggle = useCallback(async () => {
    if (loading) return;
    await toggleEventNotify(!notified);
  }, [loading, notified, toggleEventNotify]);

  if (!visible) return null;

  // Single event: icon-only direct toggle, no dropdown
  if (!seriesId) {
    return (
      <button
        type="button"
        aria-label={notified ? "Notifications on" : "Notifications off"}
        className={`btn btn-ghost btn-xs btn-square p-0 ${loading ? "opacity-60" : ""} ${className}`}
        onClick={toggle}
      >
        {notified ? <Bell className="w-4 h-4 text-amber-500" /> : <BellOff className="w-4 h-4 text-gray-400" />}
      </button>
    );
  }

  // Series present: show dropdown with two clear options:
  // - Follow current event (per-event notification)
  // - Follow series (current + future)
  return (
    <div className={`relative ${className}`}>
      <div className="dropdown dropdown-end">
        <button
          type="button"
          tabIndex={0}
          aria-label={notified || following ? "Notifications on" : "Notifications off"}
          className={`btn btn-ghost btn-xs btn-square p-0 ${loading ? "opacity-60" : ""}`}
        >
          {notified || following ? <Bell className="w-4 h-4 text-amber-500" /> : <BellOff className="w-4 h-4 text-gray-400" />}
        </button>

        <ul tabIndex={0} className="dropdown-content menu bg-base-100 rounded-box z-50 w-56 p-2 shadow-sm">
          <li>
            <button
              className={`btn btn-ghost justify-start ${notified ? "font-semibold" : ""}`}
              onClick={() => toggleEventNotify(!notified)}
            >
              {notified ? "Unfollow current event" : "Follow current event"}
            </button>
          </li>

          <li>
            <button
              className={`btn btn-ghost justify-start ${following ? "font-semibold" : ""}`}
              onClick={() => handleToggleSeries(!following)}
            >
              {following ? "Unfollow series" : "Follow series"}
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}