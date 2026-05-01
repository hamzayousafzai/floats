"use client";

import { Bookmark, CheckCircle } from "lucide-react";

type Props = {
  favoriteCount: number;
  checkinCount: number;
};

export default function ProfileStats({ favoriteCount, checkinCount }: Props) {
  return (
    <section className="grid grid-cols-2 gap-4">
      <div className="rounded-2xl bg-base-100 shadow-sm px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 flex-shrink-0">
            <Bookmark size={18} className="text-blue-500" />
          </div>
          <div>
            <div className="text-2xl font-bold text-blue-500 leading-none">{favoriteCount}</div>
            <div className="text-xs font-medium text-base-content/60 mt-0.5">Saved Events</div>
          </div>
        </div>
        <p className="text-xs text-base-content/40 mt-2">Events you don&apos;t want to miss</p>
      </div>

      <div className="rounded-2xl bg-base-100 shadow-sm px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-50 flex-shrink-0">
            <CheckCircle size={18} className="text-orange-400" />
          </div>
          <div>
            <div className="text-2xl font-bold text-orange-400 leading-none">{checkinCount}</div>
            <div className="text-xs font-medium text-base-content/60 mt-0.5">Events Attended</div>
          </div>
        </div>
        <p className="text-xs text-base-content/40 mt-2">Thanks for showing up!</p>
      </div>
    </section>
  );
}