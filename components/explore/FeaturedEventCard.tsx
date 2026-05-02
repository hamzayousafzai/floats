"use client";

import Image from "next/image";
import { Clock } from "lucide-react";
import { useEffect, useState } from "react";
import FavoriteButton from "@/components/FavoriteButton";
import type { ExploreCardData } from "./EventCard";

export type FeaturedCardData = ExploreCardData;

export default function FeaturedEventCard({
  card,
  onClick,
  onStarChange,
  className = "",
}: {
  card: FeaturedCardData;
  onClick?: (c: FeaturedCardData) => void;
  onStarChange?: (id: string, next: boolean) => void;
  className?: string;
}) {
  const startDate = card.starts_at ? new Date(card.starts_at) : null;
  const endDate = card.ends_at ? new Date(card.ends_at) : null;
  const now = new Date();

  const isLive = startDate && endDate && now >= startDate && now <= endDate;

  // Track starred locally so the button wrapper can respond visually
  const [starred, setStarred] = useState<boolean>(card.is_starred ?? false);

  // Re-sync local state if the card prop changes (e.g. parent updates is_starred externally)
  useEffect(() => {
    setStarred(card.is_starred ?? false);
  }, [card.id, card.is_starred]);

  const formatTimeRange = (startsAt: string, endsAt?: string | null) => {
    const TZ = "America/New_York";
    const start = new Date(startsAt);
    const startStr = start.toLocaleString("en-US", {
      timeZone: TZ,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    if (!endsAt) return startStr;
    const end = new Date(endsAt);
    const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
    const isSameDay = dateFmt.format(start) === dateFmt.format(end);
    if (isSameDay) {
      const endTime = end.toLocaleString("en-US", {
        timeZone: TZ,
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      return `${startStr} – ${endTime}`;
    }
    return startStr;
  };

  const dateText = card.starts_at ? formatTimeRange(card.starts_at, card.ends_at) : "";

  return (
    <article
      onClick={() => onClick?.(card)}
      className={`w-56 min-w-[14rem] cursor-pointer rounded-2xl overflow-hidden bg-white shadow-sm hover:shadow-md transition-shadow border border-black/5 ${className}`}
      role="button"
      aria-label={card.title ?? "event"}
    >
      {/* Hero image */}
      <div className="relative h-36 bg-gray-100">
        {card.image_url ? (
          <Image
            src={card.image_url}
            alt={card.title ?? "event image"}
            fill
            className={`object-cover ${card.is_past ? "grayscale opacity-60" : ""}`}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-gray-400">
            No image
          </div>
        )}

        {/* Gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent" />

        {/* Top badges */}
        <div className="absolute left-2 top-2">
          {isLive && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-semibold uppercase text-white shadow">
              <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
              Live
            </span>
          )}
          {card.is_past && (
            <span className="rounded-full bg-gray-700/80 px-2 py-0.5 text-[10px] font-semibold uppercase text-white">
              Past
            </span>
          )}
        </div>

        {/* Favorite button */}
        <div
          className="absolute right-2 top-2"
          onClick={(e) => e.stopPropagation()}
        >
          <div className={`rounded-full backdrop-blur-sm p-0.5 transition-colors ${starred ? "bg-amber-400/90" : "bg-black/40"}`}>
            <FavoriteButton
              eventId={card.id}
              initialStarred={card.is_starred ?? undefined}
              variant="icon"
              className={starred ? "text-white hover:text-white" : "text-white/80 hover:text-white"}
              onInitialLoad={(val) => setStarred(val)}
              onChange={(next) => {
                setStarred(next);
                onStarChange?.(card.id, next);
              }}
            />
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-3">
        <h3 className="text-sm font-semibold leading-snug line-clamp-2 text-gray-900">
          {card.title}
        </h3>

        {dateText && (
          <div className="mt-1.5 flex items-center gap-1 text-[11px] text-gray-500">
            <Clock className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{dateText}</span>
          </div>
        )}

        {card.categories && card.categories.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {card.categories.slice(0, 2).map((cat) => (
              <span
                key={cat}
                className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] text-gray-500 capitalize"
              >
                {cat.replace(/-/g, " ")}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}