"use client";

import type { ExploreCardData } from "@/lib/types";

type Props = {
  upcomingCards: ExploreCardData[];
  onCardClick: (card: ExploreCardData) => void;
  onClose: () => void;
};

export default function AllFavoritesModal({ upcomingCards, onCardClick, onClose }: Props) {
  return (
    <dialog className="modal" open>
      <div className="modal-box max-w-3xl max-h-[80vh] overflow-y-auto pr-2">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Saved Events ({upcomingCards.length})</h3>
          <form method="dialog">
            <button className="btn btn-sm btn-ghost btn-circle" onClick={onClose} aria-label="Close">✕</button>
          </form>
        </div>

        {upcomingCards.length === 0 ? (
          <p className="text-sm text-base-content/60">No upcoming saved events.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {upcomingCards.map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => onCardClick(c)}
                className="text-left rounded-lg border overflow-hidden hover:shadow focus:outline-none transition-shadow"
              >
                <div className="relative aspect-[4/3] bg-gray-100">
                  {c.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.image_url}
                      alt={c.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full bg-gray-200" />
                  )}
                </div>
                <div className="p-2">
                  <div className="text-sm font-medium line-clamp-1">{c.title}</div>
                  {c.starts_at && (
                    <div className="text-xs text-gray-500 mt-0.5">
                      {new Date(c.starts_at).toLocaleString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </div>
                  )}
                  {c.address && (
                    <div className="text-xs text-gray-400 mt-0.5 line-clamp-1">{c.address}</div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      <form method="dialog" className="modal-backdrop">
        <button onClick={onClose}>close</button>
      </form>
    </dialog>
  );
}
