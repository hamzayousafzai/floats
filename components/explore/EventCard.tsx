"use client";

import Link from "next/link";
import Image from "next/image";
import { Calendar, MapPin, Store, Heart } from "lucide-react";
import FavoriteButton from "@/components/FavoriteButton";

// This is our new, unified data shape for a card on the Explore page.
export type ExploreCardData = {
  id: string;
  href: string;
  imageUrl: string | null;
  title: string;
  description: string | null; // Add description
  latitude: number | null; // Add latitude
  longitude: number | null;
  category: string;
  starts_at: string;
  address: string;
  vendor: { id: string; name: string; slug: string } | null;
};

type Props = {
  card: ExploreCardData;
  isFavorite: boolean; // Is the associated VENDOR favorited?
  onClick: (card: ExploreCardData) => void; // Add onClick handler prop
};

export default function EventCard({ card, isFavorite, onClick }: Props) {
  const eventDate = new Date(card.starts_at);
  const formattedDate = eventDate.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return (
    // Changed from Link to a clickable div
    <div
      onClick={() => onClick(card)}
      className="card card-compact bg-base-100 shadow-md hover:shadow-lg transition-shadow cursor-pointer"
    >
      <figure className="relative h-40 bg-gray-200">
        {card.imageUrl ? (
          <Image
            src={card.imageUrl}
            alt={card.title}
            layout="fill"
            objectFit="cover"
          />
        ) : (
          <div className="flex items-center justify-center h-full w-full">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-12 w-12 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M12 18V6M6 12h12"
              />
            </svg>
          </div>
        )}
      </figure>
      <div className="card-body">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-xs uppercase font-semibold text-gray-500">
              {card.category}
            </p>
            <h2 className="card-title text-base">{card.title}</h2>
          </div>
          {isFavorite && (
            <Heart className="h-5 w-5 text-red-500 fill-current" />
          )}
        </div>
        <div className="mt-2 space-y-1 text-sm text-gray-600">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            <span>{formattedDate}</span>
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            <span>{card.address}</span>
          </div>
        </div>
      </div>
    </div>
  );
}