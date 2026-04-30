"use client";

import { useEffect } from "react";
import { X, Calendar, MapPin } from "lucide-react";
import type { EventPin } from "@/lib/types";
import { getEventTimeCategory, fmtRange } from "./PinPopup";

type Props = {
  pin: EventPin | null;
  onClose: () => void;
  onViewEvent: () => void;
};

export default function MapBottomSheet({ pin, onClose, onViewEvent }: Props) {
  // Dismiss on backdrop tap
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  // Dismiss on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (pin) document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [pin, onClose]);

  const isVisible = pin !== null;

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

        {pin && (
          <div className="px-4 pt-10 pb-6">
            {/* Image */}
            {pin.imageUrl && (
              <div className="w-full h-40 rounded-2xl overflow-hidden mb-3 bg-base-200">
                <img
                  src={pin.imageUrl}
                  alt={pin.title ?? "Event image"}
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            {/* Badge */}
            {category !== "future" && (
              <div className="mb-2">
                <span
                  className={`badge badge-outline text-xs font-medium ${
                    category === "today"
                      ? "badge-success"
                      : "badge-warning"
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
              onClick={onViewEvent}
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
