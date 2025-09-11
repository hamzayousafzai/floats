"use client";

import Image from "next/image";
import { ImageIcon } from "lucide-react";
import { KeyboardEvent } from "react";

export type FeaturedCardData = {
  id: string;
  title: string;
  starts_at: string;
  image_url: string | null;
  // Add other fields needed by the modal
  description: string | null;
  address: string;
  latitude: number | null;
  longitude: number | null;
  categories: string[];
};

type Props = {
  card: FeaturedCardData;
  onClick: () => void;
};

export default function FeaturedEventCard({ card, onClick }: Props) {
  const eventDate = new Date(card.starts_at);
  const formattedDate = eventDate.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
  });

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <div
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      className="carousel-item flex flex-col w-44 text-left cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary rounded-lg"
    >
      <figure className="relative aspect-square w-full rounded-lg overflow-hidden bg-base-200">
        {card.image_url ? (
          <Image
            src={card.image_url}
            alt={card.title}
            fill
            style={{ objectFit: "cover" }}
          />
        ) : (
          <div className="flex items-center justify-center h-full w-full">
            <ImageIcon className="h-12 w-12 text-base-300" />
          </div>
        )}
      </figure>
      <div className="mt-2 px-1">
        <p className="text-xs font-semibold text-gray-500">{formattedDate}</p>
        <h3 className="text-sm font-bold truncate">{card.title}</h3>
      </div>
    </div>
  );
}