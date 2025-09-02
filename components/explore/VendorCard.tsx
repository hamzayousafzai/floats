"use client";

import { Calendar, MapPin } from "lucide-react";
import FavoriteButton from "@/components/FavoriteButton";

export type VendorCardData = {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  photo_url?: string | null;
  // optional next event snippet:
  next?: { starts_at: string; ends_at?: string | null; address?: string | null } | null;
  // favorite:
  isFavorite?: boolean;
};

export default function VendorCard({
  v,
  onToggle,
}: {
  v: VendorCardData;
  onToggle?: (vendorId: string) => void; // optional local callback
}) {
  const next = v.next;
  return (
    <div className="rounded-xl border overflow-hidden bg-white">
      <a href={`/vendor/${v.slug}`} className="block">
        <div className="aspect-[16/9] bg-gray-100">
          {/* Simple image; replace with next/image later */}
          {v.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v.photo_url} alt={v.name} className="h-full w-full object-cover" />
          ) : null}
        </div>
      </a>

      <div className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <a href={`/vendor/${v.slug}`} className="font-medium underline">{v.name}</a>
            <div className="text-xs text-gray-500">{v.category ?? "—"}</div>
          </div>

          {/* Hook to server action via FavoriteButton if you pass it down */}
          {onToggle ? (
            <button
              onClick={() => onToggle(v.id)}
              className={`rounded-full border px-2 py-1 text-xs ${v.isFavorite ? "bg-black text-white" : "bg-white"}`}
              aria-pressed={!!v.isFavorite}
            >
              {v.isFavorite ? "★" : "☆"}
            </button>
          ) : null}
        </div>

        {next ? (
          <div className="mt-2 flex flex-col gap-1 text-xs text-gray-600">
            <div className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              <span>{new Date(next.starts_at).toLocaleString()}</span>
            </div>
            {next.address ? (
              <div className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                <span>{next.address}</span>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-2 text-xs text-gray-500">No upcoming event</div>
        )}

        <a href={`/vendor/${v.slug}`} className="mt-3 w-full inline-flex justify-center rounded-md border px-3 py-2 text-sm">
          View Profile
        </a>
      </div>
    </div>
  );
}
