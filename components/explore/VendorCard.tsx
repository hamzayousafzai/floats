"use client";

import Link from "next/link";
import Image from "next/image";
import { Calendar, MapPin, Store } from "lucide-react";
import FavoriteButton from "@/components/FavoriteButton";

type Props = {
  vendor: {
    id: string;
    slug: string;
    name: string;
    category: string;
    photo_url: string | null;
    next: { starts_at: string; ends_at: string | null; address: string | null } | null;
  };
  isFavorite: boolean;
};

function statusLabel(next: Props["vendor"]["next"]) {
  if (!next) return null;
  const now = Date.now();
  const start = Date.parse(next.starts_at);
  const end = next.ends_at ? Date.parse(next.ends_at) : null;
  if (start <= now && (!end || end > now)) return { label: "Live Now", color: "bg-emerald-600" };
  if (start > now) return { label: "Scheduled", color: "bg-gray-300 text-gray-700" };
  return null;
}

export default function VendorCard({ vendor, isFavorite }: Props) {
  const badge = statusLabel(vendor.next);

  return (
    <article className="group relative overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/[0.06] transition hover:shadow-md">
      {/* Media */}
      <div className="relative h-40 w-full overflow-hidden">
        {vendor.photo_url ? (
          <Image
            src={vendor.photo_url}
            alt={vendor.name}
            fill
            className="object-cover"
            sizes="(max-width: 480px) 100vw, 240px"
            unoptimized={!vendor.photo_url.startsWith("/")}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200">
            <Store className="h-10 w-10 text-gray-400" />
          </div>
        )}

        {badge && (
          <span className={`absolute left-3 top-3 rounded-md px-2 py-1 text-[11px] font-medium text-white ${badge.color}`}>
            {badge.label}
          </span>
        )}

        <div className="absolute right-2 top-2 z-10">
          <FavoriteButton vendorId={vendor.id} isFavorite={isFavorite} />
        </div>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        <div>
          <h3 className="text-sm font-semibold leading-tight line-clamp-1">
            {vendor.name}
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">{vendor.category}</p>
        </div>

        {vendor.next && (
          <div className="space-y-1 text-xs text-gray-600">
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              {new Date(vendor.next.starts_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              {vendor.next.ends_at && " • "}
              {vendor.next.ends_at &&
                new Date(vendor.next.starts_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) +
                  " - " +
                  new Date(vendor.next.ends_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </div>
            {vendor.next.address && (
              <div className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                <span className="truncate">{vendor.next.address}</span>
              </div>
            )}
          </div>
        )}

        <Link
          href={`/vendor/${vendor.slug}`}
          className="block w-full rounded-md bg-black py-2 text-center text-xs font-medium text-white transition hover:bg-black/85"
        >
          View Profile
        </Link>
      </div>
    </article>
  );
}