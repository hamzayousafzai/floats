"use client";

import Image from "next/image";
import { Calendar, MapPin, ImageIcon } from "lucide-react";

export type ExploreCardData = {
  id: string;
  image_url: string | null;
  title: string;
  starts_at: string;
  address: string;
  latitude?: number | null;  // Ensure these are in the type
  longitude?: number | null; // Ensure these are in the type
  description?: string | null;
  categories: string[];
};

type Props = {
  card: ExploreCardData;
  onClick: () => void; // Add onClick to the props
};

export default function EventCard({ card, onClick }: Props) {
  const eventDate = new Date(card.starts_at);
  const formattedDate = eventDate.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const formattedTime = eventDate.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return (
    // Use a button for accessibility and to trigger the onClick handler
    <div
      onClick={onClick}
      className="card card-compact bg-base-100 shadow-md hover:shadow-lg transition-shadow cursor-pointer"
    >
      <figure className="relative h-40 bg-base-200">
        {card.image_url ? (
          <Image
            src={card.image_url}
            alt={card.title}
            fill className="object-cover"
          />
        ) : (
          <div className="flex items-center justify-center h-full w-full">
            <ImageIcon className="h-12 w-12 text-base-300" />
          </div>
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
            <span>{formattedDate} at {formattedTime}</span>
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