"use client";

import { useEffect, useRef, useState } from "react";
import { X, Calendar, MapPin, ChevronLeft, ChevronRight } from "lucide-react";
import type { EventPin } from "@/lib/types";
import { getEventTimeCategory, fmtRange } from "./PinPopup";

type Props = {
  pins: EventPin[];
  onClose: () => void;
  onViewEvent: (pin: EventPin) => void;
};

export default function MapBottomSheet({ pins, onClose, onViewEvent }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const touchStartXRef = useRef<number | null>(null);

  // Reset index whenever the set of pins changes
  useEffect(() => {
    setCurrentIndex(0);
  }, [pins]);

  const isVisible = pins.length > 0;
  const pin = pins[currentIndex] ?? null;
  const isMulti = pins.length > 1;

  const prev = () => setCurrentIndex((i) => (i - 1 + pins.length) % pins.length);
  const next = () => setCurrentIndex((i) => (i + 1) % pins.length);

  // Dismiss on backdrop tap
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  // Dismiss on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && isMulti) prev();
      if (e.key === "ArrowRight" && isMulti) next();
    };
    if (isVisible) document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, isMulti, pins.length]);

  // Touch swipe handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartXRef.current;
    touchStartXRef.current = null;
    if (!isMulti) return;
    if (dx > 50) prev();
    else if (dx < -50) next();
  };

  const category = pin?.starts_at
    ? getEventTimeCategory(new Date(pin.starts_at))
    : "future";

  const timeStr = fmtRange(pin?.starts_at ?? undefined, pin?.ends_at ?? undefined);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={handleBackdropClick}
        className={`fixed inset-0 z-[9000] transition-opacity duration-300 ${
          isVisible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      />

      {/* Sheet */}
      <div
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className={`fixed bottom-0 inset-x-0 z-[9001] bg-base-100 rounded-t-3xl shadow-2xl
          transition-transform duration-300 ease-out
          ${isVisible ? "translate-y-0" : "translate-y-full"}`}
        style={{ paddingBottom: "calc(var(--floats-nav-total, 72px) + env(safe-area-inset-bottom, 0px))" }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 btn btn-ghost btn-sm btn-circle"
        >
          <X size={18} />
        </button>

        {/* Cluster count label */}
        {isMulti && (
          <div className="absolute top-4 left-4 flex items-center gap-1.5">
            <span className="text-xs font-semibold text-base-content/50">
              {currentIndex + 1} / {pins.length} events
            </span>
          </div>
        )}

        {pin && (
          <div className="px-4 pt-10 pb-6">
            {/* Image */}
            {pin.imageUrl && (
              <div className="w-full h-40 rounded-2xl overflow-hidden mb-3 bg-base-200 relative">
                <img
                  src={pin.imageUrl}
                  alt={pin.title ?? "Event image"}
                  className="w-full h-full object-cover"
                />

                {/* Prev / Next arrow buttons overlaid on image */}
                {isMulti && (
                  <>
                    <button
                      onClick={prev}
                      aria-label="Previous event"
                      className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white rounded-full p-1 transition-colors"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <button
                      onClick={next}
                      aria-label="Next event"
                      className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white rounded-full p-1 transition-colors"
                    >
                      <ChevronRight size={18} />
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Prev / Next arrows when there is no image */}
            {isMulti && !pin.imageUrl && (
              <div className="flex items-center justify-between mb-3">
                <button
                  onClick={prev}
                  aria-label="Previous event"
                  className="btn btn-ghost btn-sm btn-circle"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  onClick={next}
                  aria-label="Next event"
                  className="btn btn-ghost btn-sm btn-circle"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            )}

            {/* Dot position indicators */}
            {isMulti && (
              <div className="flex justify-center gap-1.5 mb-3">
                {pins.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentIndex(i)}
                    aria-label={`Go to event ${i + 1}`}
                    className={`rounded-full transition-all ${
                      i === currentIndex
                        ? "w-4 h-2 bg-primary"
                        : "w-2 h-2 bg-base-300 hover:bg-base-content/30"
                    }`}
                  />
                ))}
              </div>
            )}

            {/* Badge */}
            {category !== "future" && (
              <div className="mb-2">
                <span
                  className={`badge badge-outline text-xs font-medium ${
                    category === "today" ? "badge-success" : "badge-warning"
                  }`}
                >
                  {category === "today" ? "Today" : "This Weekend"}
                </span>
              </div>
            )}

            {/* Title */}
            {pin.title && (
              <h2 className="text-lg font-bold text-base-content mb-2 leading-snug">
                {pin.title}
              </h2>
            )}

            {/* Time */}
            {timeStr && (
              <div className="flex items-start gap-2 mb-1.5">
                <Calendar size={15} className="text-base-content/50 mt-0.5 shrink-0" />
                <p className="text-sm text-base-content/70">{timeStr}</p>
              </div>
            )}

            {/* Address */}
            {pin.address && (
              <div className="flex items-start gap-2 mb-4">
                <MapPin size={15} className="text-base-content/50 mt-0.5 shrink-0" />
                <p className="text-sm text-base-content/70">{pin.address}</p>
              </div>
            )}

            {/* CTA */}
            <button
              onClick={() => onViewEvent(pin)}
              className="btn btn-primary w-full rounded-xl text-base font-semibold"
            >
              View Event
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </>
  );
}
