"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { ExploreCardData } from "@/lib/types";
import { Calendar, MapPin, Download, Navigation, Share2, ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";
import FavoriteButton from "../FavoriteButton";
import NotificationBell from "../NotificationBell";
import CheckInButton from "@/components/checkin/CheckInButton";

type Props = {
  event: ExploreCardData | null;
  onClose: () => void;
  onCardChange?: (id: string, patch: Partial<ExploreCardData>) => void;
  isPreview?: boolean; // Add isPreview prop
};

export default function EventDetailModal({ event, onClose, onCardChange, isPreview = false }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null); // Create a ref for the dialog
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const searchParams = useSearchParams();

  // This effect imperatively controls the dialog's visibility
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (event) {
      // If there's an event and the dialog isn't already open, show it.
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      // If there's no event and the dialog is open, close it.
      if (dialog.open) {
        dialog.close();
      }
    }
  }, [event]); // This effect runs whenever the `event` prop changes

  const handleAuthRedirect = (redirectAction: () => void) => {
    // This function will be passed to the FavoriteButton.
    // It closes the dialog imperatively, then executes the redirect.
    const dialog = dialogRef.current;
    if (dialog && dialog.open) {
      dialog.close();
      // We wait for the 'close' event on the dialog before redirecting.
      dialog.addEventListener('close', redirectAction, { once: true });
    } else {
      // If for some reason the dialog isn't open, just redirect immediately.
      redirectAction();
    }
  };

  const [starred, setStarred] = useState<boolean>(event?.is_starred ?? false);
  const [notified, setNotified] = useState<boolean>(event?.is_notified ?? false);
  const [following, setFollowing] = useState<boolean>(event?.is_series_followed ?? false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [alreadyChecked, setAlreadyChecked] = useState(false); // NEW

  const fetchedKey = useRef<string | null>(null);

  // Memoize the sorted images array
  const sortedImages = useMemo(() => {
    if (!event?.event_media || event.event_media.length === 0) {
      // Fallback to old image_url if event_media is not present
      return event?.image_url ? [{ image_url: event.image_url, sort_index: 0 }] : [];
    }
    return [...event.event_media].sort((a, b) => a.sort_index - b.sort_index);
  }, [event?.event_media, event?.image_url]);

  // Reset index and hydrate from event payload only. No network calls here.
  useEffect(() => {
    setCurrentImageIndex(0);
    setStarred(event?.is_starred ?? false);
    setNotified(event?.is_notified ?? false);
    setFollowing(event?.is_series_followed ?? false);
  }, [event?.id, event?.is_starred, event?.is_notified, event?.is_series_followed]);

  const handleFavoriteChange = async (next: boolean) => {
    setStarred(next);
    onCardChange?.(event!.id, { is_starred: next });

    if (!next && event?.id) {
      setNotified(false);
      setFollowing(false);
      onCardChange?.(event.id, { is_notified: false, is_series_followed: false });

      try {
        await fetch(`/api/events/${event.id}/notify`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: false }),
        });
      } catch (err) {
        console.error("Failed to disable event notification on unfavorite:", err);
      }
    }
  };

  // callbacks from NotificationBell
  const handleNotifyChange = useCallback((val: boolean) => {
    setNotified(val);
    if (event?.id) onCardChange?.(event.id, { is_notified: val });
  }, [event?.id, onCardChange]);

  const handleFollowChange = useCallback((val: boolean) => {
    setFollowing(val);
    if (event?.id) onCardChange?.(event.id, { is_series_followed: val });
  }, [event?.id, onCardChange]);

  const getDirectionsUrl = useCallback(() => {
    if (!event) return "#";
    // Prioritize address for more accurate navigation
    if (event.address) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.address)}`;
    }
    return "#";
  }, [event?.address, event?.latitude, event?.longitude]);

  const canGetDirections = useMemo(
    () => !!(event?.address || (event?.latitude && event?.longitude)),
    [event?.address, event?.latitude, event?.longitude]
  );

  const shareEvent = useCallback(async () => {
    if (!event?.id) return;
    // Append ?from=/explore to ensure a clean redirect on close for shared links
    const url = `${window.location.origin}/events/${event.id}?from=/explore`;
    try {
      if (navigator.share) {
        await navigator.share({
          url,
        });
        return;
      }

      // clipboard API (correct spelling: writeText)
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(url);
        alert("Event link copied");
        return;
      }

      // fallback: programmatic copy via textarea + execCommand
      const textarea = document.createElement("textarea");
      textarea.value = url;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand("copy");
        alert("Event link copied");
      } catch (copyErr) {
        console.error("Clipboard fallback failed:", copyErr);
      } finally {
        document.body.removeChild(textarea);
      }
    } catch (err) {
      console.error("Share failed:", err);
    }
  }, [event?.id]);

  // Helper function to format dates consistently in EST
  const formatEventTime = useCallback((dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString("en-US", {
      timeZone: "America/New_York", // EST/EDT
      dateStyle: "full",
      timeStyle: "short"
    });
  }, []);

  // Replace the signature/body so it accepts nullable inputs
  const formatEventTimeRange = useCallback(
    (startsAt?: string | null, endsAt?: string | null) => {
      if (!startsAt) return "";
      const startDate = new Date(startsAt);

      const startFormatted = startDate.toLocaleString("en-US", {
        timeZone: "America/New_York",
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });

      if (!endsAt) return startFormatted;

      const endDate = new Date(endsAt);
      const isSameDay = startDate.toDateString() === endDate.toDateString();

      if (isSameDay) {
        const endTime = endDate.toLocaleString("en-US", {
          timeZone: "America/New_York",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });
        return `${startFormatted} - ${endTime}`;
      }

      const endFormatted = endDate.toLocaleString("en-US", {
        timeZone: "America/New_York",
        weekday: "long",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      return `${startFormatted} - ${endFormatted}`;
    },
    []
  );

  const nextImage = () => {
    setCurrentImageIndex((prevIndex) => (prevIndex + 1) % sortedImages.length);
  };

  const prevImage = () => {
    setCurrentImageIndex((prevIndex) => (prevIndex - 1 + sortedImages.length) % sortedImages.length);
  };

  useEffect(() => {
    const key = `${event?.id}:${event?.series_id ?? ""}`;
    if (fetchedKey.current === key) return; // prevents duplicate fetches in Strict Mode
    fetchedKey.current = key;

    // do the GETs here...
  }, [event?.id, event?.series_id]);

  // Check-in state effect
  useEffect(() => {
    let abort = false;
    (async () => {
      if (!event?.id) {
        setAlreadyChecked(false);
        return;
      }
      try {
        const res = await fetch(`/api/check-in?event_id=${event.id}`, { cache: "no-store" });
        if (!res.ok) { setAlreadyChecked(false); return; }
        const json = await res.json();
        if (!abort) setAlreadyChecked(Boolean(json?.checked));
      } catch {
        if (!abort) setAlreadyChecked(false);
      }
    })();
    return () => { abort = true; };
  }, [event?.id]);

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 m-0 max-w-full w-full h-full max-h-full bg-transparent p-0 backdrop:bg-black/50 backdrop:backdrop-blur-sm"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      {event && (
        <div className="flex flex-col h-full max-w-lg mx-auto bg-white overflow-hidden">
          {/* ── Hero image ───────────────────────────────── */}
          <div className="relative flex-shrink-0 h-64 bg-gray-100">
            {sortedImages.length > 0 ? (
              <>
                <Image
                  src={sortedImages[currentImageIndex].image_url}
                  alt={`${event.title} image ${currentImageIndex + 1}`}
                  fill
                  className="object-cover"
                  key={sortedImages[currentImageIndex].image_url}
                  priority
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-black/20" />

                {/* Carousel arrows */}
                {sortedImages.length > 1 && (
                  <>
                    <button
                      onClick={prevImage}
                      className="absolute left-3 top-1/2 -translate-y-1/2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <button
                      onClick={nextImage}
                      className="absolute right-3 top-1/2 -translate-y-1/2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition"
                    >
                      <ChevronRight size={18} />
                    </button>

                    {/* Dot indicators */}
                    <div className="absolute bottom-3 inset-x-0 flex justify-center gap-1.5">
                      {sortedImages.map((_, i) => (
                        <button
                          key={i}
                          onClick={() => setCurrentImageIndex(i)}
                          className={`h-1.5 rounded-full transition-all ${
                            i === currentImageIndex ? "w-4 bg-white" : "w-1.5 bg-white/50"
                          }`}
                        />
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gray-100">
                <span className="text-gray-300 text-sm">No image</span>
              </div>
            )}

            {/* Back button */}
            <form method="dialog">
              <button className="absolute left-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 transition backdrop-blur-sm">
                <ChevronLeft size={20} />
              </button>
            </form>

            {/* Action buttons over image */}
            <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
              <div className="rounded-full bg-black/40 backdrop-blur-sm p-0.5">
                <NotificationBell
                  eventId={event.id}
                  seriesId={event.series_id}
                  visible={starred}
                  initialNotified={notified}
                  initialFollowing={following}
                  onNotifyChange={handleNotifyChange}
                  onFollowChange={handleFollowChange}
                  disabled={isPreview || event.is_past}
                />
              </div>
              <div className={`rounded-full backdrop-blur-sm p-0.5 transition-colors ${starred ? "bg-amber-400/90" : "bg-black/40"}`}>
                <FavoriteButton
                  eventId={event.id}
                  seriesId={event.series_id ?? null}
                  startsAt={event.starts_at ?? null}
                  initialStarred={starred}
                  variant="icon"
                  size="md"
                  onChange={handleFavoriteChange}
                  onAuthRedirect={handleAuthRedirect}
                  disabled={isPreview || event.is_past}
                  className={starred ? "text-white hover:text-white" : "text-white/80 hover:text-white"}
                />
              </div>
            </div>
          </div>

          {/* ── Scrollable body ──────────────────────────── */}
          <div className="flex-1 overflow-y-auto">
            <div className="px-5 pt-5 pb-8 space-y-5">

              {/* Title + categories */}
              <div>
                <h2 className="text-2xl font-bold leading-tight text-gray-900">
                  {event.title}
                </h2>
                {event.categories && event.categories.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {event.categories.map((cat: string) => (
                      <span
                        key={cat}
                        className="rounded-full border border-gray-200 bg-gray-50 px-3 py-0.5 text-xs text-gray-500 capitalize"
                      >
                        {cat.replace(/-/g, " ")}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Date + Address block */}
              <div className="space-y-2.5 text-sm text-gray-700">
                {event.starts_at && (
                  <div className="flex items-start gap-3">
                    <Calendar className="h-4 w-4 mt-0.5 flex-shrink-0 text-gray-400" />
                    <span>{formatEventTimeRange(event.starts_at, event.ends_at)}</span>
                  </div>
                )}
                {event.address && (
                  <div className="flex items-start gap-3">
                    <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0 text-gray-400" />
                    <span>{event.address}</span>
                  </div>
                )}
              </div>

              {/* Check-in */}
              {event.starts_at && (
                <CheckInButton
                  eventId={event.id}
                  startsAt={event.starts_at}
                  endsAt={event.ends_at ?? null}
                  autoRun={searchParams.get("doCheckIn") === "1"}
                  initialChecked={alreadyChecked}
                  disabled={isPreview || event.is_past}
                  onAuthRedirect={handleAuthRedirect}
                />
              )}

              {/* Action buttons */}
              <div className="space-y-2.5">
                {canGetDirections && (
                  <a
                    href={getDirectionsUrl()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gray-900 py-3.5 text-sm font-semibold text-white hover:bg-gray-800 active:bg-black transition-colors"
                  >
                    <Navigation className="h-4 w-4" />
                    Get Directions
                  </a>
                )}
                <div className="grid grid-cols-2 gap-2.5">
                  <a
                    href={`/api/events/${event.id}/ics?reminderDays=2`}
                    download
                    className="flex items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <Download className="h-4 w-4" />
                    Add to Calendar
                  </a>
                  <button
                    type="button"
                    onClick={shareEvent}
                    className="flex items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <Share2 className="h-4 w-4" />
                    Share
                  </button>
                </div>
              </div>

              {/* About section */}
              {event.description && (
                <div>
                  <h3 className="mb-2 text-base font-semibold text-gray-900">About</h3>
                  <p className="text-sm leading-relaxed text-gray-600 whitespace-pre-line">
                    {event.description}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}