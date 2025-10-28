"use client";

import type { ExploreCardData } from "@/lib/types";

type Props = {
  events: (ExploreCardData & { checked_in_at: string })[];
  onClose: () => void;
};

export default function CheckedInEventsModal({ events, onClose }: Props) {
  return (
    <dialog className="modal" open>
      <div className="modal-box max-w-3xl max-h-[80vh] overflow-y-auto pr-2">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Check-ins ({events.length})</h3>
          <form method="dialog">
            <button className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close">✕</button>
          </form>
        </div>

        {events.length === 0 ? (
          <p className="text-sm text-base-content/60">No check-ins yet.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {events.map((e) => (
              <div key={e.id} className="text-left rounded-lg border overflow-hidden hover:shadow">
                <div className="relative aspect-[4/3] bg-base-200">
                  {e.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={e.image_url} alt={e.title} className="h-full w-full object-cover" />
                  ) : null}
                  <span className="badge badge-success absolute left-2 top-2">CHECKED‑IN</span>
                </div>
                <div className="p-2">
                  <div className="text-sm font-medium line-clamp-1">{e.title}</div>
                  <div className="text-xs text-base-content/60 mt-0.5">
                    {new Date(e.checked_in_at).toLocaleString()}
                  </div>
                </div>
              </div>
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