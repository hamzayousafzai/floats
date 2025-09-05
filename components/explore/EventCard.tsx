"use client";

import Link from "next/link";
import Image from "next/image";
import { Calendar, MapPin, Store } from "lucide-react";
import FavoriteButton from "@/components/FavoriteButton";

// This is our new, unified data shape for a card on the Explore page.
export type ExploreCardData = {
  id: string;
  href: string;
  imageUrl: string | null;
  title: string;
  category: string;
  starts_at: string;
  address: string | null;
  vendor: {
    id: string;
    name: string;
    slug: string;
  } | null;
};

type Props = {
  card: ExploreCardData;
  isFavorite: boolean; // Is the associated VENDOR favorited?
};

export default function EventCard({ card, isFavorite }: Props) {
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/[0.06] transition hover:shadow-md">
      {/* Main link for the entire card */}
      <Link href={card.href} className="contents" />

      {/* Media */}
      <div className="relative h-40 w-full overflow-hidden">
        {card.imageUrl ? (
          <Image
            src={card.imageUrl}
            alt={card.title}
            fill
            className="object-cover"
            sizes="(max-width: 480px) 100vw, 240px"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200">
            <Store className="h-10 w-10 text-gray-400" />
          </div>
        )}

        {/* Favorite button only shows if there's an associated vendor */}
        {card.vendor && (
          <div className="absolute right-2 top-2 z-10">
            <FavoriteButton vendorId={card.vendor.id} isFavorite={isFavorite} />
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col p-4 space-y-2">
        <div className="flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{card.category}</p>
          <h3 className="text-base font-semibold leading-tight line-clamp-2 mt-1">
            {card.title}
          </h3>
        </div>

        <div className="space-y-1 text-xs text-gray-700">
          <div className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 flex-shrink-0" />
            <span>
              {new Date(card.starts_at).toLocaleDateString(undefined, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit'
              })}
            </span>
          </div>
          {card.address && (
            <div className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate">{card.address}</span>
            </div>
          )}
        </div>

        {/* Vendor Chip */}
        {card.vendor && (
          <div className="pt-2">
            <Link
              href={`/vendor/${card.vendor.slug}`}
              onClick={(e) => e.stopPropagation()} // Prevents navigating to the event page
              className="inline-block rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-800 transition hover:bg-gray-200"
            >
              By: {card.vendor.name}
            </Link>
          </div>
        )}
      </div>
    </article>
  );
}