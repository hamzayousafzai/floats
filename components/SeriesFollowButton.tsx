"use client";

import { useState } from "react";

export default function SeriesFollowButton({
  seriesId,
  initiallyFollowing = false,
}: {
  seriesId: string;
  initiallyFollowing?: boolean;
}) {
  const [following, setFollowing] = useState(initiallyFollowing);
  const [loading, setLoading] = useState(false);

  async function toggle(e?: React.MouseEvent) {
    e?.stopPropagation();
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/series/${seriesId}/follow`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.following !== undefined) {
        setFollowing(Boolean(data.following));
      } else if (res.ok) {
        // server returned success but not flag — flip heuristically
        setFollowing((f) => !f);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={toggle}
      aria-pressed={following}
      title={following ? "Following series" : "Follow series"}
      className="flex items-center gap-1 text-sm"
    >
      <span className={`text-lg ${following ? "text-yellow-500" : "text-gray-400"}`}>🔔</span>
    </button>
  );
}