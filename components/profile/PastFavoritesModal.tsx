"use client";

import { useMemo } from "react";
import type { ExploreCardData } from "@/lib/types";

type Props = {
  pastCards: (ExploreCardData & { is_past?: boolean })[];
  onCardClick: (card: ExploreCardData) => void;
  onClose: () => void;
};

export default function PastFavoritesModal({ pastCards, onCardClick, onClose }: Props) {
  const sorted = useMemo(
    () =>
      [...pastCards].sort(
        (a, b) => new Date(b.starts_at ?? 0).getTime() - new Date(a.starts_at ?? 0).getTime()
      ),
    [pastCards]
  );

  return (
    <dialog className="modal" open>
      {/* Limit height and enable vertical scrolling; right scrollbar will show */}
      <div className="modal-box max-w-3xl max-h-[80vh] overflow-y-auto pr-2">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">
            Past Favorites ({sorted.length})
          </h3>
          <form method="dialog">
            <button className="btn btn-sm btn-ghost" onClick={onClose}>✕</button>
          </form>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {sorted.map((c) => (
            <button
              type="button" // avoid implicit submit that could close a <dialog> via a form
              key={c.id}
              onClick={() => onCardClick(c)}
              className="text-left rounded-lg border overflow-hidden hover:shadow focus:outline-none"
            >
              <div className="relative aspect-[4/3] bg-gray-100">
                {c.image_url ? (
                  // You likely have an Image wrapper; keeping it simple:
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.image_url}
                    alt={c.title}
                    className="h-full w-full object-cover grayscale opacity-70"
                  />
                ) : (
                  <div className="h-full w-full bg-gray-200" />
                )}
                <span className="badge badge-neutral absolute left-2 top-2">PAST</span>
              </div>
              <div className="p-2">
                <div className="text-sm font-medium line-clamp-1">{c.title}</div>
                {c.starts_at && (
                  <div className="text-xs text-gray-500 mt-0.5">
                    {new Date(c.starts_at).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button onClick={onClose}>close</button>
      </form>
    </dialog>
  );
}