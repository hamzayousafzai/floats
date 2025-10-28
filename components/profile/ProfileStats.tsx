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
        <div className="rounded-xl border px-4 py-3 text-center">
          <div className="text-xl font-semibold">{favoriteCount}</div>
          <div className="text-xs text-gray-500">Favorites</div>
        </div>

        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-xl border px-4 py-3 text-center hover:bg-base-200 transition"
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <div className="text-xl font-semibold">{checkinCount}</div>
          <div className="text-xs text-gray-500">Check-ins</div>
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