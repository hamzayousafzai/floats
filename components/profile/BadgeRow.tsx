"use client";
import { Star, Ticket, Bell } from "lucide-react";
import { useRef, useState, useEffect } from "react";
import React from "react";
import BadgesDetailModal from "@/components/profile/BadgesDetailModal";
import type { Database } from "@/lib/database.types";

type BadgeDbRow = Database["public"]["Views"]["v_user_badges"]["Row"];

const ICONS = { star: Star, ticket: Ticket, bell: Bell } as const;
type IconKey = keyof typeof ICONS;
type Tier = "Bronze" | "Silver" | "Gold" | "Platinum" | null;

type BadgeRowItem = {
  slug: "favorites" | "checkins" | "notifications";
  name: string;
  icon_key: IconKey;
  current_tier: Tier;
  progress: number;
  next_threshold: number | null;
};

const ORDER: BadgeRowItem["slug"][] = ["favorites", "checkins", "notifications"];

function asIconKey(k: unknown): IconKey {
  return k === "star" || k === "ticket" || k === "bell" ? k : "star";
}
function asSlug(k: unknown): BadgeRowItem["slug"] {
  return k === "favorites" || k === "checkins" || k === "notifications" ? k : "favorites";
}
function tierColorHex(tier: Tier): string {
  switch (tier) {
    case "Gold": return "#eab308";     // yellow-500
    case "Silver": return "#94a3b8";   // slate-400
    case "Bronze": return "#d97706";   // amber-600
    case "Platinum": return "#a1a1aa"; // zinc-400
    default: return "#9ca3af";         // gray-400 (locked)
  }
}

// thresholds per badge (now with Platinum at 20)
function thresholdsFor(slug: BadgeRowItem["slug"]): number[] {
  // favorites/notifications: 1,5,15,20 | checkins: 1,5,10,20
  return slug === "checkins" ? [1, 5, 10, 20] : [1, 5, 15, 20];
}

function progressPercent(b: BadgeRowItem): number {
  // If maxed (Platinum) or no next threshold, show full ring
  if (b.current_tier === "Platinum" || b.next_threshold == null) return 100;

  const t = thresholdsFor(b.slug);
  // Map current tier -> previous threshold for the segment
  const prev =
    b.current_tier === null ? 0 :
    b.current_tier === "Bronze" ? t[0] :
    b.current_tier === "Silver" ? t[1] :
    b.current_tier === "Gold"   ? t[2] : 0;

  const next = b.next_threshold ?? t[t.length - 1];
  const denom = Math.max(next - prev, 1);
  const pct = ((b.progress - prev) / denom) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export default function BadgeRow({ badges }: { badges: BadgeDbRow[] }) {
  const [showModal, setShowModal] = useState(false);
  const [openSlug, setOpenSlug] = useState<BadgeRowItem["slug"] | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function openTip(slug: BadgeRowItem["slug"]) {
    if (timerRef.current) clearTimeout(timerRef.current);
    setOpenSlug(slug);
    timerRef.current = setTimeout(() => setOpenSlug(null), 1500);
  }
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const bySlug: Partial<Record<BadgeRowItem["slug"], BadgeRowItem>> = {};
  for (const b of badges ?? []) {
    const slug = asSlug(b?.slug);
    bySlug[slug] = {
      slug,
      name: String(b?.name ?? slug),
      icon_key: asIconKey(b?.icon_key),
      current_tier: (b?.current_tier ?? null) as Tier,
      progress: Number(b?.progress ?? 0),
      next_threshold: b?.next_threshold == null ? null : Number(b.next_threshold),
    };
  }

  const items: BadgeRowItem[] = ORDER.map((slug) => bySlug[slug] ?? {
    slug,
    name: slug === "favorites" ? "Favorites" : slug === "checkins" ? "Check-ins" : "Notifications",
    icon_key: slug === "favorites" ? "star" : slug === "checkins" ? "ticket" : "bell",
    current_tier: null,
    progress: 0,
    next_threshold: 1,
  });

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold">Your Progress</h3>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="text-xs text-base-content/50 hover:text-base-content/80 transition-colors flex items-center gap-1"
        >
          View all badges
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
        </button>
      </div>

      <section className="rounded-xl border px-6 sm:px-8 py-4">
        <div className="flex items-center justify-between gap-3">
          {items.map((b) => {
            const Icon = ICONS[b.icon_key];
            const displayName =
              b.slug === "favorites" ? "Favorites" :
              b.slug === "checkins" ? "Check-ins" : "Reminders";

            // Next tier label (null when maxed)
            const nextLabel =
              b.next_threshold == null ? null :
              b.current_tier === null ? "Bronze" :
              b.current_tier === "Bronze" ? "Silver" :
              b.current_tier === "Silver" ? "Gold" :
              b.current_tier === "Gold" ? "Platinum" : null;

            const tierText = b.current_tier ?? "Locked";
            const tip = nextLabel
              ? `${displayName}: ${tierText} • ${b.progress}/${b.next_threshold} to ${nextLabel}`
              : `${displayName}: ${tierText} • ${b.progress} (Max tier)`;

            const forcedOpen = openSlug === b.slug;
            const pct = progressPercent(b);

            const radialStyle = {
              "--value": pct,
              "--size": "3.5rem",
              "--thickness": "4px",
              color: tierColorHex(b.current_tier), // ring + icon color
            } as React.CSSProperties;

            return (
              <div key={b.slug} className="flex basis-1/3 flex-col items-center text-center">
                <div
                  className={
                    "tooltip tooltip-bottom" + (forcedOpen ? " tooltip-open" : "")
                  }
                  data-tip={tip}
                >
                  <div className="radial-progress" style={radialStyle} role="progressbar">
                    <button
                      type="button"
                      onClick={() => openTip(b.slug)}
                      onTouchStart={() => openTip(b.slug)} // mobile tap
                      className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-base-200 shadow-sm select-none touch-manipulation"
                      aria-label={`${displayName} badge`}
                    >
                      <Icon
                        className="block h-6 w-6"
                        color={tierColorHex(b.current_tier)} // explicit icon color
                        strokeWidth={2.5}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                </div>

                <div className="mt-2 text-xs font-medium text-base-content/70">
                  {displayName}
                </div>
                <div className="text-[10px] font-semibold mt-0.5" style={{ color: tierColorHex(b.current_tier) }}>
                  {b.current_tier ?? "Locked"}
                </div>
                {/* Progress label */}
                <div className="text-[10px] text-base-content/40 mt-0.5">
                  {b.next_threshold != null ? `${b.progress}/${b.next_threshold}` : `${b.progress}`}
                  {b.current_tier && b.next_threshold != null ? (
                    <span className="ml-1 font-medium" style={{ color: tierColorHex(b.current_tier) }}>
                      {b.current_tier === "Bronze" ? "to Silver" : b.current_tier === "Silver" ? "to Gold" : b.current_tier === "Gold" ? "to Platinum" : ""}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>


      </section>

      {showModal && (
        <BadgesDetailModal badges={badges} onClose={() => setShowModal(false)} />
      )}
    </>
  );
}
