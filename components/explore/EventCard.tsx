"use client";

import Image from "next/image";
import { Calendar, MapPin, ImageIcon } from "lucide-react";
import SeriesFollowButton from "@/components/SeriesFollowButton";

export type ExploreCardData = {
  id: string;
  image_url: string | null;
  title: string;
  starts_at: string;
  ends_at?: string | null;
  address: string;
  latitude?: number | null;
  longitude?: number | null;
  description?: string | null;
  categories: string[];
  is_starred?: boolean;
  is_notified?: boolean;
  is_series_followed?: boolean;
  series_id?: string | null;
  event_media?: { image_url: string; sort_index: number }[] | null;
  is_past?: boolean;
};

type Props = {
  card: ExploreCardData;
  onClick: () => void;
};

export default function EventCard({ card, onClick }: Props) {
  const eventDate = new Date(card.starts_at);

  const formattedDate = eventDate.toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const formattedTime = eventDate.toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return (
    <div
      onClick={onClick}
      className="card card-compact bg-base-100 shadow-md hover:shadow-lg transition-shadow cursor-pointer"
    >
      <figure className="relative h-40 bg-base-200">
        {card.image_url ? (
          <Image
            src={card.image_url}
            alt={card.title}
            fill
            className={`object-cover ${card.is_past ? "grayscale opacity-70" : ""}`}
          />
        ) : (
          <div className="flex items-center justify-center h-full w-full">
            <ImageIcon className="h-12 w-12 text-base-300" />
          </div>
        )}
        {card.is_past && (
          <span className="badge badge-neutral absolute left-2 top-2">PAST</span>
        )}
      </figure>

      <div className="card-body">
        <h2 className="card-title text-base leading-tight">{card.title}</h2>
        {card.categories?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {card.categories.slice(0, 3).map((cat) => (
              <div key={cat} className="badge badge-outline badge-sm">
                {cat.replace(/-/g, " ")}
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 space-y-1.5 text-sm text-base-content/70">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 flex-shrink-0" />
            <span>
              {formattedDate} at {formattedTime}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 flex-shrink-0" />
            <span className="truncate">{card.address}</span>
          </div>
        </div>
      </div>
    </div>
  );
}