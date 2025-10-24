"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import FeaturedEventCard from "./FeaturedEventCard";
import type { ExploreCardData } from "@/components/explore/EventCard";

type ActionCard = { id: "__view_past__"; type: "action"; label?: string };

type Props = {
  featuredCards: (ExploreCardData | ActionCard)[];
  onCardClick?: (card: ExploreCardData) => void;
  onStarChange?: (cardId: string, nextStarred: boolean) => void;
  onAction?: (action: "view-past") => void;
  title?: string | null;
};

export default function FeaturedCarousel({
  featuredCards,
  onCardClick,
  onStarChange,
  onAction,
  title,
}: Props) {
  if (!featuredCards || featuredCards.length === 0) return null;

  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState(false);

  const refreshScrollability = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanScroll(el.scrollWidth > el.clientWidth + 2);
  }, []);

  useEffect(() => {
    refreshScrollability();
  }, [featuredCards, refreshScrollability]);

  useEffect(() => {
    const onResize = () => refreshScrollability();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [refreshScrollability]);

  const nudge = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const amount = Math.floor(el.clientWidth * 0.8);
    el.scrollBy({ left: dir * amount, behavior: "smooth" });
  };

  const handleWheel = (e: React.WheelEvent) => {
    // Convert vertical wheel to horizontal scroll for easier desktop navigation
    const el = scrollerRef.current;
    if (!el) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  };

  return (
    <section>
      {title ? <h3 className="mb-2 font-semibold">{title}</h3> : null}

      <div className="relative">
        {/* Scrollable rail. pb-3 reserves space for the OS scrollbar; scrollbar-gutter keeps layout stable */}
        <div
          ref={scrollerRef}
          role="region"
          aria-label={title ?? "carousel"}
          className="carousel w-full overflow-x-auto rounded-box gap-3 pb-3 pr-1 scroll-smooth"
          style={{ scrollbarGutter: "stable both-edges", overscrollBehaviorX: "contain" }}
          onWheel={handleWheel}
        >
          {featuredCards.map((item) => {
            if ((item as any).type === "action" && (item as ActionCard).id === "__view_past__") {
              const label = (item as ActionCard).label ?? "View All Past Favorites";
              return (
                <div key="__view_past__" className="carousel-item w-64 shrink-0">
                  <button
                    onClick={() => onAction?.("view-past")}
                    aria-label="View all past favorites"
                    className="w-64 min-w-[16rem] cursor-pointer rounded-lg overflow-hidden border shadow-sm hover:shadow-md transition text-left"
                  >
                    <div className="relative h-40 bg-base-100 flex items-center justify-center">
                      <span className="text-sm font-medium">+ {label}</span>
                    </div>
                  </button>
                </div>
              );
            }

            const card = item as ExploreCardData & { is_past?: boolean };

            return (
              <div key={card.id} className="carousel-item w-64 shrink-0">
                <FeaturedEventCard
                  card={card}
                  onClick={(c) => onCardClick?.(c)}
                  onStarChange={onStarChange}
                />
              </div>
            );
          })}
        </div>

        {/* Desktop nudge buttons (shown only when scrollable) */}
        {canScroll && (
          <>
            <div className="pointer-events-none absolute inset-y-0 left-0 hidden md:flex items-center pl-1">
              <button
                type="button"
                className="pointer-events-auto btn btn-circle btn-sm bg-base-100/80 hover:bg-base-100 shadow"
                onClick={() => nudge(-1)}
                aria-label="Scroll left"
              >
                ‹
              </button>
            </div>
            <div className="pointer-events-none absolute inset-y-0 right-0 hidden md:flex items-center pr-1">
              <button
                type="button"
                className="pointer-events-auto btn btn-circle btn-sm bg-base-100/80 hover:bg-base-100 shadow"
                onClick={() => nudge(1)}
                aria-label="Scroll right"
              >
                ›
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}