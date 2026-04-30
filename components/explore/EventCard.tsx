"use client";

import Image from "next/image";
import { Clock, MapPin, ImageIcon } from "lucide-react";

import type { ExploreCardData } from "@/lib/types";
export type { ExploreCardData } from "@/lib/types";

type Props = {
  card: ExploreCardData;
  onClick: () => void;
};

export default function EventCard({ card, onClick }: Props) {
  const startDate = card.starts_at ? new Date(card.starts_at) : null;
  const endDate = card.ends_at ? new Date(card.ends_at) : null;
  const now = new Date();

  const isLive = startDate && endDate && now >= startDate && now <= endDate;

  // Show urgency badge if starting within 6 hours
  const hoursUntilStart =
    startDate && now < startDate
      ? (startDate.getTime() - now.getTime()) / (1000 * 60 * 60)
      : null;
  const urgencyLabel =
    hoursUntilStart !== null && hoursUntilStart <= 6
      ? hoursUntilStart < 1
        ? `STARTS IN ${Math.round(hoursUntilStart * 60)}m`
        : `STARTS IN ${Math.round(hoursUntilStart)}h`
      : null;

  const formattedDate = startDate
    ? startDate.toLocaleString("en-US", {
        timeZone: "America/New_York",
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : null;

  const formattedTime = startDate
    ? startDate.toLocaleString("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : null;

  return (
    <div
      onClick={onClick}
      className="group cursor-pointer rounded-2xl overflow-hidden bg-white shadow-sm hover:shadow-md transition-shadow border border-black/5"
    >
      {/* Image */}
      <div className="relative h-44 bg-gray-100">
        {card.image_url ? (
          <Image
            src={card.image_url}
            alt={card.title}
            fill
            className={`object-cover transition-transform duration-300 group-hover:scale-[1.02] ${
              card.is_past ? "grayscale opacity-60" : ""
            }`}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ImageIcon className="h-10 w-10 text-gray-300" />
          </div>
        )}

        {/* Gradient overlay for badge legibility */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent" />

        {/* Status badges */}
        <div className="absolute left-2.5 top-2.5 flex gap-1.5">
          {isLive && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-500 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white shadow">
              <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
              Live
            </span>
          )}
          {!isLive && urgencyLabel && (
            <span className="rounded-full bg-orange-500 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white shadow">
              {urgencyLabel}
            </span>
          )}
          {card.is_past && (
            <span className="rounded-full bg-gray-700/80 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
              Past
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-3.5">
        <h2 className="text-sm font-semibold leading-snug text-gray-900 line-clamp-2">
          {card.title}
        </h2>

        {/* Tags */}
        {card.categories?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {card.categories.slice(0, 3).map((cat) => (
              <span
                key={cat}
                className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-500 capitalize"
              >
                {cat.replace(/-/g, " ")}
              </span>
            ))}
          </div>
        )}

        {/* Meta */}
        <div className="mt-2.5 space-y-1 text-xs text-gray-500">
          {startDate && (
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 flex-shrink-0" />
              <span>
                {formattedDate} · {formattedTime}
              </span>
            </div>
          )}
          {card.address && (
            <div className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate">{card.address}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}