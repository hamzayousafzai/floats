"use client";

import { useCallback, useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export type FavoriteButtonProps = {
  eventId: string;
  seriesId?: string | null;
  /** ISO string with offset; used to decide auto-follow eligibility */
  startsAt?: string | null;
  /** if you already know starred state, pass it to skip the initial fetch */
  initialStarred?: boolean;
  /** display variant: icon (compact) or pill (star + label) */
  variant?: "icon" | "pill";
  /** visual size for pill/icon */
  size?: "sm" | "md" | "lg";
  className?: string;
  onChange?: (starred: boolean) => void;
};

export default function FavoriteButton({
  eventId,
  seriesId = null,
  startsAt = null,
  initialStarred,
  variant = "icon",
  size = "md",
  className = "",
  onChange,
}: FavoriteButtonProps) {
  const supabase = createSupabaseBrowserClient();
  const router = useRouter();
  const [loading, setLoading] = useState<boolean>(false);
  const [starred, setStarred] = useState<boolean>(!!initialStarred);

  // load star state when initialStarred not provided
  useEffect(() => {
    let active = true;
    if (initialStarred !== undefined) return;
    (async () => {
      try {
        setLoading(true);
        const { data: auth } = await supabase.auth.getUser();
        if (!auth?.user) { if (active) setStarred(false); return; }
        const uid = auth.user.id;

        const { data, error } = await supabase
          .from("event_stars")
          .select("event_id")
          .eq("user_id", uid)
          .eq("event_id", eventId)
          .maybeSingle();

        if (active) {
          if (error) {
            console.error("FavoriteButton load error:", error);
            setStarred(false);
            onChange?.(false);            // notify parent on error -> not starred
          } else {
            const resolved = !!data;
            setStarred(resolved);
            onChange?.(resolved);         // IMPORTANT: sync parent with initial value
          }
        }
      } catch (err) {
        console.error("FavoriteButton load exception:", err);
        if (active) {
          setStarred(false);
          onChange?.(false);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [eventId, initialStarred, supabase, onChange]);

  const toggle = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      const returnTo = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/";
      router.push(`/login?next=${encodeURIComponent(returnTo)}`);
      return;
    }

    if (loading) return;
    setLoading(true);
    const next = !starred;
    setStarred(next);
    onChange?.(next);

    try {
      const uid = user.id;

      if (next) {
        const { error: upsertErr } = await supabase
          .from("event_stars")
          .upsert([{ user_id: uid, event_id: eventId }], { onConflict: "user_id,event_id" });
        if (upsertErr) throw upsertErr;

        const parsed = startsAt ? Date.parse(startsAt) : NaN;
        const isFuture = isNaN(parsed) ? true : parsed > Date.now();
        if (seriesId && isFuture) {
          const { error: followErr } = await supabase
            .from("series_follows")
            .upsert([{ user_id: uid, series_id: seriesId }], { onConflict: "user_id,series_id" });
          if (followErr) console.warn("series follow upsert failed:", followErr);
        }
      } else {
        const { error: delErr } = await supabase
          .from("event_stars")
          .delete()
          .eq("user_id", uid)
          .eq("event_id", eventId);
        if (delErr) throw delErr;
      }
    } catch (e) {
      setStarred(!next);
      onChange?.(!next);
      console.error("Favorite toggle error:", e);
    } finally {
      setLoading(false);
    }
  }, [loading, starred, supabase, eventId, seriesId, startsAt, onChange, router]);

  const sizeClass = size === "sm" ? "btn-sm" : size === "lg" ? "btn-lg" : "btn-md";

  if (variant === "icon") {
    // DaisyUI ghost icon button
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={loading}
        aria-label={starred ? "Unfavorite" : "Favorite"}
        className={`btn btn-ghost ${sizeClass} ${className}`}
        title={starred ? "Unfavorite" : "Favorite"}
      >
        <span className="text-lg">{starred ? "★" : "☆"}</span>
      </button>
    );
  }

  // pill / labeled variant using DaisyUI "btn" with icon + text
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={loading}
      aria-pressed={starred}
      className={`btn ${starred ? "btn-primary" : "btn-outline"} ${sizeClass} ${className}`}
      title={starred ? "Favorited" : "Favorite"}
    >
      <span className="mr-2 text-lg leading-none">{starred ? "★" : "☆"}</span>
      <span className="whitespace-nowrap">{starred ? "Favorited" : "Favorite"}</span>
    </button>
  );
}
