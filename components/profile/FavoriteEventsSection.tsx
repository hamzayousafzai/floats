"use client";

import { useEffect, useState } from "react";
import FeaturedEventCard from "@/components/explore/FeaturedEventCard";
import EventDetailModal from "@/components/explore/EventDetailModal";
import PastFavoritesModal from "@/components/profile/PastFavoritesModal";
import type { ExploreCardData } from "@/lib/types";

type Props = { events: Array<any> };

// We define a union type for our display list
type DisplayItem = 
  | { type: "event"; data: ExploreCardData }
  | { type: "action"; id: string; label: string; count: number };

export default function FavoriteEventsSection({ events }: Props) {
  const mapEventToCard = (e: any): ExploreCardData => ({
    id: String(e.id),
    title: e.title ?? "",
    starts_at: e.starts_at ?? null,
    image_url: e.image_url ?? null,
    description: e.description ?? null,
    address: e.address ?? null,
    latitude: e.latitude ?? null,
    longitude: e.longitude ?? null,
    categories: Array.isArray(e.categories) ? e.categories : [],
    is_starred: !!e.is_starred,
    is_notified: !!e.is_notified,
    series_id: e.series_id ?? null,
    event_media: e.event_media ?? null,
  });

  const [cards, setCards] = useState<ExploreCardData[]>(() => events.map(mapEventToCard));

  useEffect(() => {
    setCards(events.map(mapEventToCard));
  }, [events]);

  // Compute is_past
  const [decorated, setDecorated] = useState<
    (ExploreCardData & { is_past?: boolean })[]
  >([]);
  
  useEffect(() => {
    const now = new Date();
    const deco = cards.map((c) => {
      const starts = c.starts_at ? new Date(c.starts_at) : null;
      // @ts-ignore ends_at safe optional read
      const ends = (c as any).ends_at ? new Date((c as any).ends_at) : null;
      const isPast = ends ? ends < now : starts ? starts < now : false;
      return { ...c, is_past: isPast };
    });
    setDecorated(deco);
  }, [cards]);

  // --- LOGIC PRESERVED FROM ORIGINAL ---
  const upcoming = decorated.filter((c) => !c.is_past);
  const past = [...decorated]
    .filter((c) => c.is_past)
    .sort(
      (a, b) =>
        new Date(b.starts_at ?? 0).getTime() -
        new Date(a.starts_at ?? 0).getTime()
    );

  const recentPast = past.slice(0, 2);
  const showActionTile = past.length > 2;

  // Build the display list
  const displayItems: DisplayItem[] = [
    ...upcoming.map(c => ({ type: "event" as const, data: c })),
    ...recentPast.map(c => ({ type: "event" as const, data: c })),
  ];

  if (showActionTile) {
    displayItems.push({
      type: "action",
      id: "__view_past__",
      label: "View All Past",
      count: past.length
    });
  }
  // -------------------------------------

  const [activeEvent, setActiveEvent] = useState<ExploreCardData | null>(null);
  const [showPast, setShowPast] = useState(false);

  const openCard = (c: ExploreCardData) => {
    const current = decorated.find((x) => x.id === c.id) ?? c;
    setActiveEvent(current);
  };

  const updateCard = (id: string, patch: Partial<ExploreCardData>) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    setActiveEvent((ae) => (ae && ae.id === id ? { ...ae, ...patch } : ae));
  };

  const handleStarChange = (cardId: string, nextStarred: boolean) => {
    updateCard(cardId, { is_starred: nextStarred });
  };

  if (cards.length === 0) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-lg font-semibold">Your Favorites</h2>
      </div>

      {/* VISUAL UPDATE: Direct Grid Layout */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {displayItems.map((item) => {
          if (item.type === "event") {
            return (
              <FeaturedEventCard
                key={item.data.id}
                card={item.data}
                className="w-full"
                onClick={openCard} // FIX: Changed from onCardClick to onClick
                onStarChange={handleStarChange}
              />
            );
          } else {
            return (
              <div
                key={item.id}
                onClick={() => setShowPast(true)}
                className="group relative w-full cursor-pointer rounded-2xl overflow-hidden border border-black/5 shadow-sm bg-white hover:shadow-md transition-shadow"
                role="button"
              >
                <div className="h-44 bg-gray-100 flex items-center justify-center group-hover:bg-gray-50 transition-colors">
                  <div className="rounded-full bg-white p-3 shadow-sm">
                    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                  </div>
                </div>
                <div className="p-3.5 text-center">
                  <h3 className="text-sm font-semibold text-gray-900">{item.label}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{item.count} archived</p>
                </div>
              </div>
            );
          }
        })}
      </div>

      {showPast && (
        <PastFavoritesModal
          pastCards={past}
          onCardClick={(c) => openCard(c)}
          onClose={() => setShowPast(false)}
        />
      )}

      {activeEvent && (
        <EventDetailModal
          event={activeEvent}
          onClose={() => setActiveEvent(null)}
          onCardChange={updateCard}
        />
      )}
    </section>
  );
}
