"use client";

import { type ExploreCardData } from "./EventCard";
import { Calendar, MapPin, X, Download, Navigation } from "lucide-react"; // Import Navigation icon
import Image from "next/image";

type Props = {
  event: ExploreCardData | null;
  onClose: () => void;
};

export default function EventDetailModal({ event, onClose }: Props) {
  // Function to generate the correct maps URL
  const getDirectionsUrl = () => {
    if (!event) return "#";

    // Prefer using lat/lng for accuracy
    if (event.latitude && event.longitude) {
      return `https://www.google.com/maps/search/?api=1&query=${event.latitude},${event.longitude}`;
    }
    // Fallback to address if coordinates are not available
    if (event.address) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.address)}`;
    }
    
    return "#";
  };

  const canGetDirections = !!(event?.address || (event?.latitude && event?.longitude));

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
          <h3 className="font-bold text-lg">{event.title}</h3>
          <p className="py-4 text-sm">{event.description || "No description available."}</p>
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
          <div className="modal-action">
            {/* Get Directions Button */}
            {canGetDirections && (
              <a
                href={getDirectionsUrl()}
                target="_blank" // Open in a new tab/native app
                rel="noopener noreferrer"
                className="btn btn-outline"
              >
                <Navigation className="h-4 w-4" />
                Get Directions
              </a>
            )}
            <a
              href={`/api/events/${event.id}/ics?reminderDays=2`}
              className="btn btn-outline"
              download
            >
              <Download className="h-4 w-4" />
              Add to Calendar
            </a>
          </div>
        </div>
      )}
      <form method="dialog" className="modal-backdrop">
        <button onClick={onClose}>close</button>
      </form>
    </dialog>
  );
}