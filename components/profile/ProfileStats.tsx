"use client";

import { useState } from "react";
import type { ExploreCardData } from "@/lib/types";
import CheckedInEventsModal from "./CheckedInEventsModal";

type CheckedInCard = ExploreCardData & { checked_in_at: string };

type Props = {
  favoriteCount: number;
  checkinCount: number;
  checkedInEvents: CheckedInCard[];
};

export default function ProfileStats({ favoriteCount, checkinCount, checkedInEvents }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <section className="grid grid-cols-2 gap-4">
        <div className="rounded-2xl bg-base-100 shadow-sm px-4 py-4 text-center">
          <div className="text-2xl font-bold text-primary">{favoriteCount}</div>
          <div className="text-xs font-medium text-base-content/60 uppercase tracking-wide mt-1">Favorites</div>
        </div>

        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-2xl bg-base-100 shadow-sm px-4 py-4 text-center hover:scale-[1.02] transition-transform active:scale-95"
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <div className="text-2xl font-bold text-secondary">{checkinCount}</div>
          <div className="text-xs font-medium text-base-content/60 uppercase tracking-wide mt-1">Check-ins</div>
        </button>
      </section>

      {open && (
        <CheckedInEventsModal
          events={checkedInEvents}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}