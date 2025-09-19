"use client";

import Image from "next/image";
import { Calendar } from "lucide-react";
import FavoriteButton from "@/components/FavoriteButton";
// use the shared ExploreCardData shape
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
  // updated: accept (id, next) so parent can update by id
  onStarChange?: (id: string, next: boolean) => void;
  className?: string;
}) {
  const dateText = card.starts_at
    ? new Date(card.starts_at).toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

  return (
    <article
      onClick={() => onClick?.(card)}
      className={`w-64 min-w-[16rem] cursor-pointer rounded-lg overflow-hidden border shadow-sm ${className}`}
      role="button"
      aria-label={card.title ?? "event"}
    >
      <div className="relative h-40 bg-base-200">
        {card.image_url ? (
          <Image
            src={card.image_url}
            alt={card.title ?? "event image"}
            fill className="object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-sm text-gray-500">
            No image
          </div>
        )}
      </div>

      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold line-clamp-2">{card.title}</h3>

          <div onClick={(e) => e.stopPropagation()}>
            <FavoriteButton
              eventId={card.id}
              initialStarred={card.is_starred ?? undefined}
              variant="icon"
              // pass card id along with next state
              onChange={(next) => onStarChange?.(card.id, next)}
            />
          </div>
        </div>

        {dateText && (
          <p className="text-xs text-gray-500 mt-1">{dateText}</p>
        )}

        {card.address && (
          <div className="mt-2 flex items-center gap-2 text-xs text-base-content/70">
            <Calendar className="h-3.5 w-3.5" />
            <span className="truncate">{card.address}</span>
          </div>
        )}

        {card.categories && card.categories.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {card.categories.slice(0, 3).map((cat) => (
              <div key={cat} className="badge badge-outline badge-sm">
                {cat.replace(/-/g, " ")}
              </div>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}