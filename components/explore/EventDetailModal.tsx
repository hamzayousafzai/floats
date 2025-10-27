"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { ExploreCardData } from "@/lib/types";
import { Calendar, MapPin, X, Download, Navigation, Share2, ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";
import FavoriteButton from "@/components/FavoriteButton";
import NotificationBell from "@/components/NotificationBell";

type Props = {
  event: ExploreCardData | null;
  onClose: () => void;
  onCardChange?: (id: string, patch: Partial<ExploreCardData>) => void;
};

export default function EventDetailModal({ event, onClose, onCardChange }: Props) {
  const [starred, setStarred] = useState<boolean>(event?.is_starred ?? false);
  const [notified, setNotified] = useState<boolean>(event?.is_notified ?? false);
  const [following, setFollowing] = useState<boolean>(event?.is_series_followed ?? false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

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
    const url = `${window.location.origin}/events/${event.id}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: event.title ?? "Event",
          text: event.description ?? undefined,
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
  }, [event?.id, event?.title, event?.description]);

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

  return (
    <dialog id="event_modal" className="modal" open={!!event}>
      {event && (
        <div className="modal-box border border-base-300 bg-base-300">  {/* Added border */}
          {/* Wrap the close button in a form with method="dialog" */}
          <form method="dialog">
            <button onClick={onClose} className="btn btn-sm btn-circle btn-ghost absolute right-2 top-2 z-10"><X /></button>
          </form>

          {sortedImages.length > 0 && (
            <figure className="relative h-48 -mx-6 -mt-6 mb-4 bg-gray-200 rounded-t-lg overflow-hidden">
              {/* Image Display */}
              <Image 
                src={sortedImages[currentImageIndex].image_url} 
                alt={`${event.title} image ${currentImageIndex + 1}`} 
                fill 
                className="object-cover"
                key={sortedImages[currentImageIndex].image_url}
              />

              {/* Carousel Controls Wrapper - Only show if there is more than one image */}
              {sortedImages.length > 1 && (
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 z-10 flex items-center justify-between pointer-events-none">
                  <button 
                    onClick={prevImage} 
                    className="btn btn-ghost btn-circle btn-sm ml-2 text-white bg-black/60 hover:bg-black/80 active:bg-black/100 border-none transition pointer-events-auto"
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <button 
                    onClick={nextImage} 
                    className="btn btn-ghost btn-circle btn-sm mr-2 text-white bg-black/60 hover:bg-black/80 active:bg-black/100 border-none transition pointer-events-auto"
                  >
                    <ChevronRight size={20} />
                  </button>
                </div>
              )}
            </figure>
          )}

          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-bold text-lg">{event.title}</h3>
            </div>

            <div className="flex items-center gap-3 ml-auto">
              <NotificationBell
                key={event.id}                 // ensure a clean mount per event
                eventId={event.id}
                seriesId={event.series_id ?? null}
                visible={Boolean(starred)}
                initialNotified={notified}     // optional: pass if your Bell supports it
                initialFollowing={following}   // optional
                className="mr-1"
                onNotifyChange={handleNotifyChange}
                onFollowChange={handleFollowChange}
              />

              <FavoriteButton
                eventId={event.id}
                seriesId={event.series_id ?? null}
                startsAt={event.starts_at ?? null}
                initialStarred={event.is_starred ?? undefined}
                variant="pill"
                size="md"
                onChange={handleFavoriteChange}
              />
            </div>
          </div>

          {event.description ? <p className="py-4 text-sm">{event.description}</p> : null}

          <div className="mt-2 space-y-2 text-sm">
            {event.starts_at && (
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-gray-500" />
                <span>{formatEventTimeRange(event.starts_at, event.ends_at)}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-gray-500" />
              <span>{event.address}</span>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-2 modal-action">
            {canGetDirections && (
              <a href={getDirectionsUrl()} target="_blank" rel="noopener noreferrer" className="btn btn-outline">
                <Navigation className="h-4 w-4" /> Get Directions
              </a>
            )}

            <a href={`/api/events/${event.id}/ics?reminderDays=2`} className="btn btn-outline" download>
              <Download className="h-4 w-4" /> Add to Calendar
            </a>

            <button type="button" onClick={shareEvent} className="btn btn-outline">
              <Share2 className="h-4 w-4" /> Share
            </button>
          </div>
        </div>
      )}
      {/* This form handles the backdrop click to close */}
      <form method="dialog" className="modal-backdrop"><button onClick={onClose}>close</button></form>
    </dialog>
  );
}