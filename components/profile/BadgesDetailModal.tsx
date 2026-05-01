"use client";

import { Star, Ticket, Bell, Lock } from "lucide-react";
import React from "react";

const ICONS = { star: Star, ticket: Ticket, bell: Bell } as const;
type IconKey = keyof typeof ICONS;
type Tier = "Bronze" | "Silver" | "Gold" | "Platinum" | null;

type BadgeItem = {
  slug: "favorites" | "checkins" | "notifications";
  name: string;
  icon_key: IconKey;
  current_tier: Tier;
  progress: number;
  next_threshold: number | null;
};

function tierColorHex(tier: Tier): string {
  switch (tier) {
    case "Gold": return "#eab308";
    case "Silver": return "#94a3b8";
    case "Bronze": return "#d97706";
    case "Platinum": return "#a1a1aa";
    default: return "#9ca3af";
  }
}

function tierLabel(tier: Tier): string {
  return tier ?? "Locked";
}

function thresholdsFor(slug: BadgeItem["slug"]): number[] {
  return slug === "checkins" ? [1, 5, 10, 20] : [1, 5, 15, 20];
}

function progressPercent(b: BadgeItem): number {
  if (b.current_tier === "Platinum" || b.next_threshold == null) return 100;
  const t = thresholdsFor(b.slug);
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

function descriptionFor(slug: BadgeItem["slug"], tier: Tier, nextTier: string | null): string {
  const actions: Record<BadgeItem["slug"], string> = {
    favorites: "saving events",
    checkins: "checking in",
    notifications: "setting reminders",
  };
  const action = actions[slug];
  if (tier === null) return `Keep ${action} to unlock.`;
  if (tier === "Platinum" || nextTier === null) return `Amazing! You reached Platinum.`;
  if (tier === "Silver") return `Nice! Keep ${action}.`;
  return `Keep ${action} to reach ${nextTier}.`;
}

type Props = {
  badges: any[];
  onClose: () => void;
};

export default function BadgesDetailModal({ badges, onClose }: Props) {
  const ORDER: BadgeItem["slug"][] = ["favorites", "checkins", "notifications"];

  function asIconKey(k: unknown): IconKey {
    return k === "star" || k === "ticket" || k === "bell" ? k : "star";
  }
  function asSlug(k: unknown): BadgeItem["slug"] {
    return k === "favorites" || k === "checkins" || k === "notifications" ? k : "favorites";
  }

  const bySlug: Partial<Record<BadgeItem["slug"], BadgeItem>> = {};
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

  const items: BadgeItem[] = ORDER.map((slug) => bySlug[slug] ?? {
    slug,
    name: slug === "favorites" ? "Favorites" : slug === "checkins" ? "Check-ins" : "Reminders",
    icon_key: slug === "favorites" ? "star" : slug === "checkins" ? "ticket" : "bell",
    current_tier: null,
    progress: 0,
    next_threshold: 1,
  });

  const nextTierFor = (tier: Tier): string | null =>
    tier === null ? "Bronze" :
    tier === "Bronze" ? "Silver" :
    tier === "Silver" ? "Gold" :
    tier === "Gold" ? "Platinum" : null;

  return (
    <dialog className="modal" open>
      <div className="modal-box max-w-sm max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-base">Your Badges</h3>
          <form method="dialog">
            <button className="btn btn-sm btn-ghost btn-circle" onClick={onClose} aria-label="Close">✕</button>
          </form>
        </div>

        <div className="space-y-3">
          {items.map((b) => {
            const isLocked = b.current_tier === null;
            const isCompleted = b.current_tier === "Platinum" || b.next_threshold === null;
            const Icon = isLocked ? Lock : ICONS[b.icon_key];
            const displayName =
              b.slug === "favorites" ? "Favorites" :
              b.slug === "checkins" ? "Check-ins" : "Reminders";
            const nextTier = nextTierFor(b.current_tier);
            const pct = progressPercent(b);
            const description = descriptionFor(b.slug, b.current_tier, nextTier);

            return (
              <div key={b.slug} className="rounded-xl border p-4 space-y-3">
                {/* Header row */}
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-11 w-11 items-center justify-center rounded-full flex-shrink-0"
                    style={{ backgroundColor: `${tierColorHex(b.current_tier)}18` }}
                  >
                    <Icon size={20} color={tierColorHex(b.current_tier)} strokeWidth={2.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm">{displayName}</div>
                    <div
                      className="text-xs font-semibold"
                      style={{ color: tierColorHex(b.current_tier) }}
                    >
                      {tierLabel(b.current_tier)}
                    </div>
                    <div className="text-[11px] text-base-content/50 mt-0.5 leading-tight">
                      {description}
                    </div>
                  </div>
                </div>

                {/* Linear progress bar */}
                <div className="space-y-1.5">
                  <div className="relative h-2 w-full rounded-full bg-base-200 overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: tierColorHex(b.current_tier),
                      }}
                    />
                  </div>

                  {/* Progress label row */}
                  {isCompleted ? (
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-base-content/40">{b.progress} total</span>
                      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                        Completed
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-base-content/40">{b.progress} / {b.next_threshold}</span>
                      <span className="text-[11px] font-medium" style={{ color: tierColorHex(nextTier as Tier) }}>
                        to {nextTier}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* How it works footer */}
        <div className="mt-4 rounded-lg bg-base-200/60 px-3 py-2.5 flex gap-2 items-start">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-base-content/40"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
          <div>
            <p className="text-[11px] font-semibold text-base-content/60">How it works</p>
            <p className="text-[11px] text-base-content/40 leading-tight mt-0.5">Each badge has 3 tiers: Bronze → Silver → Gold. Reach the target number to level up and unlock new rewards!</p>
          </div>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button onClick={onClose}>close</button>
      </form>
    </dialog>
  );
}
