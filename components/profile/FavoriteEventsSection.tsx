"use client";

import { useEffect, useState } from "react";
import FeaturedEventCard from "@/components/explore/FeaturedEventCard";
import EventDetailModal from "@/components/explore/EventDetailModal";
import AllFavoritesModal from "@/components/profile/AllFavoritesModal";
import PastActivityTabs from "@/components/profile/PastActivityTabs";
import type { ExploreCardData } from "@/lib/types";

type CheckedInCard = ExploreCardData & { checked_in_at: string };
type Props = {
  events: ExploreCardData[];
  checkedInEvents?: CheckedInCard[];
};

export default function FavoriteEventsSection({ events, checkedInEvents = [] }: Props) {
  const mapEventToCard = (e: ExploreCardData): ExploreCardData => ({
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
    event_url: e.event_url ?? null,
  });

  const [cards, setCards] = useState<ExploreCardData[]>(() => events.map(mapEventToCard));

  useEffect(() => {
    setCards(events.map(mapEventToCard));
  }, [events]);

  // Classify past vs upcoming client-side
  const [decorated, setDecorated] = useState<(ExploreCardData & { is_past?: boolean })[]>([]);

  useEffect(() => {
    const now = new Date();
    const deco = cards.map((c) => {
      const starts = c.starts_at ? new Date(c.starts_at) : null;
      const ends = c.ends_at ? new Date(c.ends_at) : null;
      const isPast = ends ? ends < now : starts ? starts < now : false;
      return { ...c, is_past: isPast };
    });
    setDecorated(deco);
  }, [cards]);

  const upcoming = decorated.filter((c) => !c.is_past);
  const past = [...decorated]
    .filter((c) => c.is_past)
    .sort(
      (a, b) =>
        new Date(b.starts_at ?? 0).getTime() - new Date(a.starts_at ?? 0).getTime()
    );

  const [activeEvent, setActiveEvent] = useState<ExploreCardData | null>(null);
  const [showAllFavorites, setShowAllFavorites] = useState(false);

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

  if (cards.length === 0 && checkedInEvents.length === 0) return null;

  return (
    <section className="space-y-6">
      {/* Upcoming Saved Events */}
      {cards.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-base font-semibold">Upcoming Saved Events</h2>
            {upcoming.length > 0 && (
              <button
                type="button"
                onClick={() => setShowAllFavorites(true)}
                className="text-xs text-base-content/50 hover:text-base-content/80 transition-colors flex items-center gap-1"
              >
                View all
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
              </button>
            )}
          </div>

          {upcoming.length === 0 ? (
            <p className="text-sm text-base-content/50 px-1">No upcoming saved events.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {upcoming.slice(0, 3).map((c) => (
                <FeaturedEventCard
                  key={c.id}
                  card={c}
                  className="w-full"
                  onClick={openCard}
                  onStarChange={handleStarChange}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Past Activity: tabbed section */}
      <PastActivityTabs
        checkedInEvents={checkedInEvents}
        pastFavorites={past}
        onEventClick={openCard}
      />

      {showAllFavorites && (
        <AllFavoritesModal
          upcomingCards={upcoming}
          onCardClick={(c) => {
            setShowAllFavorites(false);
            openCard(c);
          }}
          onClose={() => setShowAllFavorites(false)}
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

