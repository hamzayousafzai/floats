"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { type ExploreCardData } from "./EventCard";
import { Calendar, MapPin, X, Download, Navigation, Share2 } from "lucide-react";
import Image from "next/image";
import FavoriteButton from "@/components/FavoriteButton";
import NotificationBell from "@/components/NotificationBell";

type Props = {
  event: ExploreCardData | null;
  onClose: () => void;
  onCardChange?: (id: string, patch: Partial<ExploreCardData> | Partial<any>) => void;
};

export default function EventDetailModal({ event, onClose, onCardChange }: Props) {
  const [starred, setStarred] = useState<boolean>(event?.is_starred ?? false);
  const [notified, setNotified] = useState<boolean>(event?.is_notified ?? false);
  const [following, setFollowing] = useState<boolean>(event?.is_series_followed ?? false);

  useEffect(() => {
    setStarred(event?.is_starred ?? false);
    let mounted = true;
    (async () => {
      if (!event?.id) return;

      // load persisted notify state (set local state only; DO NOT call onCardChange here)
      try {
        const notifyRes = await fetch(`/api/events/${event.id}/notify`);
        const notifyJson = notifyRes.ok ? await notifyRes.json() : { notified: false };
        if (mounted) {
          setNotified(Boolean(notifyJson.notified));
          // removed: onCardChange?.(event.id, { is_notified: Boolean(notifyJson.notified) });
        }
      } catch {
        if (mounted) setNotified(false);
      }

      // load series follow state (set local state only)
      if (event?.series_id) {
        try {
          const followRes = await fetch(`/api/series/${event.series_id}/follow`);
          const followJson = followRes.ok ? await followRes.json() : { following: false };
          if (mounted) {
            setFollowing(Boolean(followJson.following));
            // removed: onCardChange?.(event.id, { is_series_followed: Boolean(followJson.following) });
          }
        } catch {
          if (mounted) setFollowing(false);
        }
      } else {
        if (mounted) setFollowing(false);
      }
    })();

    return () => { mounted = false; };
  }, [event?.id, event?.series_id]); // keep deps minimal

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

  return (
    <dialog id="event_modal" className="modal" open={!!event}>
      {event && (
        <div className="modal-box">
          <button onClick={onClose} className="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"><X /></button>

          {event.image_url && (
            <figure className="relative h-48 -mx-6 -mt-6 mb-4 bg-gray-200 rounded-t-lg overflow-hidden">
              <Image src={event.image_url} alt={event.title} fill className="object-cover" />
            </figure>
          )}

          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-bold text-lg">{event.title}</h3>
            </div>

            <div className="flex items-center gap-3 ml-auto">
              <NotificationBell
                eventId={event.id}
                seriesId={event.series_id ?? null}
                visible={Boolean(starred)}
                initialNotified={notified}
                initialFollowing={following}
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
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-gray-500" />
              <span>{new Date(event.starts_at).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })}</span>
            </div>
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
      <form method="dialog" className="modal-backdrop"><button onClick={onClose}>close</button></form>
    </dialog>
  );
}