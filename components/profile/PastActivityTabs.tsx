"use client";

import { useState } from "react";
import type { ExploreCardData } from "@/lib/types";

type CheckedInCard = ExploreCardData & { checked_in_at: string };
type PastCard = ExploreCardData & { is_past?: boolean };

type Props = {
  checkedInEvents: CheckedInCard[];
  pastFavorites: PastCard[];
  onEventClick: (card: ExploreCardData) => void;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function EventRow({
  event,
  dateStr,
  onClick,
}: {
  event: ExploreCardData;
  dateStr: string;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center gap-3 py-3 border-b last:border-0">
      {/* Thumbnail */}
      <div className="relative h-16 w-20 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
        {event.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={event.image_url}
            alt={event.title}
            className="h-full w-full object-cover grayscale opacity-80"
          />
        ) : (
          <div className="h-full w-full bg-gray-200" />
        )}
        <span className="absolute top-1 left-1 text-[9px] font-bold bg-gray-800/80 text-white rounded px-1 py-0.5 leading-none">
          PAST
        </span>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm line-clamp-1">{event.title}</div>
        <div className="text-xs text-base-content/50 mt-0.5">{dateStr}</div>
        {event.address && (
          <div className="text-xs text-base-content/40 mt-0.5 line-clamp-1">{event.address}</div>
        )}
      </div>

      {/* View Details */}
      <button
        type="button"
        onClick={onClick}
        className="btn btn-ghost btn-xs border border-base-content/15 whitespace-nowrap flex-shrink-0"
      >
        View Details
      </button>
    </div>
  );
}

export default function PastActivityTabs({ checkedInEvents, pastFavorites, onEventClick }: Props) {
  const [activeTab, setActiveTab] = useState<"attended" | "past-favorites">("attended");

  const hasSomeActivity = checkedInEvents.length > 0 || pastFavorites.length > 0;
  if (!hasSomeActivity) return null;

  return (
    <section className="rounded-2xl bg-base-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-4 pb-0">
        <h2 className="text-base font-semibold">Past Activity</h2>
      </div>

      {/* Tab toggle */}
      <div className="flex gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setActiveTab("attended")}
          className={`flex-1 rounded-full py-1.5 text-sm font-medium transition-colors ${
            activeTab === "attended"
              ? "bg-base-content text-base-100"
              : "bg-base-200 text-base-content/60 hover:bg-base-200/80"
          }`}
        >
          Attended ({checkedInEvents.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("past-favorites")}
          className={`flex-1 rounded-full py-1.5 text-sm font-medium transition-colors ${
            activeTab === "past-favorites"
              ? "bg-base-content text-base-100"
              : "bg-base-200 text-base-content/60 hover:bg-base-200/80"
          }`}
        >
          Past Favorites ({pastFavorites.length})
        </button>
      </div>

      {/* Tab content */}
      <div className="px-4 pb-4">
        {activeTab === "attended" ? (
          checkedInEvents.length === 0 ? (
            <p className="text-sm text-base-content/50 py-4 text-center">No check-ins yet.</p>
          ) : (
            <div>
              {checkedInEvents.map((e) => (
                <EventRow
                  key={e.id}
                  event={e}
                  dateStr={formatDate(e.checked_in_at)}
                  onClick={() => onEventClick(e)}
                />
              ))}
            </div>
          )
        ) : (
          pastFavorites.length === 0 ? (
            <p className="text-sm text-base-content/50 py-4 text-center">No past favorites.</p>
          ) : (
            <div>
              {pastFavorites.map((e) => (
                <EventRow
                  key={e.id}
                  event={e}
                  dateStr={e.starts_at ? formatDate(e.starts_at) : ""}
                  onClick={() => onEventClick(e)}
                />
              ))}
            </div>
          )
        )}
      </div>
    </section>
  );
}
