// components/FavoriteEventsSection.tsx
"use client";

import { useEffect, useState } from "react";
import FeaturedCarousel from "@/components/explore/FeaturedCarousel";
import EventDetailModal from "@/components/explore/EventDetailModal";
import PastFavoritesModal from "@/components/profile/PastFavoritesModal";

// IMPORTANT: use the shared ExploreCardData shape so EventDetailModal(event) accepts it
import type { ExploreCardData } from "@/lib/types";

type Props = { events: Array<any> };
type ActionCard = { id: "__view_past__", type: "action"; label?: string };

export default function FavoriteEventsSection({ events }: Props) {
  const [cards, setCards] = useState<ExploreCardData[]>(
    () =>
      events.map((e: any) => ({
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
        series_id: e.series_id ?? null,
        event_media: e.event_media ?? null,
        // NEW: computed below in a useEffect so initial render stays the same
      }))
  );

  // sync when incoming events prop changes (server refresh)
  useEffect(() => {
    setCards(
      events.map((e: any) => ({
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
        series_id: e.series_id ?? null,
        event_media: e.event_media ?? null,
      }))
    );
  }, [events]);

  // NEW: compute is_past once per changes
  const [decorated, setDecorated] = useState<
    (ExploreCardData & { is_past?: boolean })[]
  >([]);
  useEffect(() => {
    const now = new Date();
    const deco = cards.map((c) => {
      const starts = c.starts_at ? new Date(c.starts_at) : null;
      // @ts-ignore ends_at may exist on upstream rows; safe optional read
      const ends = (c as any).ends_at ? new Date((c as any).ends_at) : null;
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
        new Date(b.starts_at ?? 0).getTime() -
        new Date(a.starts_at ?? 0).getTime()
    );

  const recentPast = past.slice(0, 2);

  const showActionTile = past.length > 2;

  // Give the action card a richer label with the count
  const viewPastAction: ActionCard = {
    id: "__view_past__",
    type: "action",
    label: `View All Past (${past.length})`,
  };

  // Make sure the array is explicitly typed as a union
  const display: Array<ExploreCardData | ActionCard> = [
    ...upcoming,
    ...recentPast,
    ...(showActionTile ? [viewPastAction] : []),
  ];

  const [activeEvent, setActiveEvent] = useState<ExploreCardData | null>(null);
  const [showPast, setShowPast] = useState(false);

  // open modal with the card from current state (not the stale prop)
  const openCard = (c: ExploreCardData) => {
    const current = decorated.find((x) => x.id === c.id) ?? c;
    setActiveEvent(current);
  };

  // updater used by modal to sync changes back into the carousel
  const updateCard = (id: string, patch: Partial<ExploreCardData>) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    setActiveEvent((ae) => (ae && ae.id === id ? { ...ae, ...patch } : ae));
  };

  // Add this handler to update the card's is_starred when FavoriteButton changes
  const handleStarChange = (cardId: string, nextStarred: boolean) => {
    updateCard(cardId, { is_starred: nextStarred });
  };

  const handleCarouselAction = (action: "view-past") => {
    if (action === "view-past") setShowPast(true);
  };

  if (cards.length === 0) return null;

  return (
    <>
      <FeaturedCarousel
        featuredCards={display}
        onCardClick={openCard}
        title="Your Favorites"
        onStarChange={handleStarChange}
        onAction={handleCarouselAction} // NEW
      />

      {showPast && (
        <PastFavoritesModal
          pastCards={past}
          onCardClick={(c) => {
            // Keep the Past modal open; just open the EventDetail on top
            openCard(c);
          }}
          onClose={() => setShowPast(false)}
        />
      )}

      {activeEvent && (
        <EventDetailModal
          event={activeEvent}
          onClose={() => setActiveEvent(null)} // Past modal remains open
          onCardChange={(id, patch) => updateCard(id, patch)}
        />
      )}
    </>
  );
}
